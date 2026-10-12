import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { startTerminalFixture } from '../examples/stage-05-tui-compatibility/core/terminal-server.mjs'

if (process.platform === 'win32') throw new Error('The real remote Vim/tmux fixture requires a Unix PTY server')
for (const name of ['vim', 'tmux']) execFileSync(name, [name === 'vim' ? '--version' : '-V'], { stdio: 'ignore' })
for (const mode of ['vim', 'tmux']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-fullscreen-'))
  fs.writeFileSync(path.join(directory, 'document.txt'), 'VIM_START 你好\n')
  const server = await startTerminalFixture(mode, directory)
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('python3', ['scripts/verify-tui-terminal.py', String(server.port), mode, directory, process.execPath, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' } })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Real ${mode} terminal verification exited ${code}`)))
    })
    if (mode === 'vim') assert.match(fs.readFileSync(path.join(directory, 'document.txt'), 'utf8'), /VIM_EDIT你好VIM_START 你好/)
  } finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }) }
}
console.log('REAL_TERMINAL_OK: SSH Vim/tmux, Unicode input, fullscreen screen and mode restoration.')
