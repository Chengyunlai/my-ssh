#!/usr/bin/env node
import { TuiApp } from './app'
import { TerminalUI, ExitRequested } from './ui'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('MySSH TUI\n\n用法：myssh [--help] [--version]\n\n↑↓ / j k 选择 · Enter 确认 · Esc 返回 · / 搜索\nSSH 终端：Ctrl+] 返回菜单，Ctrl+C 发送到远端\n凭据：首次启动设置主密码；MYSSH_TUI_HOME 可指定独立数据目录\n编辑器：VISUAL / EDITOR（默认 macOS/Linux vi，Windows notepad.exe）')
    return
  }
  if (args.includes('--version')) { console.log(__MYSSH_VERSION__); return }
  if (args.length) throw new Error(`未知参数：${args.join(' ')}，使用 --help 查看帮助`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('MySSH TUI 需要交互式终端；请在 Windows Terminal、Terminal 或其他终端中运行')
  const ui = new TerminalUI()
  const app = new TuiApp(ui)
  const stop = (): void => { app.dispose(); ui.dispose(); process.exit(0) }
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)
  try { await app.run() }
  catch (error) { if (!(error instanceof ExitRequested)) throw error }
  finally {
    process.off('SIGTERM', stop)
    process.off('SIGHUP', stop)
    app.dispose()
    ui.dispose()
  }
}

declare const __MYSSH_VERSION__: string
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
