import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  userData: string
}

export interface StorageInfo {
  /** userData 目录总占用 */
  total: number
  /** Chromium 缓存目录占用(Cache / GPUCache 等,可安全清理) */
  cache: number
  /** 连接配置 profiles.json 占用 */
  profiles: number
  /** 各插件数据目录占用 userData/plugins/<id>/ */
  plugins: Record<string, number>
}

/** Chromium 可安全清理的缓存目录 */
const CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache'
]

export function appInfo(): AppInfo {
  return {
    name: 'MySSH',
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    userData: app.getPath('userData')
  }
}

async function dirSize(dir: string): Promise<number> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return 0
  }
  const sizes = await Promise.all(
    names.map(async (name) => {
      const p = path.join(dir, name)
      try {
        const st = await fsp.stat(p)
        return st.isDirectory() ? dirSize(p) : st.isFile() ? st.size : 0
      } catch {
        return 0
      }
    })
  )
  return sizes.reduce((a, b) => a + b, 0)
}

async function fileSize(p: string): Promise<number> {
  try {
    const st = await fsp.stat(p)
    return st.isFile() ? st.size : 0
  } catch {
    return 0
  }
}

async function removeDirs(root: string, names: string[]): Promise<number> {
  let freed = 0
  for (const name of names) {
    const p = path.join(root, name)
    freed += await dirSize(p)
    await fsp.rm(p, { recursive: true, force: true }).catch(() => {})
  }
  return freed
}

export async function scan(pluginIds: string[]): Promise<StorageInfo> {
  const userData = app.getPath('userData')
  const pluginsRoot = path.join(userData, 'plugins')
  const pluginSizes = await Promise.all(pluginIds.map((id) => dirSize(path.join(pluginsRoot, id))))
  const plugins: Record<string, number> = {}
  pluginIds.forEach((id, i) => {
    plugins[id] = pluginSizes[i]
  })
  const [total, cache, profiles] = await Promise.all([
    dirSize(userData),
    Promise.all(CACHE_DIRS.map((d) => dirSize(path.join(userData, d)))).then((s) =>
      s.reduce((a, b) => a + b, 0)
    ),
    fileSize(path.join(userData, 'profiles.json'))
  ])
  return { total, cache, profiles, plugins }
}

/** 清理 Chromium 缓存目录,返回释放的字节数 */
export async function cleanCache(): Promise<{ freed: number }> {
  const userData = app.getPath('userData')
  return { freed: await removeDirs(userData, CACHE_DIRS) }
}

/** 清理指定插件的本地数据(userData/plugins/<id>/),返回释放的字节数 */
export async function cleanPlugin(pluginId: string): Promise<{ freed: number }> {
  const p = path.join(app.getPath('userData'), 'plugins', pluginId)
  const freed = await dirSize(p)
  await fsp.rm(p, { recursive: true, force: true }).catch(() => {})
  return { freed }
}
