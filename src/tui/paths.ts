import path from 'node:path'
import os from 'node:os'

export function localPath(value: string): string {
  if (!value) throw new Error('请输入本地文件路径')
  const expanded = value === '~' ? os.homedir() : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value
  return path.resolve(expanded)
}
