import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { KubernetesConfig, KubernetesTarget, KubernetesForward, KubernetesPodMetrics, KubernetesLogOptions, KubernetesLogs } from '../shared/kubernetes'

export interface KubernetesConfigSnapshot extends KubernetesConfig { json: string }

const MAX_BYTES = 8 * 1024 * 1024
const idFor = (value: string): string => createHash('sha256').update(value).digest('hex')
const resourceName = (value: string): boolean => typeof value === 'string' && /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(value) && value.length <= 253

interface Resource {
  kind: string
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> }
  spec?: { selector?: Record<string, string>; ports?: Array<{ port: number; name?: string; protocol?: string }>; containers?: Array<{ name?: string; image?: string }> }
  status?: { phase?: string; conditions?: Array<{ type: string; status: string }> }
}

/** Parse only resource identity, service ports and pod health; discard environment and annotations. */
export function parseKubernetesTargets(json: string, configId: string, context: string): KubernetesTarget[] {
  let data: { items?: Resource[] }
  try { data = JSON.parse(json) } catch { throw new Error('Kubernetes 资源 JSON 无效') }
  if (!Array.isArray(data.items)) throw new Error('Kubernetes 未返回资源列表')
  const pods = data.items.filter((item) => item.kind === 'Pod')
  return data.items.filter((item) => item.kind === 'Service').flatMap((service) => {
    const name = service.metadata?.name ?? ''
    const namespace = service.metadata?.namespace ?? ''
    if (!resourceName(name) || !resourceName(namespace)) return []
    const selector = Object.entries(service.spec?.selector ?? {})
    const related = selector.length ? pods.filter((pod) => pod.metadata?.namespace === namespace && selector.every(([key, value]) => pod.metadata?.labels?.[key] === value)) : []
    const evidence = [name, ...Object.values(service.metadata?.labels ?? {}), ...related.flatMap((pod) => pod.spec?.containers?.map((container) => container.image ?? '') ?? [])].join(' ').toLowerCase()
    return (service.spec?.ports ?? []).filter((port) => (!port.protocol || port.protocol === 'TCP') && Number.isInteger(port.port) && port.port > 0 && port.port <= 65535).map((port) => ({
      id: idFor(JSON.stringify([configId, context, namespace, name, port.port])), configId, context, namespace, service: name,
      port: port.port, portName: port.name ?? '',
      database: /mysql|mariadb/.test(evidence) ? 'mysql' : /postgres/.test(evidence) ? 'postgresql' : /redis/.test(evidence) ? 'redis' : 'unknown',
      pods: related.map((pod) => ({ name: pod.metadata?.name ?? '', phase: pod.status?.phase ?? 'Unknown', containers: (pod.spec?.containers ?? []).map((container) => container.name ?? '').filter(resourceName), ready: pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True') ?? false })),
      forwardable: selector.length > 0 && related.some((pod) => pod.status?.phase === 'Running')
    } as KubernetesTarget))
  })
}

function quantity(value: string, cpu: boolean): number {
  if (typeof value !== 'string') throw new Error('指标单位无效')
  const match = /^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(n|u|m|Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/.exec(value)
  if (!match) throw new Error('指标单位无效')
  const factors: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 }
  const result = Number(match[1]) * (factors[match[2]] ?? 1) * (cpu ? 1000 : 1)
  if (!Number.isFinite(result)) throw new Error('指标数值无效')
  return result
}

export function parsePodMetrics(json: string, pod: string): KubernetesPodMetrics {
  try {
    const data = JSON.parse(json) as { metadata: { name: string }; timestamp: string; window: string; containers: Array<{ name: string; usage: { cpu: string; memory: string } }> }
    if (data.metadata.name !== pod || !Array.isArray(data.containers) || !data.containers.length || !Number.isFinite(Date.parse(data.timestamp)) || typeof data.window !== 'string') throw new Error('invalid')
    return { pod, timestamp: data.timestamp, window: data.window, containers: data.containers.map((container) => {
      if (!resourceName(container.name)) throw new Error('invalid')
      return { name: container.name, cpuMillicores: quantity(container.usage.cpu, true), memoryBytes: quantity(container.usage.memory, false) }
    }) }
  } catch { throw new Error('资源指标格式无效，暂时无法显示用量') }
}

function commandPath(): string {
  // GUI apps on macOS do not inherit the shell's Homebrew PATH.
  return ['/opt/homebrew/bin/kubectl', '/usr/local/bin/kubectl'].find(existsSync) ?? 'kubectl'
}

function failure(stderr: string): Error {
  if (/unauthorized|provide credentials|logged in/i.test(stderr)) return new Error('集群凭据失效或未登录，请更新 kubeconfig')
  if (/forbidden/i.test(stderr)) return new Error('集群权限不足，请检查本操作所需的资源权限')
  if (/notfound|not found|could not find the requested resource|serviceunavailable/i.test(stderr)) return new Error('请求的资源或接口不可用，请刷新服务并检查集群配置')
  if (/previous terminated container|waiting to start|container.*not.*available/i.test(stderr)) return new Error('该容器当前没有可读取的日志，请检查容器状态或取消上一次实例选项')
  return new Error('kubectl 操作失败，请检查安装、网络、证书及集群配置')
}

/** One trusted host owns config registrations, collection and forwarding subprocesses. */
export class KubernetesClient {
  private configs = new Map<string, { path: string; contexts: string[]; fingerprint: string; name: string }>()
  private discovered = new Map<string, KubernetesTarget>()
  private tunnels = new Map<string, { child: ChildProcess; info: KubernetesForward; configId: string }>()
  private children = new Set<ChildProcess>()
  private disposed = false
  private temporaryDirectories = new Set<string>()
  private pendingForwards = 0
  private collecting = false
  private podReads = 0

  private run(args: string[], maxBuffer = MAX_BYTES): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('Kubernetes 宿主已关闭'))
    return new Promise((resolve, reject) => {
      const child = execFile(commandPath(), args, { timeout: 20000, maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
        this.children.delete(child)
        if (error) reject(failure(stderr))
        else resolve(stdout)
      })
      this.children.add(child)
    })
  }

  private async inspect(path: string): Promise<{ contexts: string[]; json: string }> {
    const json = await this.run(['--kubeconfig', path, 'config', 'view', '--raw', '--flatten', '-o', 'json'])
    return { contexts: this.checkedContexts(json), json }
  }

  private checkedContexts(json: string): string[] {
    if (typeof json !== 'string' || Buffer.byteLength(json) > MAX_BYTES) throw new Error('kubeconfig 内容无效或超过大小限制')
    let parsed: unknown
    try { parsed = JSON.parse(json) } catch { throw new Error('无法读取 kubeconfig') }
    const data = parsed as {
      users?: Array<{ user?: { exec?: unknown; 'auth-provider'?: unknown } }>; contexts?: Array<{ name: string }>
    }
    if (!data || (data.users != null && !Array.isArray(data.users))) throw new Error('无法读取 kubeconfig')
    // Revalidate persisted snapshots too; disk storage must never enable credential commands.
    if (data.users?.some((user) => user?.user?.exec || user?.user?.['auth-provider'])) throw new Error('第一版仅支持 token/证书 kubeconfig，不执行凭据插件')
    if (!Array.isArray(data.contexts) || !data.contexts.length || data.contexts.length > 256 || data.contexts.some((context) => !context || typeof context.name !== 'string' || !context.name || context.name.length > 1024)) throw new Error('kubeconfig 没有有效 context')
    return data.contexts.map((context) => context.name)
  }

  async importConfig(path: string): Promise<KubernetesConfig> {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('请选择 kubeconfig 文件')
    const { contexts, json } = await this.inspect(path)
    return this.registerConfig(idFor(path), basename(path), contexts, json)
  }

  restoreConfig(snapshot: KubernetesConfigSnapshot): KubernetesConfig {
    if (!snapshot || typeof snapshot.id !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.id) || typeof snapshot.name !== 'string' || !snapshot.name || snapshot.name !== basename(snapshot.name)) throw new Error('已保存的配置无效，请移除后重新导入')
    return this.registerConfig(snapshot.id, snapshot.name, this.checkedContexts(snapshot.json), snapshot.json)
  }

  exportConfig(id: string): KubernetesConfigSnapshot {
    const config = this.configs.get(id)
    if (!config) throw new Error('配置尚未导入')
    return { id, name: config.name, contexts: [...config.contexts], json: readFileSync(config.path, 'utf8') }
  }

  forgetConfig(id: string): void {
    const targets = new Set([...this.discovered.values()].filter((target) => target.configId === id).map((target) => target.id))
    for (const [tunnelId, tunnel] of this.tunnels) if (tunnel.configId === id) this.stop(tunnelId)
    for (const targetId of targets) this.discovered.delete(targetId)
    const config = this.configs.get(id)
    this.configs.delete(id)
    if (config) {
      const directory = dirname(config.path)
      rmSync(directory, { recursive: true, force: true })
      this.temporaryDirectories.delete(directory)
    }
  }

  private registerConfig(id: string, name: string, contexts: string[], json: string): KubernetesConfig {
    if (this.disposed) throw new Error('Kubernetes 宿主已关闭')
    const fingerprint = idFor(json)
    if (this.configs.get(id)?.fingerprint === fingerprint) return { id, name, contexts }
    // Freeze the checked config. A source-file edit must never introduce an exec plugin later.
    const directory = mkdtempSync(join(tmpdir(), 'myssh-kube-'))
    this.temporaryDirectories.add(directory)
    const snapshot = join(directory, 'config.json')
    try { writeFileSync(snapshot, json, { mode: 0o600 }) }
    catch { rmSync(directory, { recursive: true, force: true }); this.temporaryDirectories.delete(directory); throw new Error('无法保存受保护的 kubeconfig 快照') }
    this.forgetConfig(id)
    this.configs.set(id, { path: snapshot, contexts, fingerprint, name })
    return { id, name, contexts }
  }

  private async args(configId: string, context: string): Promise<string[]> {
    const config = this.configs.get(configId)
    if (!config || typeof context !== 'string' || !config.contexts.includes(context)) throw new Error('请重新导入 kubeconfig 并选择 context')
    return ['--kubeconfig', config.path, '--context', context, '--request-timeout=15s']
  }

  async discover(configId: string, context: string, namespace: string): Promise<KubernetesTarget[]> {
    if (namespace !== '' && !resourceName(namespace)) throw new Error('命名空间格式无效')
    if (this.collecting) throw new Error('资源发现正在进行，请稍候')
    this.collecting = true
    try {
      const registration = this.configs.get(configId)
      const args = await this.args(configId, context)
      const json = await this.run([...args, 'get', 'services,pods', ...(namespace ? ['--namespace', namespace] : ['--all-namespaces']), '-o', 'json'])
      if (this.disposed) throw new Error('Kubernetes 宿主已关闭')
      if (this.configs.get(configId) !== registration) throw new Error('集群配置已更新，请重新发现服务')
      const targets = parseKubernetesTargets(json, configId, context)
      for (const [id, target] of this.discovered) {
        if (target.configId === configId && target.context === context && (!namespace || target.namespace === namespace)) this.discovered.delete(id)
      }
      for (const target of targets) this.discovered.set(target.id, target)
      return targets
    } finally { this.collecting = false }
  }

  private podTarget(targetId: string, podName: string): KubernetesTarget {
    const target = this.discovered.get(targetId)
    if (!target || !resourceName(podName) || !target.pods.some((pod) => pod.name === podName)) throw new Error('请重新发现服务并选择关联 Pod')
    return target
  }

  private async readPod<T>(operation: () => Promise<T>): Promise<T> {
    if (this.podReads >= 4) throw new Error('已有监控或日志查询正在进行，请稍后重试')
    this.podReads++
    try { return await operation() } finally { this.podReads-- }
  }

  async metrics(targetId: string, podName: string): Promise<KubernetesPodMetrics> {
    return this.readPod(async () => {
      const target = this.podTarget(targetId, podName)
      const args = await this.args(target.configId, target.context)
      const json = await this.run([...args, 'get', '--raw', `/apis/metrics.k8s.io/v1beta1/namespaces/${target.namespace}/pods/${podName}`], 262144)
      if (this.discovered.get(targetId) !== target) throw new Error('服务信息已更新，请重新选择 Pod')
      return parsePodMetrics(json, podName)
    })
  }

  async logs(targetId: string, podName: string, container: string, options: KubernetesLogOptions): Promise<KubernetesLogs> {
    const target = this.podTarget(targetId, podName)
    const pod = target.pods.find((item) => item.name === podName)!
    if (!resourceName(container) || !pod.containers.includes(container)) throw new Error('请选择 Pod 的有效容器')
    if (!options || ![100, 300, 1000].includes(options.tailLines) || ![300, 3600, 86400].includes(options.sinceSeconds) || typeof options.previous !== 'boolean') throw new Error('日志查询参数无效')
    return this.readPod(async () => {
      const args = await this.args(target.configId, target.context)
      const text = await this.run([...args, '--namespace', target.namespace, 'logs', podName, '--container', container,
        `--tail=${options.tailLines}`, `--since=${options.sinceSeconds}s`, '--limit-bytes=262144', '--timestamps=true', ...(options.previous ? ['--previous=true'] : [])], 524288)
      if (this.discovered.get(targetId) !== target) throw new Error('服务信息已更新，请重新选择 Pod')
      if (Buffer.byteLength(text) > 262144) throw new Error('日志响应超过大小限制，请缩小查询范围')
      return { text, possiblyTruncated: Buffer.byteLength(text) >= 262144 }
    })
  }

  targets(): KubernetesTarget[] { return [...this.discovered.values()] }
  forwards(): KubernetesForward[] { return [...this.tunnels.values()].map(({ info }) => ({ ...info })) }

  async forward(targetId: string): Promise<KubernetesForward> {
    const target = this.discovered.get(targetId)
    if (!target?.forwardable) throw new Error('请刷新服务，选择有运行中 Pod 的 Service')
    if (this.pendingForwards + [...this.tunnels.values()].filter(({ info }) => info.state === 'ready').length >= 16) throw new Error('最多同时建立 16 个转发')
    this.pendingForwards++
    try {
      const args = (await this.args(target.configId, target.context)).filter((argument) => !argument.startsWith('--request-timeout='))
      if (this.disposed) throw new Error('Kubernetes 宿主已关闭')
      return await new Promise<KubernetesForward>((resolve, reject) => {
        const child = spawn(commandPath(), [...args, '--namespace', target.namespace, 'port-forward', `service/${target.service}`, `:${target.port}`, '--address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        this.children.add(child)
        const id = randomUUID()
        let settled = false
        let output = ''
        const fail = (error: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          child.kill()
          reject(error)
        }
        const timer = setTimeout(() => fail(new Error('建立转发超时')), 20000)
        child.stdout.on('data', (chunk: Buffer) => {
          if (settled) return
          output += chunk.toString()
          if (Buffer.byteLength(output) > 4096) { fail(new Error('转发输出超过限制')); return }
          const match = /Forwarding from 127\.0\.0\.1:(\d+) ->/.exec(output)
          if (!match) return
          if (this.discovered.get(targetId) !== target) { fail(new Error('集群配置已更新，请刷新服务')); return }
          settled = true
          clearTimeout(timer)
          const info: KubernetesForward = { id, targetId, host: '127.0.0.1', port: Number(match[1]), state: 'ready' }
          if (this.tunnels.size >= 64) {
            const oldestClosed = [...this.tunnels].find(([, tunnel]) => tunnel.info.state === 'closed')
            if (oldestClosed) this.tunnels.delete(oldestClosed[0])
          }
          this.tunnels.set(id, { child, info, configId: target.configId })
          resolve({ ...info })
        })
        child.stderr.on('data', (chunk: Buffer) => {
          if (!settled) fail(failure(chunk.toString()))
        })
        child.on('error', () => fail(new Error('无法启动 kubectl，请确认已安装')))
        child.on('close', () => {
          this.children.delete(child)
          const tunnel = this.tunnels.get(id)
          if (tunnel) { tunnel.info.state = 'closed'; tunnel.info.message = '转发已结束，请重新连接；SQL 不会自动重试' }
          fail(new Error('转发进程已退出'))
        })
      })
    } finally { this.pendingForwards-- }
  }

  stop(id: string): void {
    const tunnel = this.tunnels.get(id)
    if (!tunnel) return
    tunnel.info.state = 'closed'
    tunnel.child.kill()
    this.tunnels.delete(id)
  }

  dispose(): void {
    this.disposed = true
    for (const child of this.children) child.kill()
    this.children.clear()
    this.tunnels.clear()
    this.configs.clear()
    this.discovered.clear()
    for (const directory of this.temporaryDirectories) rmSync(directory, { recursive: true, force: true })
    this.temporaryDirectories.clear()
  }
}
