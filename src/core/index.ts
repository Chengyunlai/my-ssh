import { CoreEventHub } from './host'
import * as ssh from './ssh'
import * as sftp from './sftp'
import * as monitor from './monitor'
import * as services from './service-scan'
import type { Profile, TestConnectionResult, SftpReadResult } from '../shared/types'

export { CoreEventHub } from './host'
export type { CoreHost, CoreEvents } from './host'
export { ProfileStore, validateProfile } from './profiles'
export type { ProfilePersistence } from './profiles'
export type { Profile, SftpEntry, SftpReadResult, ShellStatus, SessionStatus } from '../shared/types'

/** 一个宿主对应一个事件域。dispose 仅释放本宿主拥有的会话。 */
export function createCore() {
  const events = new CoreEventHub()
  const assertOwned = (sessionId: string): void => {
    if (!ssh.isSessionOwnedBy(sessionId, events)) throw new Error('SSH 会话不存在或不属于当前宿主')
  }
  const owned = <T>(sessionId: string, operation: () => T): T => {
    assertOwned(sessionId)
    return operation()
  }
  return {
    events,
    dispose: () => events.dispose(),
    ssh: {
      connect: (profile: Profile) => {
        if (events.isDisposed()) throw new Error('宿主已经释放')
        return ssh.connect(profile, events)
      },
      testConnect: (profile: Profile): Promise<TestConnectionResult> => ssh.testConnect(profile, events),
      whenReady: (id: string) => owned(id, () => ssh.whenReady(id)),
      openShell: (id: string, cols = 80, rows = 24) => owned(id, () => ssh.openShell(id, events, cols, rows)),
      closeShell: (id: string, shellId: string) => owned(id, () => ssh.closeShell(id, shellId)),
      getCwd: (id: string, shellId = 'main') => owned(id, () => ssh.getCwd(id, shellId)),
      sendData: (id: string, shellId: string, data: string) => owned(id, () => ssh.sendData(id, shellId, data)),
      resize: (id: string, shellId: string, cols: number, rows: number) => owned(id, () => ssh.resize(id, shellId, cols, rows)),
      disconnect: (id: string) => owned(id, () => ssh.disconnect(id))
    },
    sftp: {
      home: (id: string) => owned(id, () => sftp.home(id)),
      list: (id: string, dir: string) => owned(id, () => sftp.list(id, dir)),
      read: (id: string, remote: string, options?: { fresh?: boolean }): Promise<SftpReadResult> => owned(id, () => sftp.read(id, remote, events, options)),
      write: (id: string, remote: string, content: string) => owned(id, () => sftp.write(id, remote, content)),
      stat: (id: string, remote: string) => owned(id, () => sftp.stat(id, remote)),
      mkdir: (id: string, dir: string) => owned(id, () => sftp.mkdir(id, dir)),
      remove: (id: string, remote: string, isDir: boolean) => owned(id, () => sftp.remove(id, remote, isDir)),
      download: (id: string, remote: string, local: string) => owned(id, () => sftp.download(id, remote, local, events)),
      upload: (id: string, local: string, remote: string) => owned(id, () => sftp.upload(id, local, remote, events))
    },
    monitor: { getSnapshot: (id: string) => owned(id, () => monitor.getSnapshot(id)) },
    services: { scan: (id: string) => owned(id, () => services.scanServices(id)) }
  }
}

export type MySshCore = ReturnType<typeof createCore>
