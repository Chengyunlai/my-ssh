import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { compareVersions } from '@shared/versions'
import type {
  MarketPluginRuntime,
  PluginPlatform,
  PluginRuntimeManifest
} from '@shared/types'

export interface MarketPluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  category?: string
  minAppVersion?: string
  maxAppVersion?: string
  platforms?: PluginPlatform[]
  /** 官方插件标记:仅由市场 registry 构建方(官方清单)加盖 */
  official?: boolean
  defaultEnabled?: boolean
  /** 相对 registry 的入口路径 */
  entry: string
  /** entry 文件的 sha256 */
  sha256: string
  runtime?: MarketPluginRuntime
  /** 主进程解析后的绝对下载地址 */
  entryUrl: string
}

export interface MarketRegistry {
  name: string
  version: string
  plugins: MarketPluginInfo[]
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  category?: string
  minAppVersion?: string
  maxAppVersion?: string
  platforms?: PluginPlatform[]
  /** 官方标记:安装时从 registry 盖章写入 manifest */
  official?: boolean
  runtime?: PluginRuntimeManifest
  defaultEnabled?: boolean
  /** 运行时入口:myssh-plugin://<id>/<version>/entry.js */
  entryUrl: string
}

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

/** Companion runtime 目前只信任官方 Pages registry；签名 registry 另立安全改造。 */
export const OFFICIAL_REGISTRY_URL = 'https://chengyunlai.github.io/my-ssh-plug/registry.json'

function isOfficialRegistry(url: string): boolean {
  try {
    return new URL(url).toString() === OFFICIAL_REGISTRY_URL
  } catch {
    return false
  }
}

const PLATFORM_LABELS: Record<PluginPlatform, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

function platformLabel(p: PluginPlatform): string {
  return PLATFORM_LABELS[p] ?? p
}

async function readUrl(url: string): Promise<Buffer> {
  if (url.startsWith('file://')) return fsp.readFile(new URL(url))
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await net.fetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    })
    if (!res.ok) throw new Error(`下载失败:HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error(`不支持的地址:${url}`)
}

export async function fetchRegistry(url: string): Promise<MarketRegistry> {
  const buf = await readUrl(url)
  const reg = JSON.parse(buf.toString('utf8')) as MarketRegistry
  if (!Array.isArray(reg.plugins)) throw new Error('市场清单格式不正确:缺少 plugins 数组')
  const base = new URL('.', url).toString()
  reg.plugins = reg.plugins.map((p) => ({
    ...p,
    entryUrl: new URL(p.entry, base).toString(),
    ...(p.runtime
      ? { runtime: { ...p.runtime, entryUrl: new URL(p.runtime.entry, base).toString() } }
      : {})
  }))
  return reg
}

export async function listInstalled(): Promise<InstalledPlugin[]> {
  const root = pluginsRoot()
  const out: InstalledPlugin[] = []
  let ids: string[] = []
  try {
    ids = await fsp.readdir(root)
  } catch {
    return out
  }
  for (const id of ids) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(root, id, 'manifest.json'), 'utf8')) as {
        name: string
        version: string
        description: string
        author?: string
        category?: string
        minAppVersion?: string
        maxAppVersion?: string
        platforms?: PluginPlatform[]
        official?: boolean
        defaultEnabled?: boolean
        runtime?: PluginRuntimeManifest
      }
      out.push({
        id,
        name: m.name,
        version: m.version,
        description: m.description,
        author: m.author,
        category: m.category,
        minAppVersion: m.minAppVersion,
        maxAppVersion: m.maxAppVersion,
        platforms: m.platforms,
        official: m.official,
        defaultEnabled: m.defaultEnabled,
        runtime: m.runtime,
        entryUrl: `myssh-plugin://${id}/${m.version}/entry.js`
      })
    } catch {
      // 目录不完整(如安装中断),跳过
    }
  }
  return out
}

/** 从市场安装/更新插件:下载 → sha256 校验 → 写入 userData/plugins/<id>/<version>/ */
export async function install(registryUrl: string, pluginId: string): Promise<InstalledPlugin> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error('插件 id 不合法')
  const reg = await fetchRegistry(registryUrl)
  const info = reg.plugins.find((p) => p.id === pluginId)
  if (!info) throw new Error(`插件 ${pluginId} 不在市场清单中`)
  if (!/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error(`插件版本不合法:${info.version}`)
  if (!info.sha256 || !info.entryUrl) throw new Error('市场清单缺少 entry / sha256 字段')

  // 兼容性校验:插件声明的 MySSH 版本区间必须包含当前应用版本,否则拒绝安装
  const current = app.getVersion()
  if (info.minAppVersion && compareVersions(current, info.minAppVersion) < 0) {
    throw new Error(`插件需要 MySSH ${info.minAppVersion}+(当前 ${current}),请先升级应用`)
  }
  if (info.maxAppVersion && compareVersions(current, info.maxAppVersion) > 0) {
    throw new Error(`插件最高支持 MySSH ${info.maxAppVersion}(当前 ${current}),请升级插件或等待新版本`)
  }

  // 平台校验:插件声明了支持平台时,当前环境不在其中则拒绝安装
  if (info.platforms?.length && !info.platforms.includes(process.platform as PluginPlatform)) {
    throw new Error(
      `插件仅支持 ${info.platforms.map(platformLabel).join(' / ')},当前平台不满足要求`
    )
  }

  const buf = await readUrl(info.entryUrl)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== info.sha256) throw new Error(`插件包校验失败:${pluginId}@${info.version}`)

  const root = pluginsRoot()
  const pluginDir = path.join(root, pluginId)
  const dir = path.join(pluginDir, info.version)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'entry.js'), buf)

  const trustedOfficial = isOfficialRegistry(registryUrl) && info.official === true
  let installedRuntime: PluginRuntimeManifest | undefined
  if (info.runtime && trustedOfficial) {
    if (info.runtime.kind !== 'node-companion-v1') {
      throw new Error(`不支持的插件后台运行时:${info.runtime.kind}`)
    }
    if (info.runtime.lifecycle && info.runtime.lifecycle !== 'on-demand') {
      throw new Error(`暂不支持的插件 runtime 生命周期:${info.runtime.lifecycle}`)
    }
    if (!info.runtime.entryUrl || !info.runtime.sha256) {
      throw new Error(`插件 ${pluginId} 的 runtime 缺少 entry / sha256`)
    }
    const runtimeBuf = await readUrl(info.runtime.entryUrl)
    const runtimeSha = createHash('sha256').update(runtimeBuf).digest('hex')
    if (runtimeSha !== info.runtime.sha256) {
      throw new Error(`插件 runtime 校验失败:${pluginId}@${info.version}`)
    }
    if (info.runtime.size !== undefined && runtimeBuf.length !== info.runtime.size) {
      throw new Error(`插件 runtime 大小校验失败:${pluginId}@${info.version}`)
    }
    const runtimeEntry = safeRelativePath(info.runtime.entry)
    const runtimePath = path.join(dir, runtimeEntry)
    await fsp.mkdir(path.dirname(runtimePath), { recursive: true })
    await fsp.writeFile(runtimePath, runtimeBuf)
    installedRuntime = {
      kind: info.runtime.kind,
      entry: runtimeEntry,
      sha256: info.runtime.sha256,
      ...(info.runtime.size === undefined ? {} : { size: info.runtime.size }),
      ...(info.runtime.lifecycle ? { lifecycle: info.runtime.lifecycle } : {}),
      transport: info.runtime.transport
    }
  }

  // 清理旧版本,避免磁盘堆积
  try {
    const versions = await fsp.readdir(pluginDir)
    await Promise.all(
      versions
        .filter((v) => v !== info.version && v !== 'manifest.json')
        .map((v) => fsp.rm(path.join(pluginDir, v), { recursive: true, force: true }))
    )
  } catch {
    // 忽略清理失败
  }

  const manifest = {
    id: pluginId,
    name: info.name,
    version: info.version,
    description: info.description,
    author: info.author,
    category: info.category,
    minAppVersion: info.minAppVersion,
    maxAppVersion: info.maxAppVersion,
    platforms: info.platforms,
    official: trustedOfficial,
    registryUrl: isOfficialRegistry(registryUrl) ? OFFICIAL_REGISTRY_URL : undefined,
    defaultEnabled: info.defaultEnabled,
    ...(installedRuntime ? { runtime: installedRuntime } : {})
  }
  await fsp.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  return { ...manifest, entryUrl: `myssh-plugin://${pluginId}/${info.version}/entry.js` }
}

/** 只允许 runtime 在当前插件版本目录内使用相对路径。 */
function safeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`插件 runtime 路径不安全:${value}`)
  }
  return normalized
}

export interface InstalledRuntimeInfo {
  pluginId: string
  official: boolean
  runtime: PluginRuntimeManifest
  runtimePath: string
}

/** 供主进程 runtime manager 使用；不把任意插件路径直接暴露给 renderer。 */
export async function getInstalledRuntime(pluginId: string): Promise<InstalledRuntimeInfo> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error('插件 id 不合法')
  const pluginDir = path.join(pluginsRoot(), pluginId)
  const manifest = JSON.parse(
    await fsp.readFile(path.join(pluginDir, 'manifest.json'), 'utf8')
  ) as {
    id?: string
    version?: string
    official?: boolean
    registryUrl?: string
    runtime?: PluginRuntimeManifest
  }
  if (manifest.id !== pluginId || !manifest.version || !manifest.runtime) {
    throw new Error(`插件 ${pluginId} 未声明 companion runtime`)
  }
  if (manifest.official !== true || manifest.registryUrl !== OFFICIAL_REGISTRY_URL) {
    throw new Error('当前仅允许 MySSH 官方 registry 的插件启动 companion runtime')
  }
  const entry = safeRelativePath(manifest.runtime.entry)
  const runtimePath = path.resolve(pluginDir, manifest.version, entry)
  const versionRoot = path.resolve(pluginDir, manifest.version)
  if (!runtimePath.startsWith(versionRoot + path.sep)) throw new Error('插件 runtime 路径越界')
  await fsp.access(runtimePath)
  const runtimeBuf = await fsp.readFile(runtimePath)
  const runtimeSha = createHash('sha256').update(runtimeBuf).digest('hex')
  if (runtimeSha !== manifest.runtime.sha256) throw new Error(`插件 runtime 校验失败:${pluginId}`)
  if (manifest.runtime.size !== undefined && runtimeBuf.length !== manifest.runtime.size) {
    throw new Error(`插件 runtime 大小校验失败:${pluginId}`)
  }
  return {
    pluginId,
    official: true,
    runtime: { ...manifest.runtime, entry },
    runtimePath
  }
}
