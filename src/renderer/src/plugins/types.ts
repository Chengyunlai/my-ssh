import type { ComponentType } from 'react'
import type { PluginPlatform, Profile } from '@shared/types'

export interface SessionPanelProps {
  sessionId: string
  profile: Profile
  /** 面板是否为当前可见标签;可见瞬间可用于主动刷新,避免数据过期 */
  active?: boolean
}

export type AppPanelProps = Record<string, never>

export type WidgetPlacement = 'terminal-bottom'

/**
 * 面板在宿主内容区中的布局级别。
 * standard 适合普通表单/列表；workspace 适合带内部导航和工作区的重型插件。
 */
export type PanelLayout = 'standard' | 'workspace'

export interface MySshPlugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  /** 分类(官方分类表);外部插件以安装清单为准 */
  category?: string
  /** 兼容 MySSH 版本区间;外部插件以安装清单为准 */
  minAppVersion?: string
  maxAppVersion?: string
  /** 支持的运行平台;缺省表示全平台,外部插件以安装清单为准 */
  platforms?: PluginPlatform[]
  /** 官方插件标记:内置插件由核心仓库声明;外部插件以安装清单为准 */
  official?: boolean
  /** 随应用内置分发(仍可被用户禁用) */
  builtin?: boolean
  /** 首次启动默认状态,缺省为启用 */
  defaultEnabled?: boolean
  /** 面板标签页 */
  panel?: {
    title: string
    /** app:无需会话即可使用;session(默认):会话激活时显示 */
    scope?: 'app' | 'session'
    /** 宿主布局约束；缺省为 standard 以兼容既有插件 */
    layout?: PanelLayout
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
