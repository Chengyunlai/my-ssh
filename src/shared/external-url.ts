/**
 * 交给系统浏览器打开的地址校验。
 *
 * 存在的理由：服务发现会把远端推来的信息（进程名、容器镜像名）拼进地址，
 * 再把它交给 `shell.openExternal`。那是把外部输入送进操作系统的动作，
 * 必须先过一道白名单，而不是把渲染端传来的字符串原样转交。
 *
 * 拒绝的几类，各有具体原因：
 *  - 非 http/https：`file:` 能打开本机文件、`javascript:` / `data:` 能在别的上下文里执行
 *  - 带凭据（`https://user:pass@host`）：凭据会被写进浏览器历史，且我们从不派发凭据
 *  - 端口缺失但协议要求端口：`URL` 会补默认端口，这是允许的（浏览器行为一致）
 */

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/** 地址长度上限。正常入口地址不会超过它；超长多半是拼接出了问题 */
const MAX_URL_LENGTH = 2048

/**
 * 校验并规范化一个待外部打开的地址。
 * 返回 null 表示「不能打开」——调用方必须据此显示为不可点，而不是兜底成某个默认协议。
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
  if (url.username !== '' || url.password !== '') return null
  // 主机名必须有：`http://:8080` 这种在很多系统上会被解释成 localhost，含义不稳定
  if (url.hostname === '') return null

  return url.toString()
}
