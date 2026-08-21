import type { PluginRuntimeContext } from './types'

/**
 * 为当前插件面板创建最小 capability。插件组件只拿到自己的闭包，不需要知道 IPC channel。
 * 主进程仍会校验安装清单、官方标记和 runtime bundle。
 */
export function createPluginRuntimeContext(pluginId: string, capability?: string): PluginRuntimeContext {
  if (!capability) throw new Error(`插件 ${pluginId} 未获得 companion runtime capability`)
  const getCapability = (): Promise<string> => Promise.resolve(capability)
  const context: PluginRuntimeContext = {
    getEndpoint: async () => window.ssh.pluginRuntime.getEndpoint(await getCapability()),
    getState: async () => window.ssh.pluginRuntime.getState(await getCapability()),
    onState: (callback) => {
      let unsubscribe: (() => void) | null = null
      let cancelled = false
      void getCapability()
        .then((token) => {
          if (cancelled) return
          unsubscribe = window.ssh.pluginRuntime.onState(token, callback)
        })
        .catch(() => {})
      return () => {
        cancelled = true
        unsubscribe?.()
      }
    }
  }
  return context
}
