import type {
  SessionStatus, ShellStatus, SshOutput, SshProgress,
  SftpProgress, SftpDone, SftpReadProgress
} from '../shared/types'

export interface CoreEvents {
  'ssh:status': SessionStatus
  'ssh:shell-status': ShellStatus
  'ssh:output': SshOutput
  'ssh:progress': SshProgress
  'sftp:progress': SftpProgress
  'sftp:done': SftpDone
  'sftp:read-progress': SftpReadProgress
}

/** 宿主拥有会话；释放宿主时关闭连接，事件可接 IPC、TUI 或其他界面。 */
export interface CoreHost {
  send<K extends keyof CoreEvents>(channel: K, payload: CoreEvents[K]): void
  isDisposed(): boolean
  onDispose(callback: () => void): () => void
  logError?(tag: string, message: string, detail?: string): void
}

export class CoreEventHub implements CoreHost {
  private disposed = false
  private readonly disposal = new Set<() => void>()
  private readonly listeners = new Map<keyof CoreEvents, Set<(payload: never) => void>>()

  on<K extends keyof CoreEvents>(channel: K, callback: (payload: CoreEvents[K]) => void): () => void {
    const listeners = this.listeners.get(channel) ?? new Set()
    listeners.add(callback as (payload: never) => void)
    this.listeners.set(channel, listeners)
    return () => { listeners.delete(callback as (payload: never) => void) }
  }

  send<K extends keyof CoreEvents>(channel: K, payload: CoreEvents[K]): void {
    if (this.disposed) return
    for (const listener of this.listeners.get(channel) ?? []) listener(payload as never)
  }

  isDisposed(): boolean { return this.disposed }

  onDispose(callback: () => void): () => void {
    if (this.disposed) callback()
    else this.disposal.add(callback)
    return () => { this.disposal.delete(callback) }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const callback of [...this.disposal]) callback()
    this.disposal.clear()
    this.listeners.clear()
  }
}
