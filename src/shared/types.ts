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

/** 单个 shell 的生命周期事件(同一 SSH 连接内的独立终端) */
export interface ShellStatus {
  sessionId: string
  shellId: string
  status: 'connected' | 'closed' | 'error'
  /** connected 时的可读名称(终端 1 / 终端 2 …) */
  name?: string
  message?: string
}

/** ssh:output 的结构化载荷,按 shellId 区分输出来源 */
export interface SshOutput {
  sessionId: string
  shellId: string
  data: string
}

export interface SshProgress {
  /** 0-100;测试连接时为 undefined,实际连接时为对应会话 id */
  sessionId?: string
  percent: number
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
  kind: 'text' | 'image' | 'binary' | 'pdf' | 'office'
  /** kind = text 时的文件内容(UTF-8) */
  content?: string
  /** kind = image / pdf 时的 data URL */
  dataUrl?: string
  /** kind = office 时的原始字节(docx / xlsx / xls / doc) */
  bytes?: Uint8Array
  size: number
  truncated: boolean
}

/** 预览读取进度:主进程按流式字节数上报 */
export interface SftpReadProgress {
  sessionId: string
  remotePath: string
  /** 0-100:本次预览下载的进度 */
  percent: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  userData: string
}

export type UpdateStatus =
  | 'disabled' // 开发模式 / 未配置更新源
  | 'checking'
  | 'current' // 已是最新
  | 'available' // 发现新版本(未下载)
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** 当前应用版本 */
  currentVersion: string
  /** 可更新目标版本 */
  version?: string
  releaseNotes?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  speed?: number
  error?: string
}

export interface TestConnectionResult {
  ok: boolean
  /** 失败时的错误信息(便于复制后提 issue) */
  message?: string
}

export interface LogInfo {
  /** 日志内容 */
  content: string
  /** 当前文件大小(字节) */
  size: number
  /** 日志上限(字节),超限滚动覆盖 */
  max: number
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

/** 插件支持的运行平台(Node process.platform 值);缺省表示全平台 */
export type PluginPlatform = 'win32' | 'darwin' | 'linux'

export interface MarketPluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  /** 分类(官方分类表,见 docs/PLUGIN.md §5) */
  category?: string
  /** 最低兼容 MySSH 版本(semver);低于当前版本时禁止安装 */
  minAppVersion?: string
  /** 最高兼容 MySSH 版本(可选) */
  maxAppVersion?: string
  /** 支持的运行平台;缺省表示全平台,不含当前平台时禁止安装 */
  platforms?: PluginPlatform[]
  /** 官方插件标记:仅由市场 registry 构建方(官方清单)加盖,插件自身声明无效 */
  official?: boolean
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
  /** 分类:安装时从 registry 盖章写入 manifest */
  category?: string
  /** 兼容 MySSH 版本区间:安装时从 registry 盖章写入 manifest */
  minAppVersion?: string
  maxAppVersion?: string
  /** 支持的运行平台:安装时从 registry 盖章写入 manifest */
  platforms?: PluginPlatform[]
  /** 官方标记:安装时从 registry 盖章写入 manifest,可信来源 */
  official?: boolean
  defaultEnabled?: boolean
  /** 运行时入口:myssh-plugin://<id>/<version>/entry.js */
  entryUrl: string
}

export interface SshApi {
  /** 运行平台,用于渲染端适配原生窗口布局(macOS 红绿灯留白等) */
  platform: string
  listProfiles(): Promise<Profile[]>
  saveProfile(profile: Profile): Promise<Profile>
  deleteProfile(id: string): Promise<void>
  pickKeyFile(): Promise<{ canceled: boolean; filePath?: string }>
  connect(profile: Profile): Promise<{ sessionId: string }>
  testConnect(profile: Profile): Promise<TestConnectionResult>
  sendData(sessionId: string, shellId: string, data: string): void
  resize(sessionId: string, shellId: string, cols: number, rows: number): void
  disconnect(sessionId: string): void
  /** 同一 SSH 连接内开启新 shell,返回 shellId */
  openShell(sessionId: string): Promise<{ shellId: string } | undefined>
  /** 关闭指定 shell;最后一个 shell 关闭时断开整个会话 */
  closeShell(sessionId: string, shellId: string): Promise<boolean>
  /** 终端当前目录;尚未解析到(OSC 7 未到达)时返回 null */
  getCwd(sessionId: string): Promise<string | null>
  onOutput(cb: (sessionId: string, shellId: string, data: string) => void): () => void
  onStatus(cb: (status: SessionStatus) => void): () => void
  /** 订阅单个 shell 的生命周期(connected / closed / error) */
  onShellStatus(cb: (status: ShellStatus) => void): () => void
  onProgress(cb: (progress: SshProgress) => void): () => void
  onReadProgress(cb: (progress: SftpReadProgress) => void): () => void
  /** 订阅应用更新状态(立即回传当前状态) */
  onUpdateState(cb: (state: UpdateState) => void): () => void
  checkUpdate(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  installUpdate(): void
  sftpHome(sessionId: string): Promise<string>
  sftpList(sessionId: string, dir: string): Promise<SftpEntry[]>
  sftpMkdir(sessionId: string, dir: string): Promise<void>
  sftpRead(sessionId: string, remotePath: string): Promise<SftpReadResult>
  sftpWrite(sessionId: string, remotePath: string, content: string): Promise<void>
  sftpStat(sessionId: string, remotePath: string): Promise<boolean>
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
  /** Electron 32+ 移除了 File.path,统一用 webUtils.getPathForFile 取拖入文件路径 */
  getPathForFile(file: { name: string }): string
  appInfo(): Promise<AppInfo>
  storageScan(pluginIds: string[]): Promise<StorageInfo>
  storageCleanCache(): Promise<{ freed: number }>
  storageCleanPlugin(pluginId: string): Promise<{ freed: number }>
  logError(tag: string, message: string, detail?: string): void
  logRead(): Promise<LogInfo>
  logClear(): Promise<void>
  marketFetchRegistry(url: string): Promise<MarketRegistry>
  marketListInstalled(): Promise<InstalledPlugin[]>
  marketInstall(url: string, pluginId: string): Promise<InstalledPlugin>
}
