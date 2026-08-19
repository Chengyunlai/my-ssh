/** 版本比较工具:主进程(安装校验)与渲染进程(安装按钮禁用)共用 */

export function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0)
}

/** a < b 返回负数,a > b 返回正数,相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export interface VersionSupport {
  min?: string
  max?: string
}

/** 当前版本是否在插件声明的支持区间内 */
export function isVersionSupported(current: string, support: VersionSupport): boolean {
  if (support.min && compareVersions(current, support.min) < 0) return false
  if (support.max && compareVersions(current, support.max) > 0) return false
  return true
}
