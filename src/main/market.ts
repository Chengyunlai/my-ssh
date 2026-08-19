import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { compareVersions } from '@shared/versions'

export interface MarketPluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  category?: string
  minAppVersion?: string
  maxAppVersion?: string
  /** 官方插件标记:仅由市场 registry 构建方(官方清单)加盖 */
  official?: boolean
  defaultEnabled?: boolean
  /** 相对 registry 的入口路径 */
  entry: string
  /** entry 文件的 sha256 */
  sha256: string
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
  /** 官方标记:安装时从 registry 盖章写入 manifest */
  official?: boolean
  defaultEnabled?: boolean
  /** 运行时入口:myssh-plugin://<id>/<version>/entry.js */
  entryUrl: string
}

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

async function readUrl(url: string): Promise<Buffer> {
  if (url.startsWith('file://')) return fsp.readFile(new URL(url))
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await net.fetch(url)
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
  reg.plugins = reg.plugins.map((p) => ({ ...p, entryUrl: new URL(p.entry, base).toString() }))
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
        official?: boolean
        defaultEnabled?: boolean
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
        official: m.official,
        defaultEnabled: m.defaultEnabled,
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
  const reg = await fetchRegistry(registryUrl)
  const info = reg.plugins.find((p) => p.id === pluginId)
  if (!info) throw new Error(`插件 ${pluginId} 不在市场清单中`)
  if (!info.sha256 || !info.entryUrl) throw new Error('市场清单缺少 entry / sha256 字段')

  // 兼容性校验:插件声明的 MySSH 版本区间必须包含当前应用版本,否则拒绝安装
  const current = app.getVersion()
  if (info.minAppVersion && compareVersions(current, info.minAppVersion) < 0) {
    throw new Error(`插件需要 MySSH ${info.minAppVersion}+(当前 ${current}),请先升级应用`)
  }
  if (info.maxAppVersion && compareVersions(current, info.maxAppVersion) > 0) {
    throw new Error(`插件最高支持 MySSH ${info.maxAppVersion}(当前 ${current}),请升级插件或等待新版本`)
  }

  const buf = await readUrl(info.entryUrl)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== info.sha256) throw new Error(`插件包校验失败:${pluginId}@${info.version}`)

  const root = pluginsRoot()
  const pluginDir = path.join(root, pluginId)
  const dir = path.join(pluginDir, info.version)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'entry.js'), buf)

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
    official: info.official,
    defaultEnabled: info.defaultEnabled
  }
  await fsp.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  return { ...manifest, entryUrl: `myssh-plugin://${pluginId}/${info.version}/entry.js` }
}
