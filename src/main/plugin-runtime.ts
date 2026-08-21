import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type {
  PluginRuntimeEndpoint,
  PluginRuntimeState,
  PluginRuntimeStateInfo,
  PluginRuntimeTransport
} from '@shared/types'

const READY_PREFIX = 'MYSSH_RUNTIME_READY '
const DEFAULT_TIMEOUT_MS = 15_000

export interface RuntimeDescriptor {
  pluginId: string
  official: boolean
  runtimePath: string
  kind: 'node-companion-v1'
  transport: PluginRuntimeTransport
}

export interface PluginRuntimeManagerOptions {
  executablePath: string
  resolveRuntime: (pluginId: string) => Promise<RuntimeDescriptor>
  timeoutMs?: number
  spawnProcess?: typeof spawn
}

interface RuntimeRecord {
  pluginId: string
  child: ChildProcess
  state: PluginRuntimeState
  generation?: string
  endpoint?: PluginRuntimeEndpoint
  error?: string
  token: string
  startPromise?: Promise<PluginRuntimeEndpoint>
}

/**
 * MySSH 的受控 companion process 宿主。
 *
 * runtime 只能通过 descriptor 和不透明 capability 进入这里；宿主固定 loopback、动态端口和临时 token，
 * 不接受插件自定义 shell、host、port 或任意环境变量。
 */
export class PluginRuntimeManager {
  private readonly records = new Map<string, RuntimeRecord>()
  private readonly starts = new Map<string, Promise<PluginRuntimeEndpoint>>()
  private readonly capabilities = new Map<string, string>()
  private readonly stopping = new Set<string>()
  private disposed = false
  private readonly events = new EventEmitter()
  private readonly timeoutMs: number
  private readonly spawnProcess: typeof spawn

  constructor(private readonly options: PluginRuntimeManagerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  async issueCapability(pluginId: string): Promise<string> {
    const descriptor = await this.options.resolveRuntime(pluginId)
    if (!descriptor.official) throw new Error('当前仅允许官方插件启动 companion runtime')
    if (descriptor.kind !== 'node-companion-v1') throw new Error(`不支持的 runtime:${descriptor.kind}`)
    if (descriptor.transport !== 'websocket') throw new Error(`不支持的 runtime 传输:${descriptor.transport}`)
    const capability = randomBytes(32).toString('hex')
    this.capabilities.set(capability, pluginId)
    return capability
  }

  async getEndpoint(capability: string): Promise<PluginRuntimeEndpoint> {
    const pluginId = this.capabilities.get(capability)
    if (!pluginId) throw new Error('companion runtime capability 无效或已过期')
    const existing = this.records.get(pluginId)
    if (existing?.state === 'ready' && existing.endpoint) return existing.endpoint
    if (existing?.state === 'starting' && existing.startPromise) return existing.startPromise

    const pending = this.starts.get(pluginId)
    if (pending) return pending
    const start = this.startEndpoint(pluginId)
    this.starts.set(pluginId, start)
    try {
      return await start
    } finally {
      if (this.starts.get(pluginId) === start) this.starts.delete(pluginId)
    }
  }

  private async startEndpoint(pluginId: string): Promise<PluginRuntimeEndpoint> {
    const existing = this.records.get(pluginId)
    if (existing?.state === 'ready' && existing.endpoint) return existing.endpoint
    if (existing?.state === 'starting' && existing.startPromise) return existing.startPromise

    const descriptor = await this.options.resolveRuntime(pluginId)
    if (this.disposed || this.stopping.has(pluginId)) throw new Error('companion runtime 正在停止')
    if (!descriptor.official) throw new Error('当前仅允许官方插件启动 companion runtime')
    if (descriptor.kind !== 'node-companion-v1') throw new Error(`不支持的 runtime:${descriptor.kind}`)
    if (descriptor.transport !== 'websocket') throw new Error(`不支持的 runtime 传输:${descriptor.transport}`)

    const token = randomBytes(32).toString('hex')
    const inheritedEnv: NodeJS.ProcessEnv = {}
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR']) {
      if (process.env[key]) inheritedEnv[key] = process.env[key]
    }
    const child = this.spawnProcess(this.options.executablePath, ['--no-warnings', descriptor.runtimePath], {
      env: {
        // Electron 二进制在子进程中以 Node 兼容模式执行纯 JS bundle；不继承用户凭据环境变量。
        ...inheritedEnv,
        ELECTRON_RUN_AS_NODE: '1',
        MYSSH_RUNTIME_PROTOCOL: 'node-companion-v1',
        MYSSH_RUNTIME_PLUGIN_ID: pluginId,
        MYSSH_RUNTIME_HOST: '127.0.0.1',
        MYSSH_RUNTIME_PORT: '0',
        MYSSH_RUNTIME_TOKEN: token,
        ACCESS_TOKEN: token,
        ALLOWED_ORIGINS: `null,myssh-plugin://${pluginId}`
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const record: RuntimeRecord = { pluginId, child, state: 'starting', token }
    this.records.set(pluginId, record)
    this.emitState(record)

    record.startPromise = this.waitForReady(record)
    try {
      return await record.startPromise
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      record.state = 'error'
      record.error = message
      this.emitState(record)
      if (this.records.has(pluginId)) await this.stopPlugin(pluginId)
      throw new Error(message)
    }
  }

  getState(capability: string): PluginRuntimeStateInfo {
    const pluginId = this.capabilities.get(capability)
    if (!pluginId) throw new Error('companion runtime capability 无效或已过期')
    return this.stateForPlugin(pluginId)
  }

  private stateForPlugin(pluginId: string): PluginRuntimeStateInfo {
    const record = this.records.get(pluginId)
    return {
      pluginId,
      state: record?.state ?? 'stopped',
      ...(record?.generation ? { generation: record.generation } : {}),
      ...(record?.error ? { error: record.error } : {})
    }
  }

  onState(cb: (state: PluginRuntimeStateInfo) => void): () => void {
    this.events.on('state', cb)
    return () => this.events.off('state', cb)
  }

  async stop(capability: string): Promise<void> {
    const pluginId = this.capabilities.get(capability)
    if (!pluginId) throw new Error('companion runtime capability 无效或已过期')
    await this.stopPlugin(pluginId)
  }

  private async stopPlugin(pluginId: string): Promise<void> {
    this.stopping.add(pluginId)
    for (const [capability, owner] of this.capabilities) {
      if (owner === pluginId) this.capabilities.delete(capability)
    }
    const pending = this.starts.get(pluginId)
    if (pending && !this.records.has(pluginId)) await pending.catch(() => {})
    const record = this.records.get(pluginId)
    if (record) {
      this.records.delete(pluginId)
      if (!record.child.killed) record.child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        if (record.child.exitCode !== null || record.child.signalCode !== null) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill('SIGKILL')
          resolve()
        }, 2_000)
        record.child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      record.state = 'stopped'
      record.endpoint = undefined
      this.emitState(record)
    }
    this.stopping.delete(pluginId)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.starts.values()].map((start) => start.catch(() => {})))
    await Promise.all([...this.records.keys()].map((pluginId) => this.stopPlugin(pluginId)))
    this.capabilities.clear()
  }

  private waitForReady(record: RuntimeRecord): Promise<PluginRuntimeEndpoint> {
    return new Promise((resolve, reject) => {
      let settled = false
      let stdout = ''
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => finish(() => reject(new Error('companion runtime 启动超时'))), this.timeoutMs)
      const onStdout = (chunk: Buffer | string): void => {
        stdout += chunk.toString()
        const lines = stdout.split(/\r?\n/)
        stdout = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith(READY_PREFIX)) continue
          try {
            const payload = JSON.parse(line.slice(READY_PREFIX.length)) as { port?: number }
            const port = payload.port
            if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
              finish(() => reject(new Error('companion runtime 上报了无效端口')))
              return
            }
            const generation = randomUUID()
            const endpoint: PluginRuntimeEndpoint = {
              transport: 'websocket',
              url: `ws://127.0.0.1:${port}?token=${encodeURIComponent(record.token)}`,
              generation
            }
            record.state = 'ready'
            record.generation = generation
            record.endpoint = endpoint
            record.error = undefined
            this.emitState(record)
            finish(() => resolve(endpoint))
          } catch {
            finish(() => reject(new Error('companion runtime ready 消息格式错误')))
          }
        }
      }
      record.child.stdout?.on('data', onStdout)
      record.child.stderr?.on('data', (chunk: Buffer | string) => {
        // 保留错误输出用于诊断，但不把 runtime 的任意 stdout/stderr 暴露给 renderer。
        if (chunk.toString().trim()) this.events.emit('log', record.pluginId, chunk.toString().trim())
      })
      record.child.once('error', (err) => finish(() => reject(err)))
      record.child.once('exit', (code, signal) => {
        if (settled && this.records.get(record.pluginId) === record) {
          record.state = 'error'
          record.endpoint = undefined
          record.error = `companion runtime 已退出(${code ?? signal ?? 'unknown'})`
          this.emitState(record)
        } else if (!settled) {
          finish(() => reject(new Error(`companion runtime 已退出(${code ?? signal ?? 'unknown'})`)))
        }
      })
    })
  }

  private emitState(record: RuntimeRecord): void {
    this.events.emit('state', this.stateForPlugin(record.pluginId))
  }
}
