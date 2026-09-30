import type { SshApi } from '../../src/shared/types'

export type ServerServicesHostApi = Pick<SshApi, 'serviceScan'>

/**
 * 最小外部插件接入 fixture：验证 session 插件只需 sessionId 即可取得
 * 端口发现结果（监听记录 → 服务 → 应用三级）。
 * 正式 UI 和市场清单在 my-ssh-plug 仓库维护。
 */
export async function readServerServicesFixture(
  api: ServerServicesHostApi,
  sessionId: string
): ReturnType<ServerServicesHostApi['serviceScan']['run']> {
  return api.serviceScan.run(sessionId)
}
