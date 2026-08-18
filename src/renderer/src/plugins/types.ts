import type { ComponentType } from 'react'
import type { Profile } from '@shared/types'

export interface SessionPanelProps {
  sessionId: string
  profile: Profile
}

export type AppPanelProps = Record<string, never>

export type WidgetPlacement = 'terminal-bottom'

export interface MySshPlugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  /** 随应用内置分发(仍可被用户禁用) */
  builtin?: boolean
  /** 首次启动默认状态,缺省为启用 */
  defaultEnabled?: boolean
  /** 面板标签页 */
  panel?: {
    title: string
    /** app:无需会话即可使用;session(默认):会话激活时显示 */
    scope?: 'app' | 'session'
    Component: ComponentType<SessionPanelProps> | ComponentType<AppPanelProps>
  }
  /** 终端挂件:嵌入终端区域的轻量组件 */
  widget?: {
    placement: WidgetPlacement
    Component: ComponentType<SessionPanelProps>
  }
}

export function definePlugin(plugin: MySshPlugin): MySshPlugin {
  return plugin
}
