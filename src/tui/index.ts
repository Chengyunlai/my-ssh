#!/usr/bin/env node
import { TuiApp } from './app'
import { TerminalUI, ExitRequested } from './ui'
import fs from 'node:fs'
import { showPreview } from './preview'
import { PREVIEW_LIMITS } from './preview-format'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('MySSH TUI\n\n用法：myssh [--help] [--version] [--preview <文件>]\n\n↑↓ / j k 选择 · Enter 确认 · Esc 返回 · / 搜索\nSSH 终端：Ctrl+] 返回菜单，Ctrl+C 发送到远端\n凭据：首次启动设置主密码；MYSSH_TUI_HOME 可指定独立数据目录\n编辑器：VISUAL / EDITOR（默认 macOS/Linux vi，Windows notepad.exe）')
    return
  }
  if (args.includes('--version')) { console.log(__MYSSH_VERSION__); return }
  const previewFile = args.length === 2 && args[0] === '--preview' ? args[1] : undefined
  if (args.length && !previewFile) throw new Error(`未知参数：${args.join(' ')}，使用 --help 查看帮助`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('MySSH TUI 需要交互式终端；请在 Windows Terminal、Terminal 或其他终端中运行')
  const ui = new TerminalUI()
  const app = new TuiApp(ui)
  const stop = (): void => { app.dispose(); ui.dispose(); process.exit(0) }
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)
  try {
    if (previewFile) {
      const descriptor = fs.openSync(previewFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
      let bytes: Buffer
      try {
        const stat = fs.fstatSync(descriptor)
        if (!stat.isFile()) throw new Error('请选择普通文件')
        if (stat.size > PREVIEW_LIMITS.bytes) throw new Error('预览文件超过 5 MiB 上限')
        const buffer = Buffer.alloc(PREVIEW_LIMITS.bytes + 1)
        let length = 0
        while (length < buffer.length) {
          const read = fs.readSync(descriptor, buffer, length, buffer.length - length, length)
          if (!read) break
          length += read
        }
        if (length > PREVIEW_LIMITS.bytes) throw new Error('预览文件超过 5 MiB 上限')
        bytes = buffer.subarray(0, length)
      } finally { fs.closeSync(descriptor) }
      await showPreview(ui, bytes, previewFile)
    } else await app.run()
  }
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
