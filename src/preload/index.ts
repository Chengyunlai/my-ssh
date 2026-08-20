import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  InstalledPlugin,
  MarketRegistry,
  LogInfo,
  SessionStatus,
  ShellStatus,
  UpdateState,
  SshProgress,
  SshOutput,
  SftpDone,
  SftpEntry,
  SftpProgress,
  SftpReadProgress,
  SftpReadResult,
  IpcResult,
  SshApi
} from '@shared/types'

/** 解包主进程的结构化结果;失败时抛出,供渲染端 try/catch 使用 */
async function invokeSafe<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (res && res.ok === false) throw new Error(res.error ?? '操作失败')
  return res.value as T
}

const api: SshApi = {
  platform: process.platform,
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (profile) => ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  pickKeyFile: () => ipcRenderer.invoke('dialog:pickKey'),
  connect: (profile) => ipcRenderer.invoke('ssh:connect', profile),
  testConnect: (profile) => ipcRenderer.invoke('ssh:test', profile),
  sendData: (sessionId, shellId, data) => ipcRenderer.send('ssh:data', sessionId, shellId, data),
  resize: (sessionId, shellId, cols, rows) => ipcRenderer.send('ssh:resize', sessionId, shellId, cols, rows),
  disconnect: (sessionId) => ipcRenderer.send('ssh:disconnect', sessionId),
  openShell: (sessionId) => ipcRenderer.invoke('ssh:open-shell', sessionId),
  closeShell: (sessionId, shellId) => ipcRenderer.invoke('ssh:close-shell', sessionId, shellId),
  getCwd: (sessionId) => ipcRenderer.invoke('ssh:cwd', sessionId),
  onOutput: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, output: SshOutput): void =>
      cb(output.sessionId, output.shellId, output.data)
    ipcRenderer.on('ssh:output', listener)
    return () => ipcRenderer.removeListener('ssh:output', listener)
  },
  onStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: SessionStatus): void => cb(status)
    ipcRenderer.on('ssh:status', listener)
    return () => ipcRenderer.removeListener('ssh:status', listener)
  },
  onShellStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: ShellStatus): void => cb(status)
    ipcRenderer.on('ssh:shell-status', listener)
    return () => ipcRenderer.removeListener('ssh:shell-status', listener)
  },
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: SshProgress): void => cb(p)
    ipcRenderer.on('ssh:progress', listener)
    return () => ipcRenderer.removeListener('ssh:progress', listener)
  },
  onReadProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: SftpReadProgress): void => cb(p)
    ipcRenderer.on('sftp:read-progress', listener)
    return () => ipcRenderer.removeListener('sftp:read-progress', listener)
  },
  onUpdateState: (cb) => {
    ipcRenderer.send('app:update-subscribe')
    const listener = (_e: Electron.IpcRendererEvent, s: UpdateState): void => cb(s)
    ipcRenderer.on('app:update-state', listener)
    return () => {
      ipcRenderer.removeListener('app:update-state', listener)
      ipcRenderer.send('app:update-unsubscribe')
    }
  },
  checkUpdate: () => invokeSafe<UpdateState>('app:update-check'),
  downloadUpdate: () => invokeSafe<UpdateState>('app:update-download'),
  installUpdate: () => ipcRenderer.send('app:update-install'),
  sftpHome: (sessionId) => invokeSafe<string>('sftp:home', sessionId),
  sftpList: (sessionId, dir) => invokeSafe<SftpEntry[]>('sftp:list', sessionId, dir),
  sftpMkdir: (sessionId, dir) => invokeSafe<void>('sftp:mkdir', sessionId, dir),
  sftpRead: (sessionId, remotePath) =>
    invokeSafe<SftpReadResult>('sftp:read', sessionId, remotePath),
  sftpWrite: (sessionId, remotePath, content) =>
    invokeSafe<void>('sftp:write', sessionId, remotePath, content),
  sftpStat: (sessionId, remotePath) => invokeSafe<boolean>('sftp:stat', sessionId, remotePath),
  sftpDelete: (sessionId, target, isDir) =>
    invokeSafe<void>('sftp:delete', sessionId, target, isDir),
  sftpDownload: (sessionId, remotePath, localPath) =>
    invokeSafe<{ transferId: string }>('sftp:download', sessionId, remotePath, localPath),
  sftpUpload: (sessionId, localPath, remotePath) =>
    invokeSafe<{ transferId: string }>('sftp:upload', sessionId, localPath, remotePath),
  onSftpProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: SftpProgress): void => cb(evt)
    ipcRenderer.on('sftp:progress', listener)
    return () => ipcRenderer.removeListener('sftp:progress', listener)
  },
  onSftpDone: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: SftpDone): void => cb(evt)
    ipcRenderer.on('sftp:done', listener)
    return () => ipcRenderer.removeListener('sftp:done', listener)
  },
  pickLocalFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickLocalDirectory: () => ipcRenderer.invoke('dialog:pickDir'),
  pickSaveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  copyText: (text) => ipcRenderer.send('clipboard:copy', text),
  getPathForFile: (file: { name: string }) => webUtils.getPathForFile(file as never),
  appInfo: () => ipcRenderer.invoke('app:info'),
  storageScan: (pluginIds) => ipcRenderer.invoke('storage:scan', pluginIds),
  storageCleanCache: () => ipcRenderer.invoke('storage:clean-cache'),
  storageCleanPlugin: (pluginId) => ipcRenderer.invoke('storage:clean-plugin', pluginId),
  logError: (tag, message, detail) => ipcRenderer.send('log:error', tag, message, detail),
  logRead: () => invokeSafe<LogInfo>('log:read'),
  logClear: () => invokeSafe<void>('log:clear'),
  marketFetchRegistry: (url) => invokeSafe<MarketRegistry>('market:fetch-registry', url),
  marketListInstalled: () => invokeSafe<InstalledPlugin[]>('market:list-installed'),
  marketInstall: (url, pluginId) =>
    invokeSafe<InstalledPlugin>('market:install', url, pluginId)
}

contextBridge.exposeInMainWorld('ssh', api)
