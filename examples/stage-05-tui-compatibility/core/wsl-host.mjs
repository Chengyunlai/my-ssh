// CI-only composition of the actual UI/WSL source; full CLI and SEA still have separate acceptance.
import { TerminalUI } from '../../../src/tui/ui.ts'
import { showWsl } from '../../../src/tui/wsl.ts'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const ui = new TerminalUI()
const logfile = fileURLToPath(new URL('../../../.dev/wsl-acceptance/host-events.txt', import.meta.url))
const log = (event) => fs.appendFileSync(logfile, JSON.stringify(event) + '\n')
const originalSpawn = childProcess.spawn
childProcess.spawn = (...args) => {
  log({ child: 'spawn', command: args[0], args: args[1] })
  const child = originalSpawn(...args)
  child.once('error', (error) => log({ child: 'error', error: String(error) }))
  child.once('close', (code, signal) => log({ child: 'close', code, signal }))
  return child
}
syncBuiltinESMExports()
for (const method of ['busy', 'menu', 'suspend', 'resume', 'dispose']) {
  const original = ui[method].bind(ui)
  ui[method] = (...args) => {
    log({ method, stage: 'start', paused: process.stdin.isPaused(), destroyed: process.stdin.destroyed, raw: process.stdin.isRaw })
    try {
      const result = original(...args)
      if (result?.then) return result.then((value) => { log({ method, stage: 'resolved', value }); return value }, (error) => { log({ method, stage: 'rejected', error: String(error) }); throw error })
      log({ method, stage: 'end' })
      return result
    } catch (error) { log({ method, stage: 'throw', error: String(error) }); throw error }
  }
}
const controller = new AbortController()
process.once('SIGTERM', () => { controller.abort(); ui.dispose(); process.exit(0) })
try { await showWsl(ui, controller.signal) }
finally { ui.dispose() }
