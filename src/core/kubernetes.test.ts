import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { KubernetesClient, parseKubernetesTargets, parsePodMetrics } from './kubernetes'

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => mocks)
const fixture = readFileSync(new URL('./fixtures/kubernetes-resources.json', import.meta.url), 'utf8')
const config = JSON.stringify({ contexts: [{ name: 'test' }], users: [{ user: { token: 'hidden' } }] })
function child() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
}
beforeEach(() => {
  mocks.execFile.mockReset()
  mocks.spawn.mockReset()
  mocks.execFile.mockImplementation((_binary, args, _options, callback) => {
    const process = child()
    queueMicrotask(() => callback(null, args.includes('view') ? config : fixture, ''))
    return process
  })
})

describe('Kubernetes resource collection', () => {
  it('maps sanitized live resource shapes, selectors, health and database evidence', () => {
    const targets = parseKubernetesTargets(fixture, 'config', 'test')
    expect(targets.length).toBe(15)
    expect(targets.filter((target) => target.database === 'postgresql')).toHaveLength(1)
    expect(targets.filter((target) => target.database === 'redis')).toHaveLength(1)
    expect(targets.find((target) => target.database === 'postgresql')).toMatchObject({ port: 5432, forwardable: true, pods: [{ phase: 'Running', ready: true }] })
    expect(JSON.stringify(targets)).not.toMatch(/undefined|NaN|hidden|environment/)
  })
  it('does not infer MySQL from a port, forward selectorless services or mix namespaces', () => {
    const targets = parseKubernetesTargets(JSON.stringify({ items: [
      { kind: 'Service', metadata: { name: 'db', namespace: 'one' }, spec: { ports: [{ port: 3306 }, { port: 53, protocol: 'UDP' }] } },
      { kind: 'Pod', metadata: { name: 'mysql', namespace: 'two' }, spec: { containers: [{ image: 'mysql:8' }] }, status: { phase: 'Running' } }
    ] }), 'config', 'test')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ database: 'unknown', forwardable: false, pods: [] })
  })
  it('rejects missing resource lists rather than reporting an empty cluster', () => {
    expect(() => parseKubernetesTargets('{}', 'c', 'test')).toThrow('资源列表')
  })
  it('uses explicit context/namespace without changing global configuration', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    await client.discover(imported.id, 'test', 'team')
    const snapshot = mocks.execFile.mock.calls.at(-1)?.[1][1] as string
    expect(JSON.parse(readFileSync(snapshot, 'utf8')).users[0].user.token).toBe('hidden')
    if (process.platform !== 'win32') expect(statSync(snapshot).mode & 0o777).toBe(0o600)
    expect(mocks.execFile.mock.calls.at(-1)?.[1]).toEqual(['--kubeconfig', expect.stringMatching(/myssh-kube-.*config.json$/), '--context', 'test', '--request-timeout=15s', 'get', 'services,pods', '--namespace', 'team', '-o', 'json'])
    await expect(client.discover(imported.id, 'test', 'bad;command')).rejects.toThrow('格式')
    await expect(client.discover('other-window', 'test', '')).rejects.toThrow('重新导入')
    client.dispose()
    expect(existsSync(snapshot)).toBe(false)
  })
  it('refuses exec authentication and does not expose config contents', async () => {
    mocks.execFile.mockImplementation((_binary, _args, _options, callback) => {
      queueMicrotask(() => callback(null, JSON.stringify({ users: [{ user: { exec: { command: 'danger' } } }] }), ''))
      return child()
    })
    await expect(new KubernetesClient().importConfig('/tmp/config')).rejects.toThrow('不执行凭据插件')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('accepts kubectl normalized configs without authentication entries', async () => {
    mocks.execFile.mockImplementation((_binary, _args, _options, callback) => {
      queueMicrotask(() => callback(null, JSON.stringify({ contexts: [{ name: 'local' }], users: null }), ''))
      return child()
    })
    const client = new KubernetesClient()
    expect((await client.importConfig('/tmp/local-config')).contexts).toEqual(['local'])
    client.dispose()
  })
  it('restores a saved snapshot without reading the original file, rejects executable auth and revokes forgotten targets', async () => {
    const client = new KubernetesClient()
    const config = await client.importConfig('/tmp/original-config')
    const snapshot = client.exportConfig(config.id)
    client.dispose()
    const restored = new KubernetesClient()
    mocks.execFile.mockClear()
    expect(restored.restoreConfig(snapshot)).toEqual(config)
    expect(mocks.execFile).not.toHaveBeenCalled()
    const targets = await restored.discover(config.id, 'test', '')
    const temporaryPath = mocks.execFile.mock.calls.at(-1)?.[1][1] as string
    restored.forgetConfig(config.id)
    expect(existsSync(temporaryPath)).toBe(false)
    expect(restored.targets()).toEqual([])
    await expect(restored.forward(targets[0].id)).rejects.toThrow('刷新服务')
    await expect(restored.discover(config.id, 'test', '')).rejects.toThrow('重新导入')
    expect(() => restored.restoreConfig({ ...snapshot, json: JSON.stringify({ contexts: [{ name: 'test' }], users: [{ user: { exec: { command: 'unsafe' } } }] }) })).toThrow('不执行凭据插件')
    restored.dispose()
  })
  it('reports unauthorized separately from an empty discovery result', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    mocks.execFile.mockImplementation((_binary, _args, _options, callback) => {
      queueMicrotask(() => callback(new Error('failure'), '', 'Unauthorized: hidden-credential'))
      return child()
    })
    await expect(client.discover(imported.id, 'test', '')).rejects.toThrow('凭据失效')
    client.dispose()
  })
  it('waits for split readiness output, binds loopback, observes close and cleans children', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    const targets = await client.discover(imported.id, 'test', '')
    const process = child()
    mocks.spawn.mockReturnValue(process)
    const pending = client.forward(targets.find((target) => target.database === 'postgresql')!.id)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled())
    expect(mocks.spawn.mock.calls[0][1]).toContain('--address=127.0.0.1')
    expect(mocks.spawn.mock.calls[0][1]).not.toContain('--request-timeout=15s')
    process.stdout.emit('data', Buffer.from('Forwarding from 127.'))
    process.stdout.emit('data', Buffer.from('0.0.1:40123 -> 5432\n'))
    const tunnel = await pending
    expect(tunnel).toMatchObject({ host: '127.0.0.1', port: 40123, state: 'ready' })
    process.emit('close', 1)
    expect(client.forwards()[0].state).toBe('closed')
    client.stop(tunnel.id)
    expect(process.kill).toHaveBeenCalled()
    expect(client.forwards()).toEqual([])
    client.dispose()
    await expect(client.importConfig('/tmp/config')).rejects.toThrow('宿主已关闭')
  })
  it('forgetting a config closes its active tunnel even after the service disappears on refresh', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    const targets = await client.discover(imported.id, 'test', '')
    const process = child()
    mocks.spawn.mockReturnValue(process)
    const pending = client.forward(targets.find((target) => target.forwardable)!.id)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled())
    process.stdout.emit('data', Buffer.from('Forwarding from 127.0.0.1:40123 -> 5432\n'))
    await pending
    mocks.execFile.mockImplementation((_binary, _args, _options, callback) => {
      queueMicrotask(() => callback(null, '{"items":[]}', ''))
      return child()
    })
    await client.discover(imported.id, 'test', '')
    client.forgetConfig(imported.id)
    expect(process.kill).toHaveBeenCalled()
    expect(client.forwards()).toEqual([])
    client.dispose()
  })
  it('kills a forwarding process on start failure without leaking its output', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    const targets = await client.discover(imported.id, 'test', '')
    const process = child()
    mocks.spawn.mockReturnValue(process)
    const pending = client.forward(targets.find((target) => target.forwardable)!.id)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled())
    process.stderr.emit('data', Buffer.from('Forbidden hidden-credential'))
    await expect(pending).rejects.toThrow('权限不足')
    expect(process.kill).toHaveBeenCalled()
    expect(client.forwards()).toEqual([])
    client.dispose()
  })
})


describe('Pod observation boundaries', () => {
  it('normalizes documented Kubernetes quantities and rejects missing/invalid metrics', () => {
    const json = JSON.stringify({ metadata: { name: 'pod' }, timestamp: '2026-10-22T00:00:00Z', window: '30s', containers: [
      { name: 'app', usage: { cpu: '12000000n', memory: '32Mi' } },
      { name: 'sidecar', usage: { cpu: '250m', memory: '1024Ki' } }
    ] })
    expect(parsePodMetrics(json, 'pod').containers).toEqual([
      { name: 'app', cpuMillicores: 12, memoryBytes: 33554432 },
      { name: 'sidecar', cpuMillicores: 250, memoryBytes: 1048576 }
    ])
    expect(() => parsePodMetrics(json.replace('12000000n', 'bad'), 'pod')).toThrow('格式无效')
    expect(() => parsePodMetrics(json, 'different-pod')).toThrow('格式无效')
    expect(() => parsePodMetrics('{}', 'pod')).toThrow('格式无效')
  })
  it('requires registered pod/container and constrains log options, size and command arguments', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    const json = JSON.parse(fixture)
    for (const item of json.items) if (item.kind === 'Pod') for (const container of item.spec.containers) container.name = 'app'
    mocks.execFile.mockImplementation((_binary, args, _options, callback) => {
      queueMicrotask(() => callback(null, args.includes('logs') ? '<script>untrusted</script>\nlog line' : JSON.stringify(json), ''))
      return child()
    })
    const targets = await client.discover(imported.id, 'test', '')
    const target = targets.find((item) => item.pods.length)!
    const pod = target.pods[0].name
    const options = { tailLines: 300, sinceSeconds: 3600, previous: true }
    await expect(client.logs(target.id, 'other-pod', 'app', options)).rejects.toThrow('关联 Pod')
    await expect(client.logs(target.id, pod, '--all-containers', options)).rejects.toThrow('有效容器')
    await expect(client.logs(target.id, pod, 'app', { ...options, tailLines: -1 })).rejects.toThrow('参数无效')
    expect(await client.logs(target.id, pod, 'app', options)).toMatchObject({ text: '<script>untrusted</script>\nlog line', possiblyTruncated: false })
    expect(mocks.execFile.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['logs', pod, '--container', 'app', '--tail=300', '--since=3600s', '--limit-bytes=262144', '--previous=true']))
    client.dispose()
  })
  it('reports metrics RBAC failure instead of synthesizing zero usage', async () => {
    const client = new KubernetesClient()
    const imported = await client.importConfig('/tmp/config')
    const targets = await client.discover(imported.id, 'test', '')
    const target = targets.find((item) => item.pods.length)!
    mocks.execFile.mockImplementation((_binary, _args, _options, callback) => {
      queueMicrotask(() => callback(new Error('failure'), '', 'Forbidden: sensitive-diagnostic'))
      return child()
    })
    await expect(client.metrics(target.id, target.pods[0].name)).rejects.toThrow('权限不足')
    client.dispose()
  })

})
