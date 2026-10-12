const OSC7 = /\x1b\]7;file:\/\/[^\x07\x1b]*(?:\x07|\x1b\\)/g
const PREFIX = '\x1b]7;file://'

/** Only OSC 7 belongs to cwd tracking. Other OSC traffic must reach the terminal unchanged. */
export class CwdOutput {
  private pending = ''

  push(chunk: string): { text: string; cwd?: string } {
    const data = this.pending + chunk
    this.pending = ''
    let text = ''
    let end = 0
    let cwd: string | undefined
    for (const match of data.matchAll(OSC7)) {
      text += data.slice(end, match.index)
      end = match.index + match[0].length
      const payload = match[0].slice(4, match[0].endsWith('\x07') ? -1 : -2)
      const path = /^file:\/\/[^/]*(.*)$/.exec(payload)?.[1]
      if (path !== undefined) {
        try { cwd = decodeURIComponent(path) } catch { cwd = path }
      }
    }
    text += data.slice(end)
    const start = text.lastIndexOf('\x1b]')
    const tail = start >= 0 ? text.slice(start) : ''
    if (tail && tail.length <= 8192 && !/\x07|\x1b\\/.test(tail) && (PREFIX.startsWith(tail) || tail.startsWith(PREFIX))) {
      this.pending = tail
      text = text.slice(0, start)
    } else if (text.endsWith('\x1b')) {
      this.pending = '\x1b'
      text = text.slice(0, -1)
    }
    return { text, cwd }
  }
}
