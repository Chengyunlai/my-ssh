import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PluginRuntimeManager } from './plugin-runtime'

describe('PluginRuntimeManager', () => {
  it('starts an on-demand runtime, consumes its dynamic port and stops it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'myssh-runtime-'))
    const fixture = path.join(dir, 'runtime.mjs')
    await writeFile(
      fixture,
      `import net from 'node:net'
const server = net.createServer()
server.listen(Number(process.env.MYSSH_RUNTIME_PORT), process.env.MYSSH_RUNTIME_HOST, () => {
  console.log('MYSSH_RUNTIME_READY ' + JSON.stringify({ port: server.address().port }))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`
    )
    const manager = new PluginRuntimeManager({
      executablePath: process.execPath,
      resolveRuntime: async () => ({
        pluginId: 'fixture',
        official: true,
        runtimePath: fixture,
        kind: 'node-companion-v1',
        transport: 'websocket'
      })
    })

    try {
      const capability = await manager.issueCapability('fixture')
      const endpoint = await manager.getEndpoint(capability)
      expect(endpoint.transport).toBe('websocket')
      expect(endpoint.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\?token=/)
      expect((await manager.getState(capability)).state).toBe('ready')
      await manager.stop(capability)
      await expect(Promise.resolve().then(() => manager.getState(capability))).rejects.toThrow('capability 无效')
    } finally {
      await manager.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it('rejects non-official runtimes before spawning', async () => {
    const manager = new PluginRuntimeManager({
      executablePath: process.execPath,
      resolveRuntime: async () => ({
        pluginId: 'third-party',
        official: false,
        runtimePath: '/does/not/exist',
        kind: 'node-companion-v1',
        transport: 'websocket'
      })
    })
    await expect(manager.issueCapability('third-party')).rejects.toThrow('仅允许官方插件')
  })
})
