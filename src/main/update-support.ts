export type UpdatePlatform = 'darwin' | 'win32' | 'linux' | string

/** 返回当前构建不能使用应用内更新时应展示给用户的原因。 */
export function getUpdateSupportReason({
  isPackaged,
  platform
}: {
  isPackaged: boolean
  platform: UpdatePlatform
}): string | undefined {
  if (!isPackaged) return '开发模式不检查更新，请使用打包版本'
  if (platform === 'darwin') return 'macOS 自动更新需要 Developer ID 签名，请下载 DMG 手动更新'
  return undefined
}
