import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { TerminalPluginMarket } from './plugin-market'
import { validateTuiPlugin } from '../shared/tui-plugin'
import { createServer } from 'node:http'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-market-'))
  const bytes = Buffer.from(JSON.stringify({ schema: 1, id: 'command-book', contributions: [{ kind: 'commands', categories: [{ name: 'Demo', commands: [{ command: 'hello', description: 'Fixture command' }] }] }] }))
  fs.writeFileSync(path.join(directory, 'terminal.json'), bytes)
  const manifest = { id: 'command-book', name: 'Commands', version: '1.2.0', description: 'Demo', official: true,
    tui: { kind: 'tui-declarative-v1', minAppVersion: '1.5.0', entry: 'terminal.json', sha256: createHash('sha256').update(bytes).digest('hex') } }
  const registry = path.join(directory, 'registry.json')
  const write = () => fs.writeFileSync(registry, JSON.stringify({ plugins: [manifest] }))
  write()
  return { directory, manifest, write, source: pathToFileURL(registry).href, market: new TerminalPluginMarket(path.join(directory, 'installed'), '1.5.0') }
}

describe('declarative terminal plugin market', () => {
  it('aborts active downloads when its host is disposed', async () => {
    const f = fixture()
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    const server = createServer((_request, response) => { response.writeHead(200); response.write('{'); started() })
    server.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    try {
      const port = (server.address() as { port: number }).port
      const pending = f.market.registry(`http://127.0.0.1:${port}/registry.json`)
      const rejected = expect(pending).rejects.toThrow()
      await requestStarted
      f.market.dispose()
      await rejected
      await expect(f.market.registry(f.source)).rejects.toThrow('已关闭')
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
  it('installs checked JSON with default disable, preserves enable on upgrade and uninstalls', async () => {
    const f = fixture()
    try {
      expect((await f.market.registry(f.source))[0].official).toBe(false)
      await f.market.install(f.source, 'command-book')
      expect(f.market.list()[0].enabled).toBe(false)
      f.market.setEnabled('command-book', true)
      f.manifest.version = '1.3.0'; f.write()
      await f.market.install(f.source, 'command-book')
      expect(f.market.list()[0]).toMatchObject({ enabled: true, version: '1.3.0' })
      f.market.setEnabled('command-book', false)
      expect(f.market.list()[0].enabled).toBe(false)
      f.market.remove('command-book')
      expect(f.market.list()).toEqual([])
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
  it('rejects hash mismatch, traversal, executable protocols and version/platform mismatch', async () => {
    const f = fixture()
    try {
      f.manifest.tui.sha256 = '0'.repeat(64); f.write()
      await expect(f.market.install(f.source, 'command-book')).rejects.toThrow('校验')
      f.manifest.tui.entry = '../outside.json'; f.write()
      await expect(f.market.install(f.source, 'command-book')).rejects.toThrow('路径')
      f.manifest.tui.entry = 'file:///outside.json'; f.write()
      await expect(f.market.install(f.source, 'command-book')).rejects.toThrow('路径')
      f.manifest.tui.minAppVersion = '9.0.0'; f.write()
      await expect(f.market.install(f.source, 'command-book')).rejects.toThrow('9.0.0')
      expect(f.market.support({ ...f.manifest, tui: undefined })).toBe('尚无终端入口')
      expect(() => validateTuiPlugin({ schema: 1, id: 'command-book', contributions: [{ kind: 'javascript', entry: 'evil.cjs' }] }, 'command-book')).toThrow('不支持')
      await expect(f.market.registry('https://user:password@example.invalid/registry.json')).rejects.toThrow('凭据')
      await expect(f.market.registry('http://example.invalid/registry.json')).rejects.toThrow('HTTPS')
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
  it('reports corrupt installed files and permits repair without blocking healthy plugins', async () => {
    const f = fixture()
    try {
      await f.market.install(f.source, 'command-book')
      fs.writeFileSync(path.join(f.directory, 'installed/command-book.json'), 'broken')
      expect(f.market.list()).toEqual([])
      expect(f.market.errors[0].id).toBe('command-book')
      await f.market.install(f.source, 'command-book')
      expect(f.market.list()).toHaveLength(1)
      expect(f.market.errors).toEqual([])
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
  it('rejects excessive input and terminal control commands', async () => {
    const f = fixture()
    try {
      fs.writeFileSync(path.join(f.directory, 'registry.json'), Buffer.alloc(1024 * 1024 + 1))
      await expect(f.market.registry(f.source)).rejects.toThrow('1 MiB')
      expect(() => validateTuiPlugin({ schema: 1, id: 'command-book', contributions: [{ kind: 'commands', categories: [{ name: 'Demo', commands: [{ command: 'hello\nrm -rf /', description: 'bad' }] }] }] }, 'command-book')).toThrow('命令条目')
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
})
