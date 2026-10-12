import { emitKeypressEvents, type Key } from 'node:readline'

export class Cancelled extends Error {}
export class ExitRequested extends Error {}
export interface Choice<T> { label: string; value: T }

/** 列表、路径和预览内容只作为文字显示，不能执行远端提供的终端控制序列。 */
export function plain(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\r/g, '')
}

function cellWidth(char: string): number {
  if (/\p{Mark}/u.test(char)) return 0
  const n = char.codePointAt(0) ?? 0
  return n >= 0x1100 && (n <= 0x115f || n >= 0x2e80 && n <= 0xa4cf || n >= 0xac00 && n <= 0xd7a3 || n >= 0xf900 && n <= 0xfaff || n >= 0xfe10 && n <= 0xfe6f || n >= 0xff00 && n <= 0xff60 || n >= 0x1f300) ? 2 : 1
}

export function fit(value: string, width: number): string {
  let result = ''
  let used = 0
  for (const char of plain(value).replace(/\n/g, ' ')) {
    const size = cellWidth(char)
    if (used + size > width) break
    result += char
    used += size
  }
  return result
}

export class TerminalUI {
  constructor() {
    emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdout.write('\x1b[?1049h\x1b[?25l')
  }

  get width(): number { return Math.max(20, process.stdout.columns || 80) }
  get height(): number { return Math.max(8, process.stdout.rows || 24) }

  frame(title: string, lines: string[], footer: string): void {
    const body = lines.slice(0, this.height - 5).map((line) => ` ${line}`).join('\r\n')
    process.stdout.write(`\x1b[0m\x1b[?25l\x1b[H\x1b[2J\x1b[1;36m ${fit(title, this.width - 2)}\x1b[0m\r\n ${'─'.repeat(this.width - 2)}\r\n${body}\x1b[${this.height - 1};1H\x1b[2K\x1b[2m ${fit(footer, this.width - 2)}\x1b[0m`)
  }

  private interact<T>(render: () => void, onKey: (text: string, key: Key, done: (value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        process.stdin.off('keypress', handler)
        process.stdin.off('end', ended)
        process.stdout.off('resize', render)
      }
      const done = (value: T): void => { cleanup(); resolve(value) }
      const ended = (): void => { cleanup(); reject(new ExitRequested()) }
      const handler = (text: string, key: Key): void => {
        if (key.ctrl && key.name === 'c') { ended(); return }
        onKey(text || '', key, done)
      }
      process.stdin.on('keypress', handler)
      process.stdin.once('end', ended)
      process.stdout.on('resize', render)
      render()
    })
  }

  async menu<T>(title: string, choices: Choice<T>[], description = ''): Promise<T | undefined> {
    let index = 0
    let filter = ''
    let searching = false
    const filtered = (): Choice<T>[] => choices.filter((item) => item.label.toLowerCase().includes(filter.toLowerCase()))
    const render = (): void => {
      const list = filtered()
      const count = this.height - 7
      const start = Math.floor(index / count) * count
      this.frame(title, [fit(description, this.width - 3), ...list.slice(start, start + count).map((item, i) => {
        const label = fit(item.label, this.width - 5)
        return start + i === index ? `\x1b[7m › ${label} \x1b[0m` : `   ${label}`
      })], `↑↓ / j k 选择 · Enter 确认 · Esc 返回 · / 搜索${filter ? `：${filter}` : ''} · Ctrl+C 退出`)
    }
    return this.interact(render, (text, key, done) => {
      const list = filtered()
      if (key.name === 'escape') {
        if (searching || filter) { searching = false; filter = ''; index = 0 }
        else { done(undefined); return }
      } else if (key.name === 'return') { done(list[index]?.value); return }
      else if (key.name === 'up' || !searching && text === 'k') index = Math.max(0, index - 1)
      else if (key.name === 'down' || !searching && text === 'j') index = Math.min(Math.max(0, list.length - 1), index + 1)
      else if (text === '/' && !searching) searching = true
      else if (searching && key.name === 'backspace') { filter = Array.from(filter).slice(0, -1).join(''); index = 0 }
      else if (searching && text && !key.ctrl && !key.meta) { filter += plain(text); index = 0 }
      render()
    })
  }

  async input(label: string, initial = '', secret = false): Promise<string> {
    let value = initial
    const render = (): void => this.frame(label, ['', fit(secret ? '•'.repeat(Array.from(value).length) : value, this.width - 4) + ' ▏'], 'Enter 确认 · Backspace 删除 · Ctrl+U 清空 · Esc 取消')
    const result = await this.interact<string | undefined>(render, (text, key, done) => {
      if (key.name === 'escape') { done(undefined); return }
      if (key.name === 'return') { done(value); return }
      if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('')
      else if (key.ctrl && key.name === 'u') value = ''
      else if (text && !key.ctrl && !key.meta) value += plain(text).replace(/\n/g, '')
      render()
    })
    if (result === undefined) throw new Cancelled()
    return result
  }

  async confirm(title: string): Promise<boolean> {
    return await this.menu(title, [{ label: '取消', value: false }, { label: '确认', value: true }]) === true
  }

  async view(title: string, content: string): Promise<void> {
    const lines: string[] = []
    for (const line of plain(content).split('\n')) {
      let part = ''
      let width = 0
      for (const char of line) {
        const size = cellWidth(char)
        if (width + size > this.width - 3) { lines.push(part); part = ''; width = 0 }
        part += char
        width += size
      }
      lines.push(part)
    }
    let offset = 0
    const render = (): void => this.frame(title, lines.slice(offset).map((line) => fit(line, this.width - 3)), `${offset + 1}/${lines.length} · ↑↓ / PgUp PgDn 滚动 · Enter / Esc 返回`)
    await this.interact<void>(render, (_text, key, done) => {
      if (key.name === 'escape' || key.name === 'return') { done(); return }
      const page = this.height - 6
      if (key.name === 'up') offset = Math.max(0, offset - 1)
      if (key.name === 'down') offset = Math.min(Math.max(0, lines.length - page), offset + 1)
      if (key.name === 'pageup') offset = Math.max(0, offset - page)
      if (key.name === 'pagedown') offset = Math.min(Math.max(0, lines.length - page), offset + page)
      render()
    })
  }

  /** Raster lines are generated by colorBlocks, never supplied by remote text or plugin output. */
  async image(title: string, lines: string[]): Promise<void> {
    const render = (): void => this.frame(title, lines.map((line) => (line.match(/\x1b\[38;2;\d+;\d+;\d+m\x1b\[48;2;\d+;\d+;\d+m▀/g) || []).slice(0, this.width - 3).join('') + '\x1b[0m'), 'Enter / Esc 返回 · 图片使用终端 RGB 色块')
    await this.interact<void>(render, (_text, key, done) => {
      if (key.name === 'return' || key.name === 'escape') done()
    })
  }

  async busy<T>(title: string, operation: Promise<T>, cancelOperation?: () => void): Promise<T> {
    this.frame(title, ['处理中…'], 'Ctrl+C 退出')
    let cancel!: () => void
    const interrupted = new Promise<never>((_resolve, reject) => {
      const handler = (_text: string, key: Key): void => {
        if (key.ctrl && key.name === 'c') { cancelOperation?.(); reject(new ExitRequested()) }
      }
      process.stdin.on('keypress', handler)
      cancel = () => { process.stdin.off('keypress', handler) }
    })
    try { return await Promise.race([operation, interrupted]) }
    finally { cancel() }
  }

  suspend(): void {
    process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l')
  }

  resume(): void {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdout.write('\x1b[?1049h\x1b[?25l')
  }

  dispose(): void { this.suspend() }
}
