#!/usr/bin/env node
import { TuiApp } from './app'
import { TerminalUI, ExitRequested } from './ui'
import fs from 'node:fs'
import { showPreview } from './preview'
import { PREVIEW_LIMITS } from './preview-format'
import path from 'node:path'
import { dataDirectory } from './vault'
import { TerminalPluginMarket, OFFICIAL_REGISTRY } from './plugin-market'
import { validateTuiPlugin } from '../shared/tui-plugin'
import { showWsl } from './wsl'

function readLocalFile(filename: string, maximum: number): Buffer {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile()) throw new Error('请选择普通文件')
    if (stat.size > maximum) throw new Error('文件超过大小上限')
    const buffer = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, length)
      if (!read) break
      length += read
    }
    if (length > maximum) throw new Error('文件超过大小上限')
    return buffer.subarray(0, length)
  } finally { fs.closeSync(descriptor) }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('MySSH TUI\n\n用法：myssh [--help] [--version] [--preview <文件>]\n      myssh --install-plugin <id> [--registry <URL>]\n      myssh --validate-plugin <terminal.json>\n      myssh --wsl (Windows)\n\n↑↓ / j k 选择 · Enter 确认 · Esc 返回 · / 搜索\nSSH 终端：Ctrl+] 返回菜单，Ctrl+C 发送到远端\n凭据：首次启动设置主密码；MYSSH_TUI_HOME 可指定独立数据目录\n编辑器：VISUAL / EDITOR（默认 macOS/Linux vi，Windows notepad.exe）\n插件：安装后默认停用，在终端界面中启用；支持 HTTP(S)_PROXY / NO_PROXY')
    return
  }
  if (args.includes('--version')) { console.log(__MYSSH_VERSION__); return }
  if (args.length === 2 && args[0] === '--validate-plugin') {
    const value = JSON.parse(readLocalFile(args[1], 1024 * 1024).toString('utf8'))
    const descriptor = validateTuiPlugin(value, typeof value?.id === 'string' ? value.id : '')
    console.log(`PLUGIN_OK ${descriptor.id} · ${descriptor.contributions.map((item) => item.kind).join(', ')}`)
    return
  }
  if (args[0] === '--install-plugin' && args[1] && (args.length === 2 || args.length === 4 && args[2] === '--registry')) {
    const market = new TerminalPluginMarket(path.join(dataDirectory(), 'plugins'), __MYSSH_VERSION__)
    const stopDownload = (): void => market.dispose()
    process.once('SIGINT', stopDownload)
    process.once('SIGTERM', stopDownload)
    try {
      await market.install(args[3] || OFFICIAL_REGISTRY, args[1])
      console.log(`已安装 ${args[1]}，可在终端插件界面中启用。`)
    } finally { market.dispose(); process.off('SIGINT', stopDownload); process.off('SIGTERM', stopDownload) }
    return
  }
  const previewFile = args.length === 2 && args[0] === '--preview' ? args[1] : undefined
  const wsl = args.length === 1 && args[0] === '--wsl'
  if (args.length && !previewFile && !wsl) throw new Error(`未知参数：${args.join(' ')}，使用 --help 查看帮助`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('MySSH TUI 需要交互式终端；请在 Windows Terminal、Terminal 或其他终端中运行')
  const ui = new TerminalUI()
  const app = new TuiApp(ui)
  const localProcess = new AbortController()
  const stop = (): void => { localProcess.abort(); app.dispose(); ui.dispose(); process.exit(0) }
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)
  try {
    if (wsl) await showWsl(ui, localProcess.signal)
    else if (previewFile) {
      await showPreview(ui, readLocalFile(previewFile, PREVIEW_LIMITS.bytes), previewFile)
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
