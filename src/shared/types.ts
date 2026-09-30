import type { Application, ServiceRecord } from './netlist'

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

export type SystemMetricsErrorCode =
  | 'session-not-found'
  | 'not-ready'
  | 'unsupported'
  | 'timeout'
  | 'output-limit'
  | 'rate-limited'
  | 'busy'
  | 'remote-error'
  | 'parse-error'

export interface SystemMetricsError {
  code: SystemMetricsErrorCode
  message: string
  retryAfterMs?: number
}

export interface SystemMetricsSnapshot {
  /** 主机采集完成时间(Unix milliseconds)。 */
  sampledAt: number
  platform: 'linux'
  cpu: {
    usagePercent: number | null
    load1: number
    load5: number
    load15: number
    sampleStatus: 'ready' | 'insufficient-data'
  }
  memory: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
    swapTotalBytes: number
    swapUsedBytes: number
    swapUsagePercent: number
  }
  disks: Array<{
    mountPoint: string
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
  }>
  network: Array<{
    interface: string
    rxBytes: number
    txBytes: number
  }>
  uptimeSeconds: number
}

export type SystemMetricsResult =
  | { ok: true; snapshot: SystemMetricsSnapshot }
  | { ok: false; error: SystemMetricsError }

export type ServiceScanErrorCode =
  | 'session-not-found'
  | 'not-ready'
  | 'unsupported'
  | 'timeout'
  | 'output-limit'
  | 'rate-limited'
  | 'busy'
  | 'remote-error'
  | 'parse-error'

export interface ServiceScanError {
  code: ServiceScanErrorCode
  message: string
  retryAfterMs?: number
}

/**
 * 一个服务的域名入口 —— 被 nginx 反代到它身上的那个域名。
 *
 * 有意做成扁平结构（带 serviceId 而不是嵌套在服务里）：
 * 它和 `services` / `applications` 一样是**一次扫描的结论**，展开成嵌套会让 IPC 载荷里
 * 同一份数据在多处重复，渲染层也不好在「按应用聚合」和「按服务查」之间切换。
 */
export interface ServiceEntrance {
  /** 落到哪个服务（MergedService.id，形如 `session-1:tcp:30001`） */
  serviceId: string
  /** 主域名 */
  host: string
  /** 可直接打开的地址；根路径就是域名本身，子路径带上路径 */
  url: string
  /** 命中的 location 匹配式 */
  match: string
  /** 前缀 / 精确 / 正则 */
  kind: 'prefix' | 'exact' | 'regex'
  /** 根路径命中 —— 这个域名就是这个服务的入口，而不是「顺带代理了一个子路径」 */
  isRoot: boolean
  /** 域名对外协议（由 nginx 的 listen 是否有 ssl 决定） */
  scheme: 'http' | 'https'
  /** 配置来源文件，便于核对 */
  source: string
}

/**
 * 反向代理层的总览。
 *
 * `files === 0` 表示这台机器没读到 nginx 配置（未安装 / 不可读 / 不是 Linux），
 * 那入口就只能是 IP:port —— 这是正常结果，不是故障，但**必须能看出来是哪种情况**，
 * 否则「域名没显示出来」会被误读成「这台机器没配域名」。
 */
export interface ProxySummary {
  /** 读到的配置文件数 */
  files: number
  /** 识别出的域名数（含没落到本机监听的那些） */
  domains: number
  /** 其中至少有一条路由落到本机服务的域名数 —— 界面上说「已用作入口」的只能算这些 */
  linked: number
  /**
   * 认出域名、但上游不指向本机监听的。**按域名去重**（一个域名下有多条这样的路由时
   * 合成一条，并在 `routes` 里给出条数）——
   * 真机上 `llm.…top` 就是 1 个域名带 2 条路由，按路由数报会变成「2 个域名」，是在说假话。
   *
   * 典型成因是 `proxy_pass http://172.17.0.2:30400`（集群里的 Pod / NodePort）。
   * 单独列出来而不是丢掉，否则界面上这台机器会显得「少了一个域名」。
   */
  external: Array<{ host: string; match: string; upstream: string; reason: string; routes: number }>
  /** 解析 nginx 配置时的告警 */
  warnings: string[]
}

/**
 * 一次端口发现的结果。
 *
 * 收敛链：监听记录 → 服务 → 应用。三级都要给出去 ——
 * 只给最后一层，用户没法核对；只给第一层，就是一张平铺的端口表。
 * 入口（Endpoint）不在这一层：它需要隧道与动作，属于后续能力。
 */
export interface ServiceScanSnapshot {
  /** 主机采集完成时间(Unix milliseconds)。 */
  scannedAt: number
  /** 远端系统信息；未识别时为 null */
  os: { id: string; versionId?: string; prettyName: string } | null
  /** 采集时是否取得 root（决定进程名是否可信） */
  elevated: boolean
  counts: {
    /** 原始监听记录条数（含 v4/v6 重复与系统套接字） */
    sockets: number
    /** 归约后的服务数 */
    services: number
    /** 其中需要隔离的系统后台套接字数 */
    systemSockets: number
    /** 归组后的应用数 */
    applications: number
    /** 识别出的域名数（0 表示这台机器没有可读的反向代理配置） */
    domains: number
  }
  /** 归约后的服务清单，已按监听范围与端口排序 */
  services: ServiceRecord[]
  /** 归组后的应用清单，容器应用在前 */
  applications: Application[]
  /** 服务的域名入口，扁平清单 */
  entrances: ServiceEntrance[]
  /** 反向代理层的采集与解析情况 */
  proxy: ProxySummary
  /** 非致命问题（无法解析的行、权限不足等），每条都指向具体位置 */
  warnings: string[]
}

export type ServiceScanResult =
  | { ok: true; snapshot: ServiceScanSnapshot }
  | { ok: false; error: ServiceScanError }

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

/** Companion runtime 的宿主协议版本；第一版只允许运行纯 Node JS bundle。 */
export type PluginRuntimeKind = 'node-companion-v1'
export type PluginRuntimeLifecycle = 'on-demand' | 'always'
export type PluginRuntimeTransport = 'websocket'

export interface PluginRuntimeManifest {
  kind: PluginRuntimeKind
  /** 相对于插件版本目录的 bundle 路径。 */
  entry: string
  /** runtime bundle 的 SHA-256，和 renderer entry 分开校验。 */
  sha256: string
  size?: number
  lifecycle?: PluginRuntimeLifecycle
  transport: PluginRuntimeTransport
}

/** registry 解析后带有可下载地址的 runtime 描述。 */
export interface MarketPluginRuntime extends PluginRuntimeManifest {
  entryUrl: string
}

export type PluginRuntimeState = 'stopped' | 'starting' | 'ready' | 'error'

export interface PluginRuntimeStateInfo {
  pluginId: string
  state: PluginRuntimeState
  generation?: string
  error?: string
}

export interface PluginRuntimeEndpoint {
  transport: PluginRuntimeTransport
  url: string
  generation: string
}

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
  /** 可选的受控 companion runtime；由宿主安装和启动。 */
  runtime?: MarketPluginRuntime
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
  /** 安装时从 registry 固化的 companion runtime 声明。 */
  runtime?: PluginRuntimeManifest
  /** 仅本次 renderer 会话的宿主 capability，不写入插件 manifest。 */
  runtimeCapability?: string
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
  /**
   * 交给系统默认浏览器打开一个入口地址。
   *
   * 只接受 http / https；其余协议（file: / javascript: / data: 等）与带内嵌凭据的地址
   * 一律拒绝并返回 false —— 不做「猜一个协议」的兜底，猜错就是把用户送去错误的地址。
   */
  openExternal(url: string): Promise<boolean>
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
  pluginRuntime: {
    getEndpoint(capability: string): Promise<PluginRuntimeEndpoint>
    getState(capability: string): Promise<PluginRuntimeStateInfo>
    onState(capability: string, cb: (state: PluginRuntimeStateInfo) => void): () => void
    stop(capability: string): Promise<void>
  }
  monitor: {
    /** 通过当前 SSH 会话获取一次受控 Linux 指标快照。 */
    getSnapshot(sessionId: string): Promise<SystemMetricsResult>
  }
  serviceScan: {
    /**
     * 通过当前 SSH 会话做一次端口发现:跑固定内省命令,归约成服务与应用清单。
     * 只读、不写远端;不做任何形式的连通性探测(不会去连这些端口)。
     */
    run(sessionId: string): Promise<ServiceScanResult>
  }
}
