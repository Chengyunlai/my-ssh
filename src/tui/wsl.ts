import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { TerminalUI } from './ui'

export function parseWslDistributions(bytes: Buffer): string[] {
  const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8')
  return text.replace(/\uFEFF/g, '').split(/\r?\n/).map((line) => line.trim()).filter((name) => name && !/[\x00-\x1f\x7f]/.test(name))
}

export async function showWsl(ui: TerminalUI, signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') throw new Error('WSL 仅适用于 Windows')
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
  const { stdout } = await ui.busy('读取实际 WSL 发行版', promisify(execFile)(executable, ['--list', '--quiet'], { encoding: 'buffer', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }))
  const names = parseWslDistributions(stdout)
  if (!names.length) { await ui.view('WSL', '尚未安装 WSL 发行版，请先在 Windows 中安装。'); return }
  const name = await ui.menu('WSL · 输入 exit 返回 MySSH', names.map((name) => ({ label: name, value: name })))
  if (!name) return
  ui.suspend()
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['--distribution', name], { stdio: 'inherit', shell: false })
      const abort = (): void => { child.kill() }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.once('error', reject)
      child.once('exit', (code) => { signal?.removeEventListener('abort', abort); if (code === 0) resolve(); else reject(new Error(`WSL 已退出 (${code})`)) })
    })
  } finally { ui.resume() }
}
