import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TerminalUI } from './ui'

/** 把用户配置的编辑器解析为 argv，始终使用 spawn(shell: false)。 */
export function editorCommand(value: string): string[] {
  const words: string[] = []
  let word = ''
  let quote = ''
  for (const char of value.trim()) {
    if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) { if (word) { words.push(word); word = '' } }
    else word += char
  }
  if (quote) throw new Error('EDITOR / VISUAL 的引号未闭合')
  if (word) words.push(word)
  if (!words.length) throw new Error('编辑器命令为空')
  return words
}

export async function editText(ui: TerminalUI, content: string, remotePath: string): Promise<string> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-edit-'))
  const filename = path.join(directory, path.basename(remotePath) || 'file.txt')
  try {
    fs.writeFileSync(filename, content, { mode: 0o600 })
    const [command, ...args] = editorCommand(process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad.exe' : 'vi'))
    ui.suspend()
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args, filename], { stdio: 'inherit', shell: false })
        child.once('error', reject)
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`编辑器退出码：${code}`)))
      })
    } finally { ui.resume() }
    const stat = fs.statSync(filename)
    if (stat.size > 5 * 1024 * 1024) throw new Error('编辑后文件超过 5 MiB，未写回')
    return fs.readFileSync(filename, 'utf8')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}
