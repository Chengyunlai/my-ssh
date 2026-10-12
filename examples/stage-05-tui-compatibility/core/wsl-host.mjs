// CI composition of actual UI/WSL source; full CLI and SEA have separate acceptance.
import { TerminalUI } from '../../../src/tui/ui.ts'
import { showWsl } from '../../../src/tui/wsl.ts'

const ui = new TerminalUI()
const controller = new AbortController()
process.once('SIGTERM', () => { controller.abort(); ui.dispose(); process.exit(0) })
try { await showWsl(ui, controller.signal) }
finally { ui.dispose() }
