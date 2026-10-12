import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { TerminalUI } from './ui'

export function parseWslDistributions(bytes: Buffer): string[] {
  const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8')
  return [...new Set(text.replace(/\uFEFF/g, '').split(/\r?\n/).map((line) => line.trim()).filter((name) => name && name.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(name)))]
}

function wslExecutable(): string {
  if (process.platform !== 'win32') throw new Error('WSL 仅适用于 Windows')
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

export async function listWslDistributions(signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  const { stdout } = await promisify(execFile)(wslExecutable(), ['--list', '--quiet'], { encoding: 'buffer', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, signal })
  return parseWslDistributions(stdout)
}

export async function runWslDistribution(name: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (!name || name.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error('WSL 发行版名称无效')
  const executable = wslExecutable()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--distribution', name], { stdio: 'inherit', shell: false })
    const abort = (): void => { child.kill() }
    const cleanup = (): void => { signal?.removeEventListener('abort', abort) }
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('close', (code) => {
      cleanup()
      if (signal?.aborted) reject(new Error('WSL 已取消'))
      else if (code === 0) resolve()
      else reject(new Error(`WSL 已退出 (${code})`))
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export async function showWsl(ui: TerminalUI, signal?: AbortSignal): Promise<void> {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const names = await ui.busy('读取实际 WSL 发行版', listWslDistributions(combined), () => controller.abort())
  if (!names.length) { await ui.view('WSL', '尚未安装 WSL 发行版，请先在 Windows 中安装。'); return }
  const name = await ui.menu('WSL · 输入 exit 返回 MySSH', names.map((name) => ({ label: name, value: name })))
  if (!name) return
  ui.suspend()
  // Console Ctrl+C is delivered to the inherited WSL console; keep the waiting host alive.
  const interrupt = (): void => {}
  process.on('SIGINT', interrupt)
  try {
    await runWslDistribution(name, signal)
  } finally { process.off('SIGINT', interrupt); ui.resume() }
}
