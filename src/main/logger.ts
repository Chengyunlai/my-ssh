import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'

export const MAX_LOG_BYTES = 1024 * 1024 // 1MB
const LOG_FILENAME = 'my-ssh.log'

let logDir = ''
let logPath = ''

export function initLogger(userDataDir: string): void {
  logDir = path.join(userDataDir, 'logs')
  logPath = path.join(logDir, LOG_FILENAME)
  fs.mkdirSync(logDir, { recursive: true })
}

function formatLine(tag: string, message: string, detail?: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const time =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  let line = `${time} [${tag}] ${message}`
  if (detail) {
    line += '\n' + String(detail).split('\n').map((l) => `    ${l}`).join('\n')
  }
  return line + '\n'
}

/**
 * 超限滚动覆盖:文件超过 1MB 时保留尾部(最新)内容,丢弃最旧部分。
 * 单个日志条目可能超过上限,此时直接清空重写。
 */
function rollIfNeeded(extraBytes: number): void {
  if (!logPath) return
  try {
    const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0
    if (size + extraBytes <= MAX_LOG_BYTES) return
    const keep = Math.max(0, MAX_LOG_BYTES - extraBytes)
    if (keep === 0) {
      fs.writeFileSync(logPath, '')
      return
    }
    const fd = fs.openSync(logPath, 'r+')
    const buf = Buffer.alloc(keep)
    fs.readSync(fd, buf, { length: keep, position: Math.max(0, size - keep) })
    fs.writeSync(fd, buf, 0, keep, 0)
    fs.ftruncateSync(fd, keep)
    fs.closeSync(fd)
  } catch {
    // 日志失败不影响主流程
  }
}

/** 记录一条错误日志;同步写入,保证多事件下的写入顺序 */
export function logError(tag: string, message: string, detail?: string): void {
  if (!logPath) return
  try {
    const entry = formatLine(tag, message, detail)
    rollIfNeeded(Buffer.byteLength(entry, 'utf8'))
    fs.appendFileSync(logPath, entry, 'utf8')
  } catch {
    // ignore
  }
}

export async function readLog(): Promise<{ content: string; size: number; max: number }> {
  try {
    if (!logPath) return { content: '', size: 0, max: MAX_LOG_BYTES }
    const st = await fsp.stat(logPath).catch(() => null)
    if (!st) return { content: '', size: 0, max: MAX_LOG_BYTES }
    const content = await fsp.readFile(logPath, 'utf8').catch(() => '')
    return { content, size: st.size, max: MAX_LOG_BYTES }
  } catch {
    return { content: '', size: 0, max: MAX_LOG_BYTES }
  }
}

export async function clearLog(): Promise<void> {
  try {
    if (logPath) await fsp.writeFile(logPath, '')
  } catch {
    // ignore
  }
}
