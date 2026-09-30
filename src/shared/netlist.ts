/**
 * 监听端口采集、解析与服务归约 —— 纯函数层，零运行时依赖。
 *
 * 设计约束（对齐本仓库的既有范式）：
 * - 采集脚本是**固定字符串**，不接受任何用户输入 / 环境变量 / 凭据注入
 * - 解析与归约是**纯函数**，不碰网络、不碰文件系统、不依赖 Electron
 * - 结论必须可解释：每个「这是什么服务」都带一条 source + confidence 的证据
 * - 协议不明时不给结论 —— `unknown` 就是 `unknown`，不猜一个 http:// 出来
 *
 * 全部解析规则都在真实 Ubuntu 24.04 主机上跑过一遍；本文件不含任何真实主机信息，
 * 单测用的是手写的合成 `ss` 输出（见 netlist.test.ts）。
 */

// 只进类型、不进运行时：`vhost.ts` 在类型上依赖本文件的 ServiceRecord，
// 值导入会构成循环，类型导入会被完全抹掉。
import type { VhostLink } from './vhost'

// ---------------------------------------------------------------- 类型

export type TransportProtocol = 'tcp' | 'udp'

/** 监听地址的类型，决定能直连还是必须走隧道 */
export type BindScope = 'all' | 'loopback' | 'specific'

/** 服务归类的用途维度。按「我要找什么」划分，不按协议划分 */
export type ServiceCategory =
  | 'database'
  | 'cache'
  | 'queue'
  | 'monitoring'
  | 'ci-cd'
  | 'storage'
  | 'proxy'
  | 'panel'
  | 'web'
  | 'app'
  | 'ssh'
  | 'unknown'

/** 一条指纹证据的来源，按可信度从高到低排列 */
export type FingerprintSource = 'process' | 'container' | 'tls' | 'http' | 'banner' | 'port-table' | 'manual'

/** 结论的可信度。process 是事实，port-table 是猜测，两者不能混为一谈 */
export type Confidence = 'certain' | 'high' | 'medium' | 'low'

export interface FingerprintEvidence {
  source: FingerprintSource
  /** 原始证据文本，展示给用户看的就是它 */
  value: string
  confidence: Confidence
  service?: string
  observedAt: number
}

export interface SocketProcess {
  name: string
  pid: number
  fd: number
}

export interface ListeningSocket {
  protocol: TransportProtocol
  /** LISTEN / UNCONN */
  state: string
  /** 去掉作用域后缀的监听地址：0.0.0.0 / 127.0.0.1 / :: / 10.0.0.12 */
  bindAddr: string
  /** 原始地址文本，含作用域后缀：127.0.0.53%lo */
  bindAddrRaw: string
  /** 作用域后缀，如 lo / eth0；无则为 undefined */
  scope?: string
  port: number
  family: 4 | 6
  bindScope: BindScope
  /** 内核给出的全部持有进程，可能多于一（nginx master+worker、socket 激活） */
  processes: SocketProcess[]
  /** 选定的归属进程；非 root 时为 null */
  owner: SocketProcess | null
  /** 归属进程是否为 docker-proxy（说明真实服务在容器里） */
  viaDockerProxy: boolean
}

export interface ContainerPortMapping {
  containerName: string
  image: string
  /** 宿主端口 */
  hostPort: number
  /** 容器内端口 */
  containerPort: number
  /** 映射绑定的宿主地址，如 127.0.0.1；未指定时为 undefined */
  bindAddr?: string
  protocol: TransportProtocol
}

export interface NetlistMeta {
  uid: number | null
  /**
   * 采集时是否拿到了 root（决定进程名是否可信）。
   * 不能只看 uid —— `id -u` 跑的是登录用户，与 `ss` 是否走了 sudo 无关，
   * 所以采集脚本额外上报一行 `sudo=1|0`。
   */
  elevated: boolean
  /** 采集脚本是否成功走了 sudo 分支 */
  usedSudo: boolean
  /** ss -V 的原始输出 */
  ssVersion: string | null
}

export interface NetlistOs {
  id: string
  versionId?: string
  prettyName: string
}

export interface ParsedNetlist {
  /** 远端报告的格式版本；非 V1 时上层应拒绝解析 */
  formatVersion: string | null
  /** 远端明确报告「既无 /proc/net/tcp 也无 ss」 */
  unsupported: boolean
  /** 输出里缺少 END 哨兵（被截断） */
  truncated: boolean
  /**
   * 远端没有 ss，本次退化到 `/proc/net/{tcp,udp}` 解析。
   * 这条路径**只能拿到端口，拿不到进程名与所属服务**，结论可信度必然降低 ——
   * 上层需要据此降级展示，不能把结果当成和 ss 路径等价。
   */
  usedProcFallback: boolean
  meta: NetlistMeta
  os: NetlistOs | null
  tcp: ListeningSocket[]
  udp: ListeningSocket[]
  containers: ContainerPortMapping[]
  /**
   * nginx 配置原文（`@@FILE <路径>` / 正文 / `@@END` 分段），交给 `parseNginxSection` 解析。
   *
   * 这里只搬运不解析：域名解析住在 `vhost.ts`，让它反过来依赖本文件会绕成环。
   * 空字符串表示没读到 nginx 配置（未安装、不可读，或远端不是 Linux）——
   * 那是正常情况，所以这里**不记 warning**；要不要提示用户由上层按「域名入口数为 0」决定。
   */
  nginxConfig: string
  /** 解析过程中的非致命问题，每条都对应一个具体行号或字段 */
  warnings: string[]
}

/** 归约后的服务记录 */
export interface ServiceRecord {
  id: string
  /** 采集来源节点。合并/归组时用它拼稳定 id，避免把绑定地址写进标识里 */
  nodeId: string
  port: number
  protocol: TransportProtocol
  bindAddr: string
  bindScope: BindScope
  process?: { name: string; pid: number }
  container?: { name: string; image: string; internalPort?: number; hostPort?: number }
  evidence: FingerprintEvidence[]
  displayName: string
  category: ServiceCategory
  confidence: Confidence
  /**
   * 系统自带的后台套接字（systemd-resolved 存根、DHCP 客户端、NTP），
   * 不是可访问入口。界面默认折叠，但数据保留。
   */
  systemSocket: boolean
  systemSocketReason?: string
}

/** 协议判断结果。`unknown` 是不猜，不是「暂时算 http」 */
export interface SchemeVerdict {
  scheme: 'http' | 'https' | 'unknown'
  /** 判断依据，要能展示给用户看 */
  reason: string
  /** 依据是否足够硬 */
  confident: boolean
}

export type ApplicationKind = 'domain' | 'container' | 'process'

/**
 * 一个「应用」= 一个人会当成一个东西来使用的那组服务。
 *
 * 归组轴的优先级是 **域名 > 容器 > 进程 > 端口**，这是被真机数据逼出来的顺序：
 * 一台机器上一个容器映射了 5 个宿主端口，按容器归组得到「一个叫某容器的东西有 5 个口」，
 * 可那 5 个口背后是 5 个各自有域名、各自独立的服务（博客 / 对象存储 / 存储控制台 / 容器平台 / 模型网关）。
 * 容器只是**怎么部署的**，域名才是**它是什么**。
 * 反过来，没有反向代理的机器上域名轴为空，就自然退回容器/进程轴。
 */
export interface Application {
  id: string
  kind: ApplicationKind
  displayName: string
  /** 归属说明，直接展示给人看，如「容器 rancher · rancher/rancher:v2.10.3」 */
  detail: string
  /** 组内服务，已按「最适合当默认入口」排序 */
  services: ServiceRecord[]
  ports: number[]
  /** 组内最适合当默认入口的那个服务 */
  primaryId: string
  /** 这个应用对外用的域名；由域名轴归组时非空，否则为 null */
  domain: string | null
}

// ---------------------------------------------------------------- 采集脚本

/**
 * 固定、无用户输入的监听端口采集脚本。
 *
 * 关键点：**自己判断能否 sudo**。真机验证表明，非 root 跑 `ss -tlnp` 时
 * `users:(...)` 整段缺失 —— 而进程名恰恰是这条路径的全部价值所在。
 * 因此优先用 `sudo -n`（不弹密码），失败再退回当前用户，最后退化到 /proc。
 *
 * 另一条硬约束：整条脚本**不能出现单引号** —— 它要作为单个参数交给 SSH 下发，
 * 任何 `'` 都会截断外层引号。所以 `tr -d '\n'` 这类写法必须避开。
 */
export const NETLIST_COMMAND: string = [
  // 能力探测：两者都不具备时直接报告不支持，走 exit 78
  'LC_ALL=C; if [ ! -r /proc/net/tcp ] && ! command -v ss >/dev/null 2>&1; then printf "MYSSH_NETLIST_UNSUPPORTED\\n"; exit 78; fi',
  'printf "MYSSH_NETLIST_V1\\n"',
  'printf "[meta]\\n"; printf "uid=%s\\n" "$(id -u 2>/dev/null || echo unknown)"; printf "sudo=%s\\n" "$(if sudo -n true >/dev/null 2>&1; then echo 1; else echo 0; fi)"; printf "ssver=%s\\n" "$(ss -V 2>/dev/null || echo none)"',
  // sudo -n 免密优先；失败退回普通 ss；再失败退化到 /proc（无进程名）
  'printf "[tcplisten]\\n"; sudo -n true >/dev/null 2>&1 && sudo -n ss -H -tlnp 2>/dev/null || ss -H -tlnp 2>/dev/null || cat /proc/net/tcp 2>/dev/null',
  'printf "[udplisten]\\n"; sudo -n true >/dev/null 2>&1 && sudo -n ss -H -ulnp 2>/dev/null || ss -H -ulnp 2>/dev/null || cat /proc/net/udp 2>/dev/null',
  // 容器端口映射；两条命令都失败时该段为空，不影响其他段
  'printf "[containers]\\n"; docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Ports}}" 2>/dev/null || podman ps --format "{{.Names}}\\t{{.Image}}\\t{{.Ports}}" 2>/dev/null',
  // 反向代理配置：域名入口的唯一来源。
  // 只读 nginx 实际加载的三处（nginx.conf / conf.d/*.conf / sites-enabled/*），
  // **故意不读 sites-available** —— 那是未启用的池子，里面还有 .bak 备份，读了会把没生效的域名当成真的。
  // sites-enabled 里通常是软链，`-f` 会跟随软链，打印的是 sites-enabled 下的路径（这才代表「已启用」）。
  // nginx 没装或不可读时该段为空，解析侧据此退回容器/进程归组。
  'printf "[nginxconf]\\n"; for f in /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do if [ -f "$f" ]; then printf "@@FILE %s\\n" "$f"; cat "$f" 2>/dev/null; printf "@@END\\n"; fi; done',
  'printf "[osrelease]\\n"; cat /etc/os-release 2>/dev/null',
  'printf "[identity]\\n"; id -u 2>/dev/null || printf "unknown"',
  'printf "END\\n"'
].join('; ')

export const NETLIST_FORMAT_VERSION = 'MYSSH_NETLIST_V1'
export const NETLIST_UNSUPPORTED_MARKER = 'MYSSH_NETLIST_UNSUPPORTED'

// ---------------------------------------------------------------- 常量

/** 采集超时。内省命令比指标采集重，比 monitor 的 5s 放宽 */
export const NETLIST_TIMEOUT_MS = 8_000
/** 输出上限。端口清单含容器段，比 monitor 的 256KB 加倍 */
export const NETLIST_MAX_OUTPUT_BYTES = 512 * 1024
/** 最小重扫间隔 */
export const NETLIST_MIN_RESCAN_MS = 3_000

/** 本地隧道端口的分配区间，避开常见开发端口 */
export const TUNNEL_PORT_RANGE = { from: 20000, to: 29999 } as const

/**
 * 由远端端口稳定推导本地隧道端口。
 *
 * 「按顺序从 20000 递增」的问题是：重扫时端口集合或顺序一变，
 * 同一个服务分配到的本地端口就漂了，用户收藏的入口地址随之失效。
 * 只依赖远端端口本身，则重启、重扫、增删其他服务都不影响已有入口。
 *
 * 值域：20000 + [0, 8999] = [20000, 28999]，落在 TUNNEL_PORT_RANGE 内。
 * 同节点内若两个远端端口间隔恰为 9000 的整数倍会撞车，调用方需检查并退让。
 */
export function tunnelPortFor(remotePort: number): number {
  return TUNNEL_PORT_RANGE.from + (remotePort % 9000)
}

/**
 * 找出本地隧道端口会撞车的服务。
 *
 * 撞车只有两个来源，都是推导规则本身的边界：
 *  1. 两个远端端口相差 9000 的整数倍（`8080` 与 `17080`）
 *  2. **同一个端口号出现在两种协议上** —— 推导只看端口号、不看协议，
 *     所以自建 DNS 那种 `tcp/53` + `udp/53` 会落到同一个本地端口
 *
 * 不参与的：系统后台套接字（它们不是入口，不会建隧道）、已经绑全网卡的服务（能直连，不需要隧道）。
 *
 * 检测出来了要怎么办由调用方决定：控制台是把冲突端口标出来让人手工改，
 * 而不是悄悄换一个 —— 悄悄换就等于把「稳定」这个前提作废。
 */
export function findTunnelPortCollisions(
  services: ServiceRecord[]
): Array<{ localPort: number; services: ServiceRecord[] }> {
  const byLocal = new Map<number, ServiceRecord[]>()
  for (const s of services) {
    if (s.systemSocket || s.bindScope === 'all') continue
    const local = tunnelPortFor(s.port)
    const arr = byLocal.get(local)
    if (arr) arr.push(s)
    else byLocal.set(local, [s])
  }
  return [...byLocal.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([localPort, list]) => ({ localPort, services: list }))
}

/**
 * 系统后台套接字：出现在端口清单里但不是「入口」。
 * 判据是「进程名 + 该进程的固有职责」，不是端口号 —— 端口号会撞。
 */
const SYSTEM_SOCKET_RULES: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /^systemd-resolve/, reason: 'systemd-resolved DNS 存根解析器，仅本机可用' },
  { re: /^systemd-network/, reason: 'systemd-networkd 的 DHCP 客户端套接字' },
  { re: /^systemd-timesyn/, reason: 'systemd-timesyncd 的 NTP 客户端套接字' },
  { re: /^chronyd$/, reason: 'chrony 的 NTP 服务/客户端套接字' },
  { re: /^dbus-daemon$/, reason: 'D-Bus 本机消息总线' },
  { re: /^avahi-daemon$/, reason: 'avahi 的 mDNS 发现套接字' },
  { re: /^systemd-journald?$/, reason: 'systemd 日志套接字' }
]

/** 进程名 → 服务名与归类。内核返回的进程名是事实，可信度 certain */
const PROCESS_RULES: ReadonlyArray<{ re: RegExp; display: string; category: ServiceCategory }> = [
  { re: /^sshd/, display: 'OpenSSH', category: 'ssh' },
  { re: /^nginx/, display: 'nginx', category: 'proxy' },
  { re: /^(apache2|httpd)$/, display: 'Apache httpd', category: 'proxy' },
  { re: /^caddy$/, display: 'Caddy', category: 'proxy' },
  { re: /^(traefik|envoy|haproxy)$/, display: '反向代理', category: 'proxy' },
  { re: /^(redis-server|redis)$/, display: 'Redis', category: 'cache' },
  { re: /^memcached$/, display: 'Memcached', category: 'cache' },
  { re: /^(mysqld|mariadbd)$/, display: 'MySQL / MariaDB', category: 'database' },
  { re: /^postgres$/, display: 'PostgreSQL', category: 'database' },
  { re: /^(mongod|mongo)$/, display: 'MongoDB', category: 'database' },
  { re: /^etcd$/, display: 'etcd', category: 'database' },
  { re: /^docker-proxy$/, display: 'Docker 端口映射', category: 'unknown' },
  { re: /^kube-/, display: 'Kubernetes 组件', category: 'panel' },
  { re: /^(python3?|python3\.\d+)$/, display: 'Python 服务', category: 'app' },
  { re: /^node$/, display: 'Node 服务', category: 'app' },
  { re: /^java$/, display: 'Java 服务', category: 'app' },
  { re: /^go$/, display: 'Go 服务', category: 'app' }
]

/** 镜像名 → 服务名与归类。容器证据比进程名低一档，可信度 high */
const IMAGE_RULES: ReadonlyArray<{ re: RegExp; display: string; category: ServiceCategory }> = [
  { re: /rancher\/rancher/i, display: 'Rancher', category: 'panel' },
  { re: /portainer/i, display: 'Portainer', category: 'panel' },
  { re: /kuboard/i, display: 'Kuboard', category: 'panel' },
  { re: /grafana/i, display: 'Grafana', category: 'monitoring' },
  { re: /prometheus/i, display: 'Prometheus', category: 'monitoring' },
  { re: /(^|\/)redis/i, display: 'Redis', category: 'cache' },
  { re: /(^|\/)(postgres|postgis)/i, display: 'PostgreSQL', category: 'database' },
  { re: /(^|\/)(mysql|mariadb)/i, display: 'MySQL / MariaDB', category: 'database' },
  { re: /(^|\/)mongo/i, display: 'MongoDB', category: 'database' },
  { re: /minio/i, display: 'MinIO', category: 'storage' },
  { re: /(^|\/)nginx/i, display: 'nginx', category: 'proxy' },
  { re: /traefik/i, display: 'Traefik', category: 'proxy' },
  { re: /(jenkins|gitlab|drone|woodpecker)/i, display: 'CI/CD', category: 'ci-cd' },
  { re: /(rabbitmq|kafka|nats|zookeeper)/i, display: '消息队列', category: 'queue' },
  { re: /(^|\/)(ghcr\.io\/)?cert-manager/i, display: 'cert-manager', category: 'app' }
]

/** 端口兜底表。拿不到进程与容器时才用，可信度 low —— 这是猜测，不是事实 */
const PORT_TABLE: Readonly<Record<number, { display: string; category: ServiceCategory }>> = {
  22: { display: 'SSH', category: 'ssh' },
  53: { display: 'DNS', category: 'app' },
  80: { display: 'HTTP', category: 'web' },
  443: { display: 'HTTPS', category: 'web' },
  2375: { display: 'Docker API（明文）', category: 'panel' },
  2376: { display: 'Docker API（TLS）', category: 'panel' },
  3000: { display: 'Web 应用（常见 3000）', category: 'web' },
  3306: { display: 'MySQL / MariaDB', category: 'database' },
  5432: { display: 'PostgreSQL', category: 'database' },
  5601: { display: 'Kibana', category: 'monitoring' },
  5672: { display: 'RabbitMQ', category: 'queue' },
  6379: { display: 'Redis', category: 'cache' },
  6443: { display: 'Kubernetes API', category: 'panel' },
  8000: { display: 'Web 应用（常见 8000）', category: 'web' },
  8080: { display: 'HTTP 备用端口', category: 'web' },
  8081: { display: 'HTTP 备用端口', category: 'web' },
  8443: { display: 'HTTPS 备用端口', category: 'web' },
  9000: { display: '对象存储 / Web 应用（常见 9000）', category: 'storage' },
  9090: { display: 'Prometheus / Web 控制台', category: 'monitoring' },
  9200: { display: 'Elasticsearch', category: 'database' },
  27017: { display: 'MongoDB', category: 'database' }
}

// ---------------------------------------------------------------- 分节

const SECTION_RE = /^\[([a-z]+)\]$/

interface Sections {
  meta: string[]
  tcp: string[]
  udp: string[]
  containers: string[]
  nginx: string[]
  osrelease: string[]
  identity: string[]
}

/**
 * 采集脚本里的分段标记 → 内部键。两者故意不同名：标记描述「远端在打什么」，键描述「本地放在哪」。
 *
 * 导出是为了让测试能断言「脚本里打的每一个分段标记这里都认得」——
 * 漏一个的后果是那段内容被静默丢掉并记一条 warning，功能像没做一样。
 */
export const NETLIST_SECTION_KEYS: Readonly<Record<string, keyof Sections>> = {
  meta: 'meta',
  tcplisten: 'tcp',
  udplisten: 'udp',
  containers: 'containers',
  nginxconf: 'nginx',
  osrelease: 'osrelease',
  identity: 'identity'
}

function splitSections(lines: string[], warnings: string[]): Sections {
  const out: Sections = { meta: [], tcp: [], udp: [], containers: [], nginx: [], osrelease: [], identity: [] }
  let current: keyof Sections | null = null
  for (const line of lines) {
    const m = SECTION_RE.exec(line)
    if (m) {
      const key = NETLIST_SECTION_KEYS[m[1]]
      if (key) {
        current = key
      } else {
        warnings.push(`未知分段标记 [${m[1]}]，其内容被忽略`)
        current = null
      }
      continue
    }
    if (current) out[current].push(line)
  }
  return out
}

// ---------------------------------------------------------------- 地址解析

interface LocalAddress {
  addr: string
  scope?: string
  port: number
  family: 4 | 6
}

/**
 * 解析 ss 的 `Local Address:Port` 列。
 *
 * 三种必须显式处理的形式（全部来自真实输出）：
 *   `0.0.0.0:22`          —— 常规 IPv4
 *   `[::]:443`            —— IPv6 方括号，必须从最后一个 `]` 之后取端口
 *   `127.0.0.53%lo:53`    —— 带作用域后缀，`%` 之后不是端口的一部分
 */
export function parseLocalAddress(text: string): LocalAddress | null {
  let addrPart: string
  let portPart: string

  if (text.startsWith('[')) {
    const close = text.lastIndexOf(']')
    if (close < 0) return null
    addrPart = text.slice(1, close)
    const rest = text.slice(close + 1)
    if (!rest.startsWith(':')) return null
    portPart = rest.slice(1)
  } else {
    // 注意：这里必须是 lastIndexOf。用 indexOf 在 IPv6 无括号形式下会切错。
    const idx = text.lastIndexOf(':')
    if (idx < 0) return null
    addrPart = text.slice(0, idx)
    portPart = text.slice(idx + 1)
  }

  let scope: string | undefined
  const pct = addrPart.indexOf('%')
  if (pct >= 0) {
    scope = addrPart.slice(pct + 1)
    addrPart = addrPart.slice(0, pct)
  }

  if (!/^\d+$/.test(portPart)) return null
  const port = Number(portPart)
  if (port > 65535) return null

  return { addr: addrPart, scope, port, family: addrPart.includes(':') ? 6 : 4 }
}

/** 由 bindAddr 推导 bindScope。规则固定，界面上不重复解析地址 */
export function deriveBindScope(addr: string): BindScope {
  if (addr === '0.0.0.0' || addr === '::' || addr === '*') return 'all'
  if (addr === '::1' || addr.startsWith('127.')) return 'loopback'
  return 'specific'
}

// ---------------------------------------------------------------- ss 行解析

const USER_RE = /\("([^"]+)",pid=(\d+),fd=(\d+)\)/g

/**
 * 解析一行 `ss -H -tlnp/-ulnp` 输出。
 *
 * 真机踩到的四个坑，逐个处理：
 *  1. 列尾空格**不一致** —— 短行被补齐、长行（一长串 nginx 持有者）没有补，
 *     所以只能整行 trim 后按空白切，不能按固定列宽切。
 *  2. 一个 socket 可以有**多个**持有进程（nginx master + workers、systemd socket 激活）。
 *  3. `sshd + systemd` 这种：systemd 只是**持有 fd 的父进程**（socket 激活），
 *     不是服务本身。归属进程要优先取非 systemd 的那个。
 *  4. `docker-proxy` 说明真实服务在容器里，端口只是映射入口。
 */
export function parseListenLine(line: string, protocol: TransportProtocol): ListeningSocket | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const tokens = trimmed.split(/\s+/)
  if (tokens.length < 5) return null

  const [state, , , localRaw] = tokens
  const local = parseLocalAddress(localRaw)
  if (!local) return null

  const processes: SocketProcess[] = []
  USER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = USER_RE.exec(trimmed)) !== null) {
    processes.push({ name: m[1], pid: Number(m[2]), fd: Number(m[3]) })
  }

  // socket 激活的父进程排在服务进程前面，归属判定要跳过它
  const owner = processes.find((p) => p.name !== 'systemd') ?? (processes.length > 0 ? processes[0] : null)

  return {
    protocol,
    state,
    bindAddr: local.addr,
    bindAddrRaw: localRaw,
    scope: local.scope,
    port: local.port,
    family: local.family,
    bindScope: deriveBindScope(local.addr),
    processes,
    owner,
    viaDockerProxy: owner?.name === 'docker-proxy'
  }
}

// ---------------------------------------------------------------- 容器解析

/** `127.0.0.1:30900-30901->30900-30901/tcp` —— 端口**区间**映射是真会出现的 */
const PORT_MAP_RE =
  /^(?:(?<bind>.+?):)?(?<hFrom>\d+)(?:-(?<hTo>\d+))?->(?<cFrom>\d+)(?:-(?<cTo>\d+))?\/(?<proto>tcp|udp)$/
/** `80/tcp` —— 只声明 EXPOSE，没有映射到宿主 */
const EXPOSE_RE = /^(?<port>\d+)\/(?<proto>tcp|udp)$/

export interface ContainerRecord {
  name: string
  image: string
  mappings: ContainerPortMapping[]
  /** 未映射到宿主的容器内端口 */
  exposedOnly: Array<{ port: number; protocol: TransportProtocol }>
}

/** 解析一行 `docker ps --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"` */
export function parseContainerLine(line: string): ContainerRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const parts = trimmed.split('\t')
  if (parts.length < 2) return null
  const name = parts[0].trim()
  const image = parts[1].trim()
  const portsField = (parts[2] ?? '').trim()

  const mappings: ContainerPortMapping[] = []
  const exposedOnly: Array<{ port: number; protocol: TransportProtocol }> = []

  if (portsField) {
    for (const raw of portsField.split(',')) {
      const seg = raw.trim()
      if (!seg) continue

      const mapped = PORT_MAP_RE.exec(seg)
      if (mapped) {
        const g = mapped.groups as Record<string, string | undefined>
        const proto = g.proto as TransportProtocol
        const hFrom = Number(g.hFrom)
        const hTo = g.hTo ? Number(g.hTo) : hFrom
        const cFrom = Number(g.cFrom)
        const cTo = g.cTo ? Number(g.cTo) : cFrom
        // 区间长度不一致时按偏移量对齐，取两边较小的跨度，避免造出并不存在的映射
        const span = Math.min(hTo - hFrom, cTo - cFrom)
        for (let i = 0; i <= span; i += 1) {
          mappings.push({
            containerName: name,
            image,
            hostPort: hFrom + i,
            containerPort: cFrom + i,
            bindAddr: g.bind,
            protocol: proto
          })
        }
        continue
      }

      const exposed = EXPOSE_RE.exec(seg)
      if (exposed) {
        exposedOnly.push({
          port: Number(exposed.groups!.port),
          protocol: exposed.groups!.proto as TransportProtocol
        })
      }
    }
  }

  return { name, image, mappings, exposedOnly }
}

// ---------------------------------------------------------------- /proc 退化解析

/**
 * `/proc/net/{tcp,udp,tcp6,udp6}` 的行形如：
 *
 * ```
 *   sl  local_address rem_address   st tx_queue rx_queue tr tm->when ...
 *    0: 0100007F:1F90 00000000:0000 0A ...
 * ```
 *
 * 与 ss 完全是两套格式，必须分开解析。真机验证时踩到的点：
 * 如果把它当成 ss 行去解析，整行会因为取不到地址而**静默丢弃** ——
 * 结果是「远端读不出来」和「远端什么都没监听」长得一模一样。所以这条路径必须显式识别。
 */
const PROC_NET_RE = /^\s*\d+:\s+([0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):([0-9A-Fa-f]{4})\s+([0-9A-Fa-f]{8}:[0-9A-Fa-f]{4})\s+([0-9A-Fa-f]{2})\b/

/** TCP 的 LISTEN 状态；/proc/net/tcp 里其他状态都不是监听 */
const PROC_TCP_LISTEN_STATE = '0A'

/**
 * 把 /proc 的十六进制地址还原成可读地址。
 *
 * 编码规则：**每 32 位一组，组内小端**。所以
 *   IPv4 `0100007F` → 7F.00.00.01 → `127.0.0.1`
 *   IPv6 `...01000000` → 末组 0.0.0.1 → `::1`
 */
export function decodeProcAddress(hex: string): { addr: string; family: 4 | 6 } | null {
  if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
    const b = [0, 2, 4, 6].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    return { addr: `${b[3]}.${b[2]}.${b[1]}.${b[0]}`, family: 4 }
  }
  if (/^[0-9A-Fa-f]{32}$/.test(hex)) {
    // 4 组 × 8 位十六进制，每组按小端还原成 4 字节
    const bytes: number[] = []
    for (let g = 0; g < 4; g += 1) {
      const seg = hex.slice(g * 8, g * 8 + 8)
      const pair = [0, 2, 4, 6].map((i) => Number.parseInt(seg.slice(i, i + 2), 16))
      bytes.push(pair[3], pair[2], pair[1], pair[0])
    }
    const words: string[] = []
    for (let i = 0; i < 8; i += 1) words.push(((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16))
    return { addr: compressIpv6(words), family: 6 }
  }
  return null
}

/** 把 8 组十六进制补成标准的最长零段压缩写法（`::` / `::1` / `fe80::1`） */
function compressIpv6(words: string[]): string {
  let bestStart = -1
  let bestLen = 0
  let runStart = -1
  for (let i = 0; i <= words.length; i += 1) {
    const isZero = i < words.length && words[i] === '0'
    if (isZero && runStart < 0) runStart = i
    if (!isZero && runStart >= 0) {
      const len = i - runStart
      // 只压缩长度 >= 2 的零段；单段不压缩，否则 `0:0:...:1` 会写得更难看
      if (len >= 2 && len > bestLen) {
        bestStart = runStart
        bestLen = len
      }
      runStart = -1
    }
  }
  if (bestStart < 0) return words.join(':')
  const head = words.slice(0, bestStart).join(':')
  const tail = words.slice(bestStart + bestLen).join(':')
  return `${head}::${tail}`
}

/**
 * 解析一行 `/proc/net/{tcp,udp}` 输出。
 *
 * 这条路径**拿不到进程名** —— /proc 里没有这个信息，那要 root 读 /proc/<pid>/fd。
 * 所以返回的 socket 一律 `owner: null`，上层据此把可信度降级。
 */
export function parseProcNetLine(line: string, protocol: TransportProtocol): ListeningSocket | null {
  const m = PROC_NET_RE.exec(line)
  if (!m) return null

  const [, localHex, portHex, , stateHex] = m
  // /proc/net/udp 没有 LISTEN 状态（未连接即 07），只有 TCP 需要按状态过滤
  if (protocol === 'tcp' && stateHex.toUpperCase() !== PROC_TCP_LISTEN_STATE) return null

  const decoded = decodeProcAddress(localHex)
  if (!decoded) return null
  const port = Number.parseInt(portHex, 16)
  if (!Number.isFinite(port) || port > 65535) return null

  return {
    protocol,
    state: protocol === 'tcp' ? 'LISTEN' : 'UNCONN',
    bindAddr: decoded.addr,
    bindAddrRaw: decoded.addr,
    port,
    family: decoded.family,
    bindScope: deriveBindScope(decoded.addr),
    processes: [],
    owner: null,
    viaDockerProxy: false
  }
}

// ---------------------------------------------------------------- 主解析入口

/** 解析 KEY=VALUE 形式的段落（/etc/os-release、[meta]）。值两侧的引号要剥掉 */
function parseKeyValueLines(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx)
    let value = line.slice(idx + 1)
    // os-release 规范允许值被双引号或单引号包裹：PRETTY_NAME="Ubuntu 24.04.4 LTS"
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    out[key] = value
  }
  return out
}

/** 解析采集脚本的完整输出。任何一节的缺失都降级处理并记 warning，不抛异常 */
export function parseNetlist(raw: string): ParsedNetlist {
  const warnings: string[] = []
  const lines = raw.split('\n')

  // 首行哨兵：判断远端是否明确报告「不支持」
  let cursor = 0
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1
  const first = (lines[cursor] ?? '').trim()

  let unsupported = false
  let formatVersion: string | null = null
  if (first === NETLIST_UNSUPPORTED_MARKER) {
    unsupported = true
    cursor += 1
  } else if (first === NETLIST_FORMAT_VERSION) {
    formatVersion = first
    cursor += 1
  } else {
    warnings.push(`输出首行不是已知哨兵（实际为 ${JSON.stringify(first)}），按 V1 尽力解析`)
  }

  const body = lines.slice(cursor)
  // END 哨兵：缺失说明输出被截断
  const endIdx = body.findIndex((l) => l.trim() === 'END')
  const truncated = endIdx < 0
  if (truncated) warnings.push('输出缺少 END 哨兵，可能被输出上限截断')
  const effective = endIdx >= 0 ? body.slice(0, endIdx) : body

  const sections = splitSections(effective, warnings)

  const metaKv = parseKeyValueLines(sections.meta.filter((l) => l.trim() !== ''))
  const uidRaw = metaKv.uid
  const uid = uidRaw && /^\d+$/.test(uidRaw) ? Number(uidRaw) : null
  const identityRaw = sections.identity.map((l) => l.trim()).find((l) => l !== '') ?? ''
  const identityUid = /^\d+$/.test(identityRaw) ? Number(identityRaw) : null
  const effectiveUid = uid ?? identityUid
  const ssVersion = metaKv.ssver && metaKv.ssver !== 'none' ? metaKv.ssver : null

  // sudo 标记优先于 uid：uid 是登录用户，与 ss 是否提权无关
  const usedSudo = metaKv.sudo === '1'
  const elevated = usedSudo || effectiveUid === 0

  const tcp: ListeningSocket[] = []
  let usedProcFallback = false
  for (const [i, line] of sections.tcp.entries()) {
    if (!line.trim()) continue
    // /proc 的表头行只表示「这一节是 /proc 格式」，本身不是记录，也不算解析失败
    if (/^sl\s+local_address/.test(line.trim())) {
      usedProcFallback = true
      continue
    }
    if (PROC_NET_RE.test(line)) {
      usedProcFallback = true
      const parsed = parseProcNetLine(line, 'tcp')
      if (parsed) tcp.push(parsed)
      continue
    }
    const parsed = parseListenLine(line, 'tcp')
    if (parsed) tcp.push(parsed)
    else warnings.push(`[tcplisten] 第 ${i + 1} 行无法解析：${line.trim().slice(0, 80)}`)
  }

  const udp: ListeningSocket[] = []
  for (const [i, line] of sections.udp.entries()) {
    if (!line.trim()) continue
    if (/^sl\s+local_address/.test(line.trim())) {
      usedProcFallback = true
      continue
    }
    if (PROC_NET_RE.test(line)) {
      usedProcFallback = true
      const parsed = parseProcNetLine(line, 'udp')
      if (parsed) udp.push(parsed)
      continue
    }
    const parsed = parseListenLine(line, 'udp')
    if (parsed) udp.push(parsed)
    else warnings.push(`[udplisten] 第 ${i + 1} 行无法解析：${line.trim().slice(0, 80)}`)
  }

  const containers: ContainerPortMapping[] = []
  for (const line of sections.containers) {
    const record = parseContainerLine(line)
    if (record) containers.push(...record.mappings)
  }

  const osKv = parseKeyValueLines(sections.osrelease.filter((l) => l.trim() !== ''))
  const os: NetlistOs | null = osKv.ID
    ? { id: osKv.ID, versionId: osKv.VERSION_ID, prettyName: osKv.PRETTY_NAME ?? osKv.ID }
    : null

  // 端口拿到了但一个进程名都没有 —— 权限不足的典型特征，必须提示可提权重扫。
  // 真机实测：非 root 时 users:(...) 整段缺失，不能把它当成「没有服务在跑」。
  const hasSockets = tcp.length + udp.length > 0
  const anyProcessNamed = [...tcp, ...udp].some((s) => s.owner !== null)
  if (usedProcFallback) {
    warnings.push('远端没有 ss，本次退化到 /proc/net/*：只拿到端口，拿不到进程名与所属服务')
  } else if (hasSockets && !anyProcessNamed && !elevated) {
    warnings.push('未取得 root 权限，进程名不可见；提权重扫可看到服务归属')
  }

  return {
    formatVersion,
    unsupported,
    truncated,
    usedProcFallback,
    meta: { uid: effectiveUid, elevated, usedSudo, ssVersion },
    os,
    tcp,
    udp,
    containers,
    nginxConfig: sections.nginx.join('\n'),
    warnings
  }
}

// ---------------------------------------------------------------- 归约

function matchProcess(name: string): { display: string; category: ServiceCategory } | null {
  for (const rule of PROCESS_RULES) {
    if (rule.re.test(name)) return { display: rule.display, category: rule.category }
  }
  return null
}

function matchImage(image: string): { display: string; category: ServiceCategory } | null {
  for (const rule of IMAGE_RULES) {
    if (rule.re.test(image)) return { display: rule.display, category: rule.category }
  }
  return null
}

function matchSystemSocket(name: string): string | null {
  for (const rule of SYSTEM_SOCKET_RULES) {
    if (rule.re.test(name)) return rule.reason
  }
  return null
}

/**
 * 判断一个服务该用什么协议打开。
 *
 * 这里体现容器映射的价值：宿主端口 8080 本身看不出协议，
 * 但 `8080 → 容器 80` 就直接说明了它是 HTTP。
 *
 * 判不出来时返回 `unknown`，**不返回一个猜测的 http** —— 上层要据此展示两个候选地址。
 */
export function inferScheme(service: ServiceRecord): SchemeVerdict {
  const internal = service.container?.internalPort
  const p = service.port

  if (p === 22 || service.category === 'ssh') {
    return { scheme: 'unknown', reason: 'SSH 服务，用终端进入', confident: true }
  }
  if (internal === 443) return { scheme: 'https', reason: '容器内是 443，按约定为 HTTPS', confident: true }
  if (internal === 80) return { scheme: 'http', reason: '容器内是 80，确认为 HTTP', confident: true }
  if (internal === 8443) return { scheme: 'https', reason: '容器内是 8443，按约定为 HTTPS', confident: true }
  if (p === 443) return { scheme: 'https', reason: '端口 443，标准 HTTPS', confident: true }
  if (p === 80) return { scheme: 'http', reason: '端口 80，标准 HTTP', confident: true }
  if (p === 8443) return { scheme: 'https', reason: '端口 8443，约定为 HTTPS', confident: true }
  if (p === 8080 || p === 3000 || p === 8000) {
    return { scheme: 'http', reason: '常见 HTTP 替代端口，按约定推断', confident: true }
  }
  return { scheme: 'unknown', reason: '端口本身看不出协议，两个都备着', confident: false }
}

/**
 * 把一个监听 socket 归约成 ServiceRecord。
 *
 * 证据链按可信度倒序排列，`category` 取最高那条；同为最高且冲突时取先出现的。
 * 不为了让结论好看去调阈值 —— unknown 就是 unknown。
 */
export function toServiceRecord(
  socket: ListeningSocket,
  containers: ContainerPortMapping[],
  nodeId: string,
  now: number
): ServiceRecord {
  const evidence: FingerprintEvidence[] = []
  let processClaimsService = false

  // 1) 进程证据：内核说的，事实级别
  if (socket.owner) {
    // docker-proxy 是「端口映射」这个动作的实现细节，不是服务身份。
    // 真机上某个管理面板的归属进程就是 docker-proxy，真实服务在容器里 ——
    // 如果让它认领服务名，就会把容器里的服务判成 unknown。所以它只进证据链，不参与归约。
    const isProxyArtifact = socket.owner.name === 'docker-proxy'
    const mapped = isProxyArtifact ? null : matchProcess(socket.owner.name)
    processClaimsService = mapped !== null

    // 同一 socket 的其余持有者（nginx worker、socket 激活的 systemd）也要留在证据里。
    // 只记归属进程会让「一端口多进程」这个事实在界面上凭空消失。
    const others = socket.processes.filter((p) => p.pid !== socket.owner!.pid)
    const suffix =
      others.length > 0 ? `  ← 同一 socket 另由 ${others.map((p) => `${p.name}(pid ${p.pid})`).join('、')} 持有` : ''

    evidence.push({
      source: 'process',
      value: `${socket.owner.name} (pid ${socket.owner.pid})${suffix}`,
      confidence: 'certain',
      service: mapped?.display,
      observedAt: now
    })
  }

  // 2) 容器证据：docker ps 的端口映射，把宿主端口接回容器
  const mapping = containers.find((c) => c.hostPort === socket.port && c.protocol === socket.protocol)
  let container: ServiceRecord['container']
  let containerClaimsService = false
  if (mapping) {
    container = {
      name: mapping.containerName,
      image: mapping.image,
      internalPort: mapping.containerPort,
      hostPort: mapping.hostPort
    }
    const imageMatch = matchImage(mapping.image)
    containerClaimsService = imageMatch !== null
    evidence.push({
      source: 'container',
      value: `${mapping.containerName} ← ${mapping.image}  (宿主 ${mapping.hostPort} → 容器 ${mapping.containerPort}/${mapping.protocol})`,
      confidence: 'high',
      service: imageMatch?.display,
      observedAt: now
    })
  }

  // 3) 端口兜底：前两层都没认领出服务名时才用，明确标 low —— 这是猜测不是事实
  const portHint = PORT_TABLE[socket.port]
  if (!processClaimsService && !containerClaimsService && portHint) {
    evidence.push({
      source: 'port-table',
      value: `端口 ${socket.port}（常见用途，非本机实测）`,
      confidence: 'low',
      service: portHint.display,
      observedAt: now
    })
  }

  // 归约：evidence 已按可信度倒序，取**第一条认领了服务名**的
  const claim = evidence.find((e) => e.service !== undefined)

  let displayName: string
  let category: ServiceCategory
  let confidence: Confidence

  if (claim) {
    displayName = claim.service as string
    confidence = claim.confidence
    if (claim.source === 'container' && mapping) {
      category = matchImage(mapping.image)?.category ?? 'unknown'
    } else if (claim.source === 'process' && socket.owner) {
      category = matchProcess(socket.owner.name)?.category ?? 'unknown'
    } else if (claim.source === 'port-table') {
      category = portHint?.category ?? 'unknown'
    } else {
      category = 'unknown'
    }
  } else if (socket.owner && socket.owner.name !== 'docker-proxy') {
    // 认不出是什么服务，但至少知道是哪个进程在跑 —— 直接显示进程名，
    // 比显示「端口 53」对用户有用得多。
    displayName = `${socket.owner.name} · 端口 ${socket.port}`
    category = 'unknown'
    confidence = 'medium'
  } else {
    displayName = `端口 ${socket.port}`
    category = 'unknown'
    confidence = 'low'
  }

  const systemReason = socket.owner ? matchSystemSocket(socket.owner.name) : null

  return {
    id: `${nodeId}:${socket.protocol}:${socket.bindAddr}:${socket.port}`,
    nodeId,
    port: socket.port,
    protocol: socket.protocol,
    bindAddr: socket.bindAddr,
    bindScope: socket.bindScope,
    process: socket.owner ? { name: socket.owner.name, pid: socket.owner.pid } : undefined,
    container,
    evidence,
    displayName,
    category,
    confidence,
    systemSocket: systemReason !== null,
    systemSocketReason: systemReason ?? undefined
  }
}

export interface BuildServicesOptions {
  nodeId: string
  now: number
  /** 是否保留系统后台套接字（DNS 存根 / DHCP / NTP）。默认保留，由界面决定是否折叠 */
  includeSystemSockets?: boolean
}

/** 把一次解析结果整体归约成服务清单 */
export function buildServices(parsed: ParsedNetlist, options: BuildServicesOptions): ServiceRecord[] {
  const includeSystem = options.includeSystemSockets !== false
  const all = [...parsed.tcp, ...parsed.udp]
  const records = all.map((s) => toServiceRecord(s, parsed.containers, options.nodeId, options.now))

  const filtered = includeSystem ? records : records.filter((r) => !r.systemSocket)

  // 排序：先按监听范围（可直连的在前），再按端口。
  // 用户打开这个列表是为了找入口，loopback 的需要隧道，排在后面更合理。
  const scopeWeight: Record<BindScope, number> = { all: 0, specific: 1, loopback: 2 }
  return filtered.sort((a, b) => scopeWeight[a.bindScope] - scopeWeight[b.bindScope] || a.port - b.port)
}

// ---------------------------------------------------------------- 按端口合并

/** 同一个 (协议, 端口) 上合并后的服务 —— 双栈是同一个服务的两条绑定 */
export interface MergedService extends ServiceRecord {
  family: 'v4' | 'v6' | 'both'
  /** 该端口上出现过的全部绑定地址 */
  bindAddrs: string[]
  /** 该端口上内核返回过的全部持有进程数（去重前） */
  holderCount: number
}

/**
 * 收敛的第一步：把同一个 (协议, 端口) 的多条监听记录并成一条服务。
 *
 * `0.0.0.0:80` 和 `[::]:80` 是**同一个服务的两条绑定**，不是两个入口。
 * 不做这一步，双栈机上每个服务都会以两行出现，界面第一眼就废了。
 */
export function mergeByPort(services: ServiceRecord[]): MergedService[] {
  const groups = new Map<string, ServiceRecord[]>()
  for (const s of services) {
    const key = `${s.protocol}:${s.port}`
    const arr = groups.get(key)
    if (arr) arr.push(s)
    else groups.set(key, [s])
  }

  const out: MergedService[] = []
  for (const arr of groups.values()) {
    const first = arr[0]
    const families = new Set(arr.map((s) => (s.bindAddr.includes(':') ? 'v6' : 'v4')))
    const family: 'v4' | 'v6' | 'both' = families.size === 2 ? 'both' : families.has('v6') ? 'v6' : 'v4'
    const scopes = arr.map((s) => s.bindScope)
    // 合并后取“最开放”的范围：v4 绑 0.0.0.0、v6 绑 [::]，本质都是全网卡
    const scope: BindScope = scopes.includes('all') ? 'all' : scopes.includes('specific') ? 'specific' : 'loopback'
    const holderCount = arr.reduce(
      (n, s) => n + (s.evidence.find((e) => e.source === 'process')?.value.match(/pid /g)?.length ?? 1),
      0
    )
    out.push({
      ...first,
      // 合并后的标识按 (协议, 端口) 稳定：沿用第一条的 id 会把绑定地址写进身份里，
      // 换个绑定顺序 id 就变了，钉住的入口会跟着失效。
      id: `${first.nodeId}:${first.protocol}:${first.port}`,
      bindScope: scope,
      bindAddrs: arr.map((s) => s.bindAddr),
      family,
      holderCount
    })
  }

  const weight: Record<BindScope, number> = { all: 0, specific: 1, loopback: 2 }
  return out.sort((a, b) => weight[a.bindScope] - weight[b.bindScope] || a.port - b.port)
}

// ---------------------------------------------------------------- 应用归组

/**
 * 归组键：容器优先按容器名，非容器按进程名。
 *
 * 这里有意**不看端口号** —— 端口号是「怎么连」，不是「是什么东西」。
 * 反例：同一个容器的 30001 和 30900 号段完全无关，但那是同一个应用。
 */
function appKeyFor(s: ServiceRecord): { id: string; kind: ApplicationKind; detail: string } {
  if (s.container) {
    return {
      id: `container:${s.container.name}`,
      kind: 'container',
      detail: `容器 ${s.container.name} · ${s.container.image}`
    }
  }
  if (s.process) {
    return { id: `process:${s.process.name}`, kind: 'process', detail: `进程 ${s.process.name}` }
  }
  return { id: `port:${s.protocol}:${s.port}`, kind: 'process', detail: '未识别持有者' }
}

/** 组内排序用的「当默认入口有多合适」：协议越确定越靠前，https 优先于 http */
const SCHEME_RANK: Record<SchemeVerdict['scheme'], number> = { https: 0, http: 1, unknown: 2 }

function primaryWeight(s: ServiceRecord): number {
  const verdict = inferScheme(s)
  return (verdict.confident ? 0 : 100) + SCHEME_RANK[verdict.scheme] * 10
}

export interface GroupApplicationsOptions {
  /** 是否把系统后台套接字也算进应用。默认为否 —— 它们不是入口 */
  includeSystemSockets?: boolean
  /**
   * 反向代理的域名链接结果。传了就先按域名归组，没传就退回容器/进程归组。
   * 类型是 `import type` 进来的：`vhost.ts` 在类型上依赖本文件的 `ServiceRecord`，
   * 用类型导入让这条边在运行时被完全抹掉，不构成循环。
   */
  links?: VhostLink[]
}

/**
 * 把服务清单收成「应用」清单。
 *
 * 这是「管理」和「平铺」的分界：真机上 9 个入口里有 5 个出自同一个容器，
 * 不收这一层，界面上就是 5 行长得一样的东西。
 *
 * 已修的一处误判：原先只有容器/进程两把尺子，于是「一个容器映射 5 个宿主端口」
 * 会收成「一个应用 5 个口」，可那 5 个口其实各有各的域名，是 5 个独立的服务。
 * 现在域名优先 —— 域名才是应用的名字，容器只是它怎么被部署的。
 *
 * 已知边界：没有反向代理时，同名进程仍会被并成一个应用。两个不同项目的 `python3`
 * 服务会落在一起；要处理它得引入工作目录或 cgroup 作为第二判据，目前没做。
 */
export function groupApplications(
  services: ServiceRecord[],
  options: GroupApplicationsOptions = {}
): Application[] {
  const includeSystem = options.includeSystemSockets === true
  const source = includeSystem ? services : services.filter((s) => !s.systemSocket)
  const byId = new Map(source.map((s) => [s.id, s]))

  const built: Application[] = []
  // 已经被某个域名认领过的服务：另一个域名再指向它时只是**别名入口**，
  // 不能再造一个应用卡片，否则同一个服务会在界面上出现两次。
  // 别名没有被丢掉 —— 它仍然在该服务的 entrances 清单里。
  const claimed = new Set<string>()

  for (const link of options.links ?? []) {
    if (link.anchorPort === null) continue
    const anchor =
      source.find((s) => s.port === link.anchorPort && s.protocol === 'tcp') ??
      source.find((s) => s.port === link.anchorPort)
    if (!anchor || claimed.has(anchor.id)) continue

    // 成员 = 根路径的本体 + 被这个域名的子路径引用的服务。
    // 子路径也是同一个应用：`域名/stats/` 是人眼里的「这个站的一个页面」，不是另一个东西。
    const members: ServiceRecord[] = [anchor]
    for (const { service } of link.routes) {
      if (!service || service.id === anchor.id) continue
      const member = byId.get(service.id)
      if (member && !members.some((m) => m.id === member.id)) members.push(member)
    }
    for (const m of members) claimed.add(m.id)

    const files = link.vhost.files.join('、')
    built.push({
      id: `domain:${link.vhost.primaryName}`,
      kind: 'domain',
      displayName: link.vhost.primaryName,
      detail: `反代站点 · 上游 ${anchor.bindAddr}:${anchor.port} · ${files}`,
      // 本体永远排第一（它就是默认入口），附属页面按端口排
      services: [anchor, ...members.slice(1).sort((a, b) => a.port - b.port)],
      ports: members.map((s) => s.port),
      primaryId: anchor.id,
      domain: link.vhost.primaryName
    })
  }

  const rest = source.filter((s) => !claimed.has(s.id))
  const groups = new Map<string, { key: ReturnType<typeof appKeyFor>; list: ServiceRecord[] }>()
  for (const s of rest) {
    const key = appKeyFor(s)
    const g = groups.get(key.id)
    if (g) g.list.push(s)
    else groups.set(key.id, { key, list: [s] })
  }

  for (const { key, list } of groups.values()) {
    // 组内排序：最适合当默认入口的排前面。同权重按端口号，保证结果稳定
    const sorted = [...list].sort((a, b) => primaryWeight(a) - primaryWeight(b) || a.port - b.port)
    built.push({
      id: key.id,
      kind: key.kind,
      displayName: sorted[0].displayName,
      detail: key.detail,
      services: sorted,
      ports: sorted.map((s) => s.port),
      primaryId: sorted[0].id,
      domain: null
    })
  }

  // 域名应用排最前面（有域名的才是「应用」，人真正会去用的入口），
  // 然后容器、进程，再按端口数降序，最后按最小端口号保证稳定。
  // 域名之间按域名排序：它们的名字就是身份，按端口排会显得像偶然顺序
  const kindRank = (k: ApplicationKind): number => (k === 'domain' ? 0 : k === 'container' ? 1 : 2)
  return built.sort((a, b) => {
    const byKind = kindRank(a.kind) - kindRank(b.kind)
    if (byKind !== 0) return byKind
    if (a.kind === 'domain') {
      return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0
    }
    return b.ports.length - a.ports.length || a.ports[0] - b.ports[0]
  })
}
