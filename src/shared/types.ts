export type AuthType = 'password' | 'key'

export interface Profile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  /** 仅 password 认证时使用 */
  password?: string
  /** 仅 key 认证时使用:PEM 私钥文件绝对路径 */
  keyPath?: string
  /** PEM 私钥口令(可选) */
  passphrase?: string
}

export interface SessionStatus {
  sessionId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  message?: string
}

export interface SftpEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: number
  mtime: number
}

export interface SftpProgress {
  transferId: string
  done: number
  total: number
  speed: number
}

export interface SftpDone {
  transferId: string
  error?: string
}

/** IPC 的结构化结果:不 reject,避免 Electron 对预期失败刷错误日志 */
export interface IpcResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export interface SftpReadResult {
  kind: 'text' | 'image' | 'binary'
  /** kind = text 时的文件内容(UTF-8) */
  content?: string
  /** kind = image 时的 data URL */
  dataUrl?: string
  size: number
  truncated: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  userData: string
}

export interface StorageInfo {
  /** userData 目录总占用 */
  total: number
  /** Chromium 缓存目录占用(Cache / GPUCache 等,可安全清理) */
  cache: number
  /** 连接配置 profiles.json 占用 */
  profiles: number
  /** 各插件数据目录占用 userData/plugins/<id>/ */
  plugins: Record<string, number>
}

export interface MarketPluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  defaultEnabled?: boolean
  /** 相对 registry 的入口路径 */
  entry: string
  /** entry 文件的 sha256 */
  sha256: string
  /** 主进程解析后的绝对下载地址 */
  entryUrl: string
}

export interface MarketRegistry {
  name: string
  version: string
  plugins: MarketPluginInfo[]
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  defaultEnabled?: boolean
  /** 运行时入口:myssh-plugin://<id>/<version>/entry.js */
  entryUrl: string
}

export interface SshApi {
  listProfiles(): Promise<Profile[]>
  saveProfile(profile: Profile): Promise<Profile>
  deleteProfile(id: string): Promise<void>
  pickKeyFile(): Promise<{ canceled: boolean; filePath?: string }>
  connect(profile: Profile): Promise<{ sessionId: string }>
  sendData(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  disconnect(sessionId: string): void
  /** 终端当前目录;尚未解析到(OSC 7 未到达)时返回 null */
  getCwd(sessionId: string): Promise<string | null>
  onOutput(cb: (sessionId: string, data: string) => void): () => void
  onStatus(cb: (status: SessionStatus) => void): () => void
  sftpHome(sessionId: string): Promise<string>
  sftpList(sessionId: string, dir: string): Promise<SftpEntry[]>
  sftpMkdir(sessionId: string, dir: string): Promise<void>
  sftpRead(sessionId: string, remotePath: string): Promise<SftpReadResult>
  sftpWrite(sessionId: string, remotePath: string, content: string): Promise<void>
  sftpDelete(sessionId: string, target: string, isDir: boolean): Promise<void>
  sftpDownload(
    sessionId: string,
    remotePath: string,
    localPath: string
  ): Promise<{ transferId: string }>
  sftpUpload(
    sessionId: string,
    localPath: string,
    remotePath: string
  ): Promise<{ transferId: string }>
  onSftpProgress(cb: (evt: SftpProgress) => void): () => void
  onSftpDone(cb: (evt: SftpDone) => void): () => void
  pickLocalFiles(): Promise<{ canceled: boolean; filePaths: string[] }>
  pickLocalDirectory(): Promise<{ canceled: boolean; filePath?: string }>
  pickSaveFile(defaultName: string): Promise<{ canceled: boolean; filePath?: string }>
  copyText(text: string): void
  appInfo(): Promise<AppInfo>
  storageScan(pluginIds: string[]): Promise<StorageInfo>
  storageCleanCache(): Promise<{ freed: number }>
  storageCleanPlugin(pluginId: string): Promise<{ freed: number }>
  marketFetchRegistry(url: string): Promise<MarketRegistry>
  marketListInstalled(): Promise<InstalledPlugin[]>
  marketInstall(url: string, pluginId: string): Promise<InstalledPlugin>
}
