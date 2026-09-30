import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from './external-url'

describe('外部打开地址校验', () => {
  it('放行 http / https', () => {
    expect(safeExternalUrl('http://10.0.0.12:8080')).toBe('http://10.0.0.12:8080/')
    expect(safeExternalUrl('https://10.0.0.12:8443')).toBe('https://10.0.0.12:8443/')
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })

  it('放行本地回环地址（隧道入口用就是它）', () => {
    expect(safeExternalUrl('http://127.0.0.1:28443')).toBe('http://127.0.0.1:28443/')
  })

  it('拒绝能落到本机文件系统的协议', () => {
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('smb://host/share')).toBeNull()
  })

  it('拒绝可在其他上下文里执行的协议', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html,<script>1</script>')).toBeNull()
  })

  it('拒绝带凭据的地址 —— 凭据会被写进浏览器历史', () => {
    expect(safeExternalUrl('https://user:pass@example.com')).toBeNull()
  })

  it('拒绝不是地址的字符串', () => {
    expect(safeExternalUrl('10.0.0.12:8080')).toBeNull()
    expect(safeExternalUrl('host:port')).toBeNull()
    expect(safeExternalUrl('')).toBeNull()
    expect(safeExternalUrl('   ')).toBeNull()
  })

  it('拒绝非字符串输入', () => {
    expect(safeExternalUrl(undefined)).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl(8080)).toBeNull()
    expect(safeExternalUrl({ toString: () => 'https://x' })).toBeNull()
  })

  it('拒绝缺主机名的地址', () => {
    // `http://:8080` 在部分系统上会被当成 localhost，含义随环境漂移，不能交给系统
    expect(safeExternalUrl('http://:8080')).toBeNull()
  })

  it('拒绝超长地址', () => {
    expect(safeExternalUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeNull()
  })

  it('两侧空白先裁掉再判断', () => {
    expect(safeExternalUrl('  https://example.com  ')).toBe('https://example.com/')
  })
})
