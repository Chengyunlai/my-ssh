import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, Agent, EnvHttpProxyAgent } from 'undici'
import { isVersionSupported } from '../shared/versions'
import { validateTuiPlugin, type TuiPluginDescriptor, type TuiPluginManifest } from '../shared/tui-plugin'

export const OFFICIAL_REGISTRY = 'https://chengyunlai.github.io/my-ssh-plug/registry.json'
const LIMIT = 1024 * 1024
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION = /^\d+\.\d+\.\d+$/
export interface TerminalMarketEntry {
  id: string; name: string; version: string; description: string; official: boolean; platforms?: string[]; tui?: TuiPluginManifest
}
export interface InstalledTerminalPlugin extends TerminalMarketEntry { enabled: boolean; registry: string; descriptor: TuiPluginDescriptor }

function registryUrl(value: string): URL {
  const url = new URL(value)
  if (!['https:', 'file:'].includes(url.protocol) && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('插件市场仅支持 HTTPS、回环 HTTP 或本地 file URL')
  if (url.username || url.password) throw new Error('插件市场地址不能包含凭据')
  return url
}

async function readResource(url: URL, signal: AbortSignal): Promise<Buffer> {
  registryUrl(url.href)
  if (url.protocol === 'file:') {
    const descriptor = fs.openSync(fileURLToPath(url), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
    try {
      const stat = fs.fstatSync(descriptor)
      if (!stat.isFile() || stat.size > LIMIT) throw new Error('插件文件不是普通文件或超过 1 MiB 上限')
      const buffer = Buffer.alloc(LIMIT + 1)
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
      if (length > LIMIT) throw new Error('插件文件超过 1 MiB 上限')
      return buffer.subarray(0, length)
    } finally { fs.closeSync(descriptor) }
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  for (let attempt = 0; attempt < 2; attempt++) {
    deadline.throwIfAborted()
    const options = { connectTimeout: 5000, autoSelectFamily: true }
    const agent = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? new Agent(options) : new EnvHttpProxyAgent(options)
    try {
      const response = await fetch(url, { signal: deadline, redirect: 'error', dispatcher: agent })
      if (!response.ok || !response.body) throw new Error(`插件下载失败 (${response.status})`)
      const chunks: Buffer[] = []
      let length = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > LIMIT) throw new Error('插件文件超过 1 MiB 上限')
          chunks.push(Buffer.from(value))
        }
        return Buffer.concat(chunks)
      } finally { await reader.cancel().catch(() => {}) }
    } catch (error) {
      if (attempt === 1 || deadline.aborted || !(error instanceof TypeError)) throw error
      // One retry for failed GET connections, within the same total deadline.
    } finally { await agent.destroy() }
  }
  throw new Error('插件下载失败')
}

export class TerminalPluginMarket {
  readonly errors: Array<{ id: string; error: string }> = []
  private readonly downloads = new Set<AbortController>()
  private disposed = false
  constructor(private readonly directory: string, private readonly version: string, private readonly platform = process.platform) {}

  async registry(source: string): Promise<TerminalMarketEntry[]> {
    const value = JSON.parse((await this.read(registryUrl(source))).toString('utf8'))
    if (!value || !Array.isArray(value.plugins) || value.plugins.length > 1000) throw new Error('市场清单格式无效')
    const seen = new Set<string>()
    return value.plugins.map((entry: TerminalMarketEntry) => {
      if (!entry || !ID.test(entry.id) || !VERSION.test(entry.version) || typeof entry.name !== 'string' || typeof entry.description !== 'string' || seen.has(entry.id)) throw new Error('市场插件字段无效或重复')
      seen.add(entry.id)
      if (entry.platforms && (!Array.isArray(entry.platforms) || entry.platforms.some((item) => !['darwin', 'win32', 'linux'].includes(item)))) throw new Error('插件平台字段无效')
      return { ...entry, official: source === OFFICIAL_REGISTRY && entry.official === true }
    })
  }

  support(entry: TerminalMarketEntry): string | undefined {
    const tui = entry.tui
    if (!tui) return '尚无终端入口'
    if (tui.kind !== 'tui-declarative-v1' || !VERSION.test(tui.minAppVersion)) return '终端插件协议不支持'
    if (!isVersionSupported(this.version, { min: tui.minAppVersion })) return `需要 MySSH ${tui.minAppVersion}+`
    if (entry.platforms?.length && !entry.platforms.includes(this.platform)) return '当前平台不支持'
    return undefined
  }

  list(): InstalledTerminalPlugin[] {
    this.errors.length = 0
    if (!fs.existsSync(this.directory)) return []
    this.checkDirectory()
    const installed: InstalledTerminalPlugin[] = []
    for (const name of fs.readdirSync(this.directory).filter((name) => name.endsWith('.json') && ID.test(name.slice(0, -5)))) {
      const id = name.slice(0, -5)
      try {
        const filename = this.filename(id)
        if (fs.lstatSync(filename).isSymbolicLink() || fs.statSync(filename).size > 2 * LIMIT) throw new Error('已安装插件文件无效')
        const plugin = JSON.parse(fs.readFileSync(filename, 'utf8')) as InstalledTerminalPlugin
        if (plugin.id !== id || !VERSION.test(plugin.version) || typeof plugin.enabled !== 'boolean' || typeof plugin.name !== 'string' || typeof plugin.description !== 'string' || typeof plugin.registry !== 'string') throw new Error('已安装插件清单无效')
        validateTuiPlugin(plugin.descriptor, id)
        if (createHash('sha256').update(JSON.stringify(plugin.descriptor)).digest('hex') !== plugin.tui?.sha256) throw new Error('已安装终端插件完整性校验失败，请重新安装')
        installed.push(plugin)
      } catch (error) { this.errors.push({ id, error: error instanceof Error ? error.message : String(error) }) }
    }
    return installed
  }

  async install(source: string, id: string): Promise<void> {
    const entries = await this.registry(source)
    const entry = entries.find((entry) => entry.id === id)
    if (!entry) throw new Error('插件不在市场中')
    const unsupported = this.support(entry)
    if (unsupported) throw new Error(unsupported)
    const tui = entry.tui!
    if (!/^[a-f0-9]{64}$/.test(tui.sha256) || !/^[a-z0-9._/-]+$/i.test(tui.entry) || tui.entry.split('/').some((part) => part === '..' || part === '.') || tui.entry.startsWith('/')) throw new Error('终端插件下载路径或校验和无效')
    const base = registryUrl(source)
    const target = new URL(tui.entry, base)
    if (target.origin !== base.origin || target.protocol !== base.protocol) throw new Error('终端插件资源必须与市场同源')
    const bytes = await this.read(target)
    if (createHash('sha256').update(bytes).digest('hex') !== tui.sha256) throw new Error('终端插件下载校验失败')
    const descriptor = validateTuiPlugin(JSON.parse(bytes.toString('utf8')), id)
    const previous = this.list().find((plugin) => plugin.id === id)
    this.write({ ...entry, tui: { ...tui, sha256: createHash('sha256').update(JSON.stringify(descriptor)).digest('hex') }, descriptor, registry: source, enabled: previous?.enabled ?? false })
  }

  setEnabled(id: string, enabled: boolean): void {
    const plugin = this.list().find((plugin) => plugin.id === id)
    if (!plugin) throw new Error('插件未安装')
    this.write({ ...plugin, enabled })
  }

  remove(id: string): void { if (fs.existsSync(this.directory)) this.checkDirectory(); fs.rmSync(this.filename(id), { force: true }) }

  private checkDirectory(): void {
    const stat = fs.lstatSync(this.directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('插件目录必须是真实目录')
  }

  dispose(): void { this.disposed = true; for (const download of this.downloads) download.abort(); this.downloads.clear() }

  private async read(url: URL): Promise<Buffer> {
    if (this.disposed) throw new Error('插件市场已关闭')
    const controller = new AbortController()
    this.downloads.add(controller)
    try { return await readResource(url, controller.signal) }
    finally { this.downloads.delete(controller) }
  }

  private filename(id: string): string {
    if (!ID.test(id)) throw new Error('插件 id 无效')
    return path.join(this.directory, id + '.json')
  }

  private write(plugin: InstalledTerminalPlugin): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.checkDirectory()
    const filename = this.filename(plugin.id)
    const temporary = filename + '.' + randomBytes(8).toString('hex') + '.tmp'
    try {
      fs.writeFileSync(temporary, JSON.stringify(plugin), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, filename)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
}
