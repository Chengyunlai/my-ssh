import { describe, expect, it } from 'vitest'
import { getUpdateSupportReason } from './update-support'

describe('应用更新支持矩阵', () => {
  it('开发模式不启用更新', () => {
    expect(getUpdateSupportReason({ isPackaged: false, platform: 'linux' })).toContain('开发模式')
  })

  it('未签名 macOS 构建改为提示手动下载', () => {
    expect(getUpdateSupportReason({ isPackaged: true, platform: 'darwin' })).toContain('Developer ID')
  })

  it('Windows 和 Linux 打包版本支持自动更新', () => {
    expect(getUpdateSupportReason({ isPackaged: true, platform: 'win32' })).toBeUndefined()
    expect(getUpdateSupportReason({ isPackaged: true, platform: 'linux' })).toBeUndefined()
  })
})
