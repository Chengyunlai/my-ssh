import { createElement, type ReactElement, type ReactNode } from 'react'
import type { MySshPlugin, PanelLayout } from './types'

export interface AppPanelHost {
  plugin: MySshPlugin
  active: boolean
}

interface PluginSurfaceProps {
  plugin: MySshPlugin
  children?: ReactNode
}

/** 旧插件未声明布局时继续按 standard 渲染。 */
export function resolvePanelLayout(plugin: MySshPlugin): PanelLayout {
  return plugin.panel?.layout === 'workspace' ? 'workspace' : 'standard'
}

/** MySSH 提供给插件的唯一可视宿主边界。 */
export function PluginSurface({ plugin, children }: PluginSurfaceProps): ReactElement {
  return createElement(
    'div',
    {
      className: 'plugin-surface',
      'data-plugin-id': plugin.id,
      'data-plugin-layout': resolvePanelLayout(plugin)
    },
    children
  )
}

/**
 * app 面板始终保留在宿主树中，只切换可见状态，避免切换标签时销毁插件内部状态。
 */
export function buildAppPanelHosts(
  plugins: MySshPlugin[],
  activePluginId: string | null,
  mountedPluginIds: ReadonlySet<string>
): AppPanelHost[] {
  return plugins
    .filter((plugin) => plugin.panel?.scope === 'app' && mountedPluginIds.has(plugin.id))
    .map((plugin) => ({ plugin, active: activePluginId === plugin.id }))
}
