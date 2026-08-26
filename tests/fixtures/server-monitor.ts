import type { SshApi } from '../../src/shared/types'

export type ServerMonitorHostApi = Pick<SshApi, 'monitor'>

/**
 * 最小外部插件接入 fixture：验证 session 插件只需 sessionId 即可取得结构化快照。
 * 正式 UI 和市场清单在 my-ssh-plug 仓库维护。
 */
export async function readServerMonitorFixture(
  api: ServerMonitorHostApi,
  sessionId: string
): ReturnType<ServerMonitorHostApi['monitor']['getSnapshot']> {
  return api.monitor.getSnapshot(sessionId)
}
