import type { MySshPlugin } from './types'

/**
 * 内置插件注册表:自动扫描 src/renderer/src/plugins/<id>/index.ts,
 * 随应用打包分发,只能禁用、不可卸载。
 */
const modules = import.meta.glob('./*/index.ts', { eager: true }) as Record<
  string,
  { default: MySshPlugin }
>

export const builtinPlugins: MySshPlugin[] = Object.values(modules)
  .map((m) => m.default)
  .filter((p): p is MySshPlugin => Boolean(p && p.id))
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * 外部插件:由 my-ssh-plug 市场发布,运行时下载到 userData/plugins/<id>/<version>/,
 * 通过自定义协议 myssh-plugin:// 动态 import 加载,可独立安装 / 更新 / 卸载。
 */
let externalPlugins: MySshPlugin[] = []
let refreshPromise: Promise<MySshPlugin[]> | null = null

export function getPlugins(): MySshPlugin[] {
  return [...builtinPlugins, ...externalPlugins]
}

/**
 * 刷新外部插件。并发调用(React StrictMode 双执行 effect、安装/卸载后的刷新)
 * 共享同一次加载,避免异步 push 交错导致同一插件出现多份。
 */
export function refreshExternalPlugins(): Promise<MySshPlugin[]> {
  if (refreshPromise) return refreshPromise
  refreshPromise = loadExternalPlugins().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function loadExternalPlugins(): Promise<MySshPlugin[]> {
  const loaded: MySshPlugin[] = []
  try {
    const installed = await window.ssh.marketListInstalled()
    await Promise.all(
      installed.map(async (info) => {
        try {
          // 运行时 URL(myssh-plugin://),无法静态分析,需显式 vite-ignore
          const mod = (await import(/* @vite-ignore */ info.entryUrl)) as { default?: unknown }
          const p = mod.default as MySshPlugin
          if (p && p.id && !loaded.some((x) => x.id === p.id)) {
            loaded.push({ ...p, builtin: false })
          }
        } catch (err) {
          console.error(`[plugin] 加载失败 ${info.id}@${info.version}:`, err)
        }
      })
    )
  } catch (err) {
    console.error('[plugin] 读取已安装插件失败:', err)
  }
  externalPlugins = loaded
  return getPlugins()
}

const STORAGE_KEY = 'myssh:plugin-states'

export type PluginStates = Record<string, boolean>

export function loadPluginStates(): PluginStates {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PluginStates
  } catch {
    return {}
  }
}

export function savePluginState(id: string, enabled: boolean): void {
  const states = loadPluginStates()
  states[id] = enabled
  localStorage.setItem(STORAGE_KEY, JSON.stringify(states))
}

export function isPluginEnabled(p: MySshPlugin): boolean {
  return loadPluginStates()[p.id] ?? p.defaultEnabled ?? true
}
