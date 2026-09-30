import {
  buildServices,
  findTunnelPortCollisions,
  groupApplications,
  inferScheme,
  mergeByPort,
  parseNetlist,
  tunnelPortFor,
  type Application,
  type ServiceRecord
} from './netlist'
import {
  domainEntrancesFor,
  domainUrl,
  isLoopbackHost,
  linkVhosts,
  parseNginxSection,
  type VhostParseResult,
  type VhostRoute,
  type VhostLink
} from './vhost'
import type { ProxySummary, ServiceEntrance, ServiceScanSnapshot } from './types'

/**
 * 端口发现面板的视图模型。
 *
 * 做成纯函数放在 shared 层（不碰 DOM、不碰 Electron），是因为这里每一条都是
 * **可错的产品判断**：「哪些记录合成一个应用」「默认入口取哪个」「协议不知道时给出什么」。
 * 放进组件里就只能靠截图判断对错；放在这里可以用断言锁住。
 *
 * 全部输入来自一次扫描快照，不读时钟以外的任何环境状态。
 */

/** 描述入口所需的连接信息；来自 Profile，不含任何凭据内容 */
export interface EntranceEndpoint {
  host: string
  sshPort: number
  username: string
  /** 私钥路径（密码认证时为空）。只用于拼可复制的 ssh 命令，不读取文件 */
  keyPath?: string
}

/**
 * 一次远端采集的原始输出 → 面板要的全部结论。
 *
 * 把这条链子收在一个纯函数里，是为了让**测试跑的就是线上跑的那一份**：
 * 之前在测试里各自手搭一遍快照，结果测的是一个不存在的中间态 ——
 * 断言全绿，面板上却是另一回事。这里只依赖文本输入，主进程只负责取回文本。
 *
 * 返回 null 表示远端已明确报告「不可支持」（既无 ss 也读不到 /proc/net/tcp）。
 */
export function buildScanSnapshot(
  raw: string,
  options: { nodeId: string; now: number }
): ServiceScanSnapshot | null {
  const parsed = parseNetlist(raw)
  if (parsed.unsupported) return null

  // 收敛链：监听记录 → 服务 →（域名）→ 应用。
  // 域名这一层是可选的：没读到 nginx 配置时 vhosts 为空，归组自然退回容器/进程轴。
  const records = buildServices(parsed, { nodeId: options.nodeId, now: options.now })
  const services = mergeByPort(records)
  const vhosts = parseNginxSection(parsed.nginxConfig)
  const links = linkVhosts(services, vhosts.vhosts)
  const applications = groupApplications(services, { links })

  return {
    scannedAt: options.now,
    os: parsed.os,
    elevated: parsed.meta.elevated,
    counts: {
      sockets: records.length,
      services: services.length,
      systemSockets: services.filter((s) => s.systemSocket).length,
      applications: applications.length,
      domains: vhosts.vhosts.length
    },
    services,
    applications,
    entrances: buildServiceEntrances(links),
    proxy: buildProxySummary(vhosts, links),
    warnings: parsed.warnings
  }
}

export type EntranceProtocol = 'http' | 'https' | 'unknown'

/**
 * 入口的第一动作。
 *  - open：协议确定，直接打开
 *  - choose：协议看不出来，把 http / https 两个候选都摆出来让人自己选
 *  - ssh：这是终端入口，不是网页
 */
export type EntranceAction = 'open' | 'choose' | 'ssh'

export interface EntranceView {
  service: ServiceRecord
  action: EntranceAction
  protocol: EntranceProtocol
  /** 协议判断依据，直接展示（用户要能核对，而不是只能信任） */
  protocolReason: string
  /** 展示用的地址；协议未知时是裸 host:port，绝不补一个 http:// */
  address: string
  /** 可直接打开的地址；协议未知或不是 http(s) 时为 null */
  openUrl: string | null
  /** 协议未知时给出的两个候选，由人选择 */
  schemeChoices: string[]
  /**
   * 这个入口本身要不要先建隧道。
   *
   * 有域名时是 false —— 走域名不需要隧道。但注意 `tunnelCommand` **不会**因此消失：
   * 下面那个「绕过 nginx 直连端口」的备选地址仍然是只对本机监听的端口，
   * 没有隧道命令它就只是一串打不开的字。
   */
  needsTunnel: boolean  /** 需要隧道时的本地回环地址 */
  localAddress: string | null
  /** 需要隧道时可直接粘贴到终端执行的命令 */
  tunnelCommand: string | null
  /** 需要终端入口时的 ssh 命令 */
  sshCommand: string | null
  /** 隧道端口与别的服务撞车时，列出对方的「端口/协议」标签 */
  localPortConflicts: string[]
  /** 这个服务的域名入口（根路径优先）。有它时 `address` / `openUrl` 就是域名 */
  domain: ServiceEntrance | null
  /**
   * 不走域名时的直连写法（IP:端口）。
   * 只在有域名时才有值 —— 那时候它是一条**备注**：域名解析坏了、证书过期了，
   * 这个地址仍然通。没有域名时 `address` 本身就是直连写法，不必重复一遍。
   */
  directAddress: string | null
  directOpenUrl: string | null
}

export interface PortChip {
  port: number
  protocol: ServiceRecord['protocol']
  label: string
  isPrimary: boolean
  needsTunnel: boolean
  /** 该端口是不是系统后台套接字（默认折叠区里用） */
  systemSocket: boolean
  /** 这个端口有没有域名入口 —— 有的话「需隧道」的提示就不该出现 */
  hasDomain: boolean
}

export interface ApplicationView {
  app: Application
  title: string
  kindLabel: string
  detail: string
  /** 这个应用对外用的域名（反代已配置时）；没有时为 null */
  domain: string | null
  /** 默认入口 */
  primary: EntranceView
  chips: PortChip[]
  /** 全部端口的入口，用于展开后逐个进入 */
  entrances: EntranceView[]
}

export interface ScanOverview {
  sockets: number
  services: number
  systemSockets: number
  applications: number
  /** 需要进入的那个数字：服务里排除掉系统后台套接字 */
  accessible: number
  /** 「16 监听记录 → 12 服务 → 8 入口 → 4 应用」 */
  chainText: string
}

/** 远端地址里表示「所有网卡」的写法，隧道目标要换成回环 */
const ANY_ADDRESS = new Set(['0.0.0.0', '::', '*'])

function remoteTarget(service: ServiceRecord): string {
  return ANY_ADDRESS.has(service.bindAddr) ? '127.0.0.1' : service.bindAddr
}

function hostPort(host: string, port: number): string {
  // IPv6 字面量在 URL 与 ssh 命令里都必须带方括号
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export function needsTunnel(service: ServiceRecord): boolean {
  return !service.systemSocket && service.bindScope !== 'all'
}

export function buildTunnelCommand(
  service: ServiceRecord,
  endpoint: EntranceEndpoint,
  localPort: number
): string {
  const forward = `127.0.0.1:${localPort}:${remoteTarget(service)}:${service.port}`
  const key = endpoint.keyPath ? ` -i ${endpoint.keyPath}` : ''
  return `ssh -N -L ${forward} -p ${endpoint.sshPort}${key} ${endpoint.username}@${endpoint.host}`
}

export function buildSshCommand(service: ServiceRecord, endpoint: EntranceEndpoint): string {
  const key = endpoint.keyPath ? ` -i ${endpoint.keyPath}` : ''
  const port = service.port === 22 ? '' : ` -p ${service.port}`
  return `ssh${port}${key} ${endpoint.username}@${endpoint.host}`
}

/**
 * 把一条服务记录翻成「点得动的东西」。
 * 协议未知时不猜：地址保持裸 host:port，打开动作降级成「两个候选让人挑」。
 *
 * 传了 `domain` 就**优先用域名**：人访问这些服务本来用的就是域名，
 * 而且走域名不需要建隧道 —— 之前展示 `IP:8443` 并要求先建隧道，
 * 是把这个面板自己的实现手段当成了用户的入口，属于本末倒置。
 * 直连写法降级成一行备注，域名失效时仍然可用。
 */
export function buildEntrance(
  service: ServiceRecord,
  endpoint: EntranceEndpoint,
  collisions: Map<number, string[]> = new Map(),
  domain: ServiceEntrance | null = null
): EntranceView {
  const verdict = inferScheme(service)
  const tunnel = needsTunnel(service)
  const localPort = tunnelPortFor(service.port)
  const reachable = tunnel ? '127.0.0.1' : endpoint.host
  const reachablePort = tunnel ? localPort : service.port
  const raw = hostPort(reachable, reachablePort)
  const isSsh = service.category === 'ssh'
  // 域名入口对 SSH 服务没有意义：没有人在浏览器里打开一个 ssh 端口
  const useDomain = domain !== null && !isSsh

  const schemeChoices =
    !useDomain && verdict.scheme === 'unknown' && !isSsh ? [`http://${raw}`, `https://${raw}`] : []

  const action: EntranceAction = useDomain
    ? 'open'
    : isSsh
      ? 'ssh'
      : verdict.confident && verdict.scheme !== 'unknown'
        ? 'open'
        : 'choose'

  const protocol: EntranceProtocol = useDomain ? domain.scheme : verdict.scheme
  const address = useDomain ? domain.url : protocol === 'unknown' ? raw : `${protocol}://${raw}`

  return {
    service,
    action,
    protocol,
    protocolReason: useDomain
      ? `反向代理入口：${domain.host}${domain.isRoot ? '' : domain.match} → ${service.bindAddr}:${service.port}（配置在 ${domain.source}）`
      : verdict.reason,
    address,
    openUrl: action === 'open' && protocol !== 'unknown' ? address : null,
    schemeChoices,
    // 走域名就不需要隧道了：隧道是为了让本机浏览器够到只监听回环的端口，
    // 而域名由远端的 nginx 转到那个端口。
    // 但隧道**命令**照给：备选地址还是那个只监听回环的端口，没命令就等于给了一串打不开的字
    needsTunnel: useDomain ? false : tunnel,
    localAddress: tunnel ? `127.0.0.1:${localPort}` : null,
    tunnelCommand: tunnel ? buildTunnelCommand(service, endpoint, localPort) : null,
    sshCommand: isSsh ? buildSshCommand(service, endpoint) : null,
    localPortConflicts: tunnel ? (collisions.get(localPort) ?? []) : [],
    domain: useDomain ? domain : null,
    directAddress: useDomain ? raw : null,
    directOpenUrl:
      useDomain && verdict.scheme !== 'unknown' ? `${verdict.scheme}://${raw}` : useDomain ? null : null
  }
}

/**
 * 域名入口 → 扁平清单（IPC 载荷）。
 *
 * 复用 `domainEntrancesFor` / `domainUrl`，不在这里重写一遍「哪个算入口、URL 怎么拼」——
 * 那两条规则已经在 `vhost.test.ts` 里被断言锁住了，复制一份等于把它们变成两处真相。
 */
export function buildServiceEntrances(links: VhostLink[]): ServiceEntrance[] {
  const out: ServiceEntrance[] = []
  for (const [serviceId, entrances] of domainEntrancesFor(links)) {
    for (const entrance of entrances) {
      out.push({
        serviceId,
        host: entrance.vhost.primaryName,
        url: domainUrl(entrance),
        match: entrance.match,
        kind: entrance.kind,
        isRoot: entrance.isRoot,
        scheme: entrance.vhost.scheme,
        source: entrance.vhost.files.join('、')
      })
    }
  }
  // 稳定排序：域名 → 根路径优先 → 路径。界面按这个顺序展示「还有哪些入口」，
  // 顺序不稳定会让人以为重扫之后配置变了
  return out.sort(
    (a, b) =>
      (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
      Number(b.isRoot) - Number(a.isRoot) ||
      (a.match < b.match ? -1 : a.match > b.match ? 1 : 0)
  )
}

/** 某个服务的域名入口，按上面的顺序取第一条当默认 */
export function entrancesByService(entrances: ServiceEntrance[]): Map<string, ServiceEntrance[]> {
  const out = new Map<string, ServiceEntrance[]>()
  for (const e of entrances) {
    const list = out.get(e.serviceId)
    if (list) list.push(e)
    else out.set(e.serviceId, [e])
  }
  return out
}

/**
 * 上游为什么落不到本机 —— 直接展示给人的一句话。
 * 四种成因要分开说：它们对「我该去改什么」的指向完全不同。
 */
export function unlinkedReason(route: VhostRoute): string {
  const up = route.upstream
  if (!up) return '这条 location 只有跳转，没有上游'
  if (up.unresolved) {
    return `上游写的是 ${up.host}（upstream 名或带变量），静态解析不出端口`
  }
  if (!isLoopbackHost(up.host)) {
    return `上游 ${up.host}:${up.port ?? '?'} 不在本机 —— 本机就算有同号端口也不是它`
  }
  return `本机没有监听 ${up.port}`
}

/**
 * 反向代理层的总览。
 * 域名的「总数」用 vhosts 的条数（合并过 80/443），不是 server 块条数 —— 否则会翻倍。
 */
export function buildProxySummary(parsed: VhostParseResult, links: VhostLink[]): ProxySummary {
  // 按域名去重：一个域名下可能有好几条落不到本机的路由（根路径 + 若干静态资源规则），
  // 逐条列出来会把「1 个域名」说成「3 个域名」
  const external = new Map<string, ProxySummary['external'][number]>()
  for (const link of links) {
    for (const { route, service } of link.routes) {
      if (service) continue
      // 纯跳转不是「落不到本机」，它是设计如此，说了反而像故障
      if (route.redirectOnly) continue
      const entry = {
        host: link.vhost.primaryName,
        match: route.match,
        upstream: route.upstream
          ? `${route.upstream.scheme}://${route.upstream.host}${route.upstream.port === null ? '' : `:${route.upstream.port}`}`
          : '（无）',
        reason: unlinkedReason(route),
        routes: 1
      }
      const existing = external.get(entry.host)
      if (!existing) {
        external.set(entry.host, entry)
        continue
      }
      existing.routes += 1
      // 代表这条域名的那一条应当是根路径 —— 它才是「这个域名指向哪」
      if (entry.match === '/' && existing.match !== '/') {
        external.set(entry.host, { ...entry, routes: existing.routes })
      }
    }
  }

  return {
    files: parsed.files,
    domains: parsed.vhosts.length,
    linked: links.filter((l) => l.anchorPort !== null).length,
    external: [...external.values()],
    warnings: parsed.warnings
  }
}

export function buildOverview(counts: ServiceScanSnapshot['counts']): ScanOverview {
  const accessible = counts.services - counts.systemSockets
  // 域名只在有反代时出现。没有它时这句话必须一字不差地和以前一样 ——
  // 「域名」这一级不是每个机器都有，硬塞进去会让没有反代的机器读到一个 0
  const domainPart = counts.domains > 0 ? `（${counts.domains} 个域名）` : ''
  return {
    ...counts,
    accessible,
    chainText: `${counts.sockets} 监听记录 → ${counts.services} 服务 → ${accessible} 入口 → ${counts.applications} 应用${domainPart}`
  }
}

const KIND_LABEL: Record<Application['kind'], string> = {
  domain: '域名',
  container: '容器',
  process: '进程'
}

/**
 * 应用清单 + 每个应用的全部入口。
 * 应用顺序沿用归约层的排序（域名在前），不在这里重排 —— 换个排序就等于换个产品判断。
 */
export function buildApplicationViews(
  snapshot: ServiceScanSnapshot,
  endpoint: EntranceEndpoint
): ApplicationView[] {
  const conflicts = new Map<number, string[]>()
  for (const c of findTunnelPortCollisions(snapshot.services)) {
    conflicts.set(
      c.localPort,
      c.services.map((s) => `${s.port}/${s.protocol}`)
    )
  }
  const domains = entrancesByService(snapshot.entrances)

  return snapshot.applications.map((app) => {
    const entrances = app.services.map((s) =>
      // 取根路径那条当默认：`域名/stats/` 是子页面，不是这个服务本人的入口
      buildEntrance(s, endpoint, conflicts, domains.get(s.id)?.[0] ?? null)
    )
    const primary = entrances.find((e) => e.service.id === app.primaryId) ?? entrances[0]
    return {
      app,
      title: app.displayName,
      kindLabel: KIND_LABEL[app.kind],
      detail: app.detail,
      domain: app.domain,
      primary,
      chips: app.services.map((s) => ({
        port: s.port,
        protocol: s.protocol,
        label: `${s.port}/${s.protocol}`,
        isPrimary: s.id === primary.service.id,
        needsTunnel: needsTunnel(s),
        systemSocket: s.systemSocket,
        hasDomain: domains.has(s.id)
      })),
      entrances
    }
  })
}

/**
 * 系统后台套接字：不是入口，但也不能从界面上凭空消失。
 *
 * 这里按端口升序排，与归约层的排序不同 —— 归约层的顺序表达「哪个是合适的入口」，
 * 对一组「不是入口」的记录没有意义，人看这种列表预期是按端口走。
 */
export function buildSystemSocketViews(snapshot: ServiceScanSnapshot): PortChip[] {
  return snapshot.services
    .filter((s) => s.systemSocket)
    .sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol))
    .map((s) => ({
      port: s.port,
      protocol: s.protocol,
      label: `${s.port}/${s.protocol}`,
      isPrimary: false,
      needsTunnel: false,
      systemSocket: true,
      hasDomain: false
    }))
}

export function systemSocketReason(snapshot: ServiceScanSnapshot, port: number): string {
  return (
    snapshot.services.find((s) => s.port === port && s.systemSocket)?.systemSocketReason ??
    '系统自带的后台套接字'
  )
}

/** 面板底部的「本次扫描的边界」文案 —— 能力边界要写在界面上，不能只写在汇报里 */
export function scanBoundaries(snapshot: ServiceScanSnapshot): string[] {
  const lines = [
    '只做了只读内省（读取监听套接字、容器映射与 nginx 配置），没有连过这些端口，也没有改远端任何配置。',
    '协议未知的入口不猜协议：地址保持裸 host:port，由你选 http 还是 https。'
  ]
  if (snapshot.proxy.files === 0) {
    lines.push(
      '没读到 nginx 配置（未安装、当前用户不可读，或不是 Linux），所以入口只能是 IP:端口 —— 这表示「没查出来」，不表示「这台机器没配域名」。'
    )
  } else if (snapshot.counts.domains === 0) {
    lines.push(
      `读到了 ${snapshot.proxy.files} 个 nginx 配置文件，但里面没有能识别出 server_name 的站点，因此入口只能是 IP:端口。`
    )
  }
  if (snapshot.proxy.external.length > 0) {
    lines.push(
      `有 ${snapshot.proxy.external.length} 条域名路由的上游不指向本机监听（多数是集群里的地址），已单独列出而不是丢掉。`
    )
  }
  if (!snapshot.elevated) {
    lines.push('本次没有取得 root，部分端口的进程名来自端口表推断，可信度已相应标低。')
  }
  if (snapshot.warnings.length > 0) {
    lines.push(`有 ${snapshot.warnings.length} 条远端输出没能完整解析，可能是版本差异。`)
  }
  return lines
}

/** 扫描时间：一分钟内说「刚刚」，否则给相对分钟数，超过一小时给钟点 */
export function formatScannedAt(scannedAt: number, now: number): string {
  const diff = Math.max(0, now - scannedAt)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(scannedAt)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
