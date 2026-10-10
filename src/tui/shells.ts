import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { MySshCore } from '../core'

// 恢复菜单前清除远端应用可能启用的输入 / 鼠标模式。
const RESET = '\x1b[?1049l\x1b[?1049h\x1b[0m\x1b[?1l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?2004l\x1b[r\x1b[H\x1b[2J'

export interface ShellScreen {
  sessionId: string
  shellId: string
  name: string
  terminal: Terminal
  serialize: SerializeAddon
}

/** 每个 Shell 保留 VT 状态，后台输出不污染菜单；重新进入恢复 framebuffer。 */
export class ShellScreens {
  private readonly screens = new Map<string, ShellScreen>()
  private readonly unsubscribe: Array<() => void>
  private active?: ShellScreen
  private leave?: () => void

  constructor(private readonly core: MySshCore) {
    this.unsubscribe = [
      core.events.on('ssh:shell-status', (status) => {
        const key = this.key(status.sessionId, status.shellId)
        if (status.status === 'connected') {
          const terminal = new Terminal({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24, scrollback: 1000, allowProposedApi: true })
          const serialize = new SerializeAddon()
          // SerializeAddon 的运行合同是 xterm 的 buffer API，headless 提供同一合同。
          terminal.loadAddon(serialize as unknown as Parameters<Terminal['loadAddon']>[0])
          this.screens.set(key, { sessionId: status.sessionId, shellId: status.shellId, name: status.name || status.shellId, terminal, serialize })
          core.ssh.resize(status.sessionId, status.shellId, terminal.cols, terminal.rows)
        } else {
          const screen = this.screens.get(key)
          if (screen === this.active) this.leave?.()
          screen?.terminal.dispose()
          this.screens.delete(key)
        }
      }),
      core.events.on('ssh:output', (output) => {
        const screen = this.screens.get(this.key(output.sessionId, output.shellId))
        if (!screen) return
        screen.terminal.write(output.data)
        if (screen === this.active) process.stdout.write(output.data)
      }),
      core.events.on('ssh:status', (status) => {
        if (status.status === 'error' || status.status === 'disconnected') this.removeSession(status.sessionId)
      })
    ]
  }

  private key(sessionId: string, shellId: string): string { return `${sessionId}:${shellId}` }

  list(sessionId: string): ShellScreen[] {
    return [...this.screens.values()].filter((screen) => screen.sessionId === sessionId)
  }

  removeSession(sessionId: string): void {
    for (const screen of this.list(sessionId)) {
      if (screen === this.active) this.leave?.()
      screen.terminal.dispose()
      this.screens.delete(this.key(screen.sessionId, screen.shellId))
    }
  }

  async attach(screen: ShellScreen): Promise<void> {
    // 等待 headless 已排队输出，序列化包含最新状态。
    await new Promise<void>((resolve) => {
      let unsubscribe = (): void => {}
      let release = (): void => {}
      const done = (): void => { unsubscribe(); release(); resolve() }
      unsubscribe = this.core.events.on('ssh:shell-status', (status) => {
        if (status.sessionId === screen.sessionId && status.shellId === screen.shellId && status.status !== 'connected') done()
      })
      release = this.core.events.onDispose(done)
      screen.terminal.write('', done)
    })
    if (!this.screens.has(this.key(screen.sessionId, screen.shellId))) return
    await new Promise<void>((resolve) => {
      const resize = (): void => {
        screen.terminal.resize(process.stdout.columns || 80, process.stdout.rows || 24)
        this.core.ssh.resize(screen.sessionId, screen.shellId, screen.terminal.cols, screen.terminal.rows)
      }
      const leave = (): void => {
        process.stdin.off('data', data)
        process.stdout.off('resize', resize)
        this.active = undefined
        this.leave = undefined
        process.stdout.write(RESET + '\x1b[?25l')
        resolve()
      }
      const data = (chunk: Buffer): void => {
        const escape = chunk.indexOf(0x1d) // Ctrl+] 由宿主占用，Ctrl+C 仍传给远端。
        if (escape >= 0) {
          if (escape > 0) this.core.ssh.sendData(screen.sessionId, screen.shellId, chunk.subarray(0, escape).toString('utf8'))
          leave()
        } else this.core.ssh.sendData(screen.sessionId, screen.shellId, chunk.toString('utf8'))
      }
      this.active = screen
      this.leave = leave
      resize()
      process.stdout.write(RESET + '\x1b[?25h' + screen.serialize.serialize({ scrollback: 0 }))
      process.stdin.on('data', data)
      process.stdout.on('resize', resize)
    })
  }

  dispose(): void {
    this.leave?.()
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    for (const screen of this.screens.values()) screen.terminal.dispose()
    this.screens.clear()
  }
}
