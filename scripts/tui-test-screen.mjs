// ConPTY may emit screen deltas rather than redraw text; assertions use the rendered VT screen.
import { createInterface } from 'node:readline'
import xterm from '@xterm/headless'

const terminal = new xterm.Terminal({ cols: 110, rows: 30, scrollback: 0, allowProposedApi: true })
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  await new Promise((resolve) => terminal.write(Buffer.from(line, 'base64'), resolve))
  const buffer = terminal.buffer.active
  const lines = Array.from({ length: terminal.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) || '')
  const text = lines.join('\n')
  const coloredBlock = lines.some((_line, y) => Array.from({ length: terminal.cols }, (_, x) => {
    const cell = buffer.getLine(buffer.viewportY + y)?.getCell(x)
    return cell?.getChars() === '▀' && cell.isFgRGB()
  }).some(Boolean))
  process.stdout.write(JSON.stringify(process.argv.includes('--colors') ? { text, coloredBlock } : text) + '\n')
}
terminal.dispose()
