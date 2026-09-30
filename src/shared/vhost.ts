import type { ServiceRecord } from './netlist'

/**
 * 反向代理层的域名入口。
 *
 * 加这一层的理由是真机数据：一台机器上 6 个监听端口，其中 5 个背后各有一个域名
 * （`rancher.…top` → 8443、`oss.…top` → 30900、博客域名 → 30001 …）。
 * 人访问这些服务时用的是域名，不是 `127.0.0.1:8443`；
 * 而且域名比「谁 hold 了这个 socket」更接近**应用的边界** ——
 * 同一台机器上一个容器映射了 5 个宿主端口，按容器归组会得到「一个叫 Rancher 的东西有 5 个口」，
 * 按域名归组才得到 5 个各自有名字的服务。后者才是人能用的。
 *
 * 只解析 nginx（真机上在用的就是它：caddy / traefik / apache 都不存在）。
 * 解析器不追求覆盖 nginx 全部语法，只求**认得准**：
 * 认不出来的行宁可丢一条 warning，也不猜。
 */

export type LocationKind = 'prefix' | 'exact' | 'regex'

export interface VhostListen {
  port: number
  /** 该 listen 是否启用 TLS —— 决定这个域名对外是 http 还是 https */
  ssl: boolean
  /** IPv6-only 的 listen（同一端口的 v4 写法另有记录） */
  ipv6: boolean
}

export interface VhostUpstream {
  scheme: 'http' | 'https'
  host: string
  /** 没写端口时为 null（走 upstream 名或变量），无法与监听端口比对 */
  port: number | null
  /** proxy_pass 里带的 URI 部分（写了会改写路径） */
  path: string
  /** 带变量 / 只有 upstream 名：无法解析成本机端口 */
  unresolved: boolean
}

export interface VhostRoute {
  /** 原始匹配式，直接展示；`/` 为根路径 */
  match: string
  kind: LocationKind
  upstream: VhostUpstream | null
  /** location 里只有 return/rewrite，没有上游 */
  redirectOnly: boolean
}

export interface VhostListenBlock {
  file: string
  serverNames: string[]
  listens: VhostListen[]
  routes: VhostRoute[]
}

export interface Vhost {
  /** 主域名：第一个可用作站点名的 server_name */
  primaryName: string
  names: string[]
  listens: VhostListen[]
  routes: VhostRoute[]
  files: string[]
  /** 对外协议：任一 listen 带 ssl 就是 https */
  scheme: 'http' | 'https'
  /** 声明了这个域名的 listen 端口，降序后取第一个用作展示（443 优先于 80） */
  publicPort: number | null
}

export interface VhostParseResult {
  blocks: VhostListenBlock[]
  vhosts: Vhost[]
  /** 读到的配置文件数（0 表示这台机器没读到 nginx 配置） */
  files: number
  warnings: string[]
}

/** 上游指向本机（loopback / localhost）才允许和本机监听端口比对 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_RE.test(host)
}

/** 与某个域名关联的入口（挂在服务上） */
export interface DomainEntrance {
  vhost: Vhost
  /** 命中的 location 匹配式 */
  match: string
  kind: LocationKind
  /** 上游落到本机哪个端口 */
  upstreamPort: number
  /** 这条路由是不是根路径 —— 根路径意味着「这个域名就是这个服务」 */
  isRoot: boolean
}

export interface VhostLink {
  vhost: Vhost
  /** 每条路由的落点；null 表示上游不在本机的监听清单里 */
  routes: Array<{ route: VhostRoute; service: ServiceRecord | null }>
  /** 根路径上游命中本机服务时的那个端口 —— 归组时用它当锚点 */
  anchorPort: number | null
}

/** loopback 与 localhost：只有指向本机的上游才允许和本机监听端口比对 */
const LOOPBACK_RE = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/

/**
 * 解析采集回来的 `[nginx]` 段。
 *
 * 段落格式（由 NETLIST_COMMAND 产出）：
 *   @@FILE <绝对路径>
 *   <该文件的原文>
 *   @@END
 */
export function parseNginxSection(raw: string): VhostParseResult {
  const files = splitFiles(raw)
  const blocks: VhostListenBlock[] = []
  const warnings: string[] = []

  for (const file of files) {
    // sites-available 是「未启用」的池子，里面还有 .bak 备份。启用与否看 sites-enabled。
    if (file.path.includes('/sites-available/')) continue
    const parsed = parseConfigText(file.path, file.text)
    blocks.push(...parsed.blocks)
    warnings.push(...parsed.warnings)
  }

  return { blocks, vhosts: mergeVhosts(blocks), files: files.length, warnings }
}

export function splitFiles(raw: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  let path: string | null = null
  let buf: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@FILE ')) {
      if (path !== null) out.push({ path, text: buf.join('\n') })
      path = line.slice('@@FILE '.length).trim()
      buf = []
    } else if (line.trim() === '@@END') {
      if (path !== null) out.push({ path, text: buf.join('\n') })
      path = null
      buf = []
    } else if (path !== null) {
      buf.push(line)
    }
  }
  // 远端被截断时补上最后一段，避免整份配置凭空消失
  if (path !== null) out.push({ path, text: buf.join('\n') })
  return out
}

/** 告警里回显原文时的截断长度。与 `netlist.ts` 的同类告警保持一致 */
const WARNING_SNIPPET = 80

/**
 * 把配置原文截成一句能放心放进告警的话。
 *
 * 告警会经 IPC 进渲染进程，而配置原文是远端内容：不截断的话，一行超长的
 * `listen` / `location` 会被整段带过去。告警是给人看的，80 字符足够定位。
 */
function snippet(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > WARNING_SNIPPET ? `${one.slice(0, WARNING_SNIPPET)}…` : one
}

interface ServerDraft {
  file: string
  serverNames: string[]
  listens: VhostListen[]
  routes: VhostRoute[]
  sawReturn: boolean
}

/**
 * 逐行状态机。
 *
 * 为什么不用花括号计数：nginx 的 location 里常见正则，
 * `location ~* "^/static/….{8,}\.(js|css)$" {` 这种行带上量词花括号，计数必然错位。
 * 改成只看**行首关键字**与**整行只有右花括号**的关闭规则，正则里的花括号就不参与结构判断。
 */
export function parseConfigText(
  file: string,
  text: string
): { blocks: VhostListenBlock[]; warnings: string[] } {
  const blocks: VhostListenBlock[] = []
  const warnings: string[] = []
  let current: ServerDraft | null = null
  let route: VhostRoute | null = null
  /** location 内部的 if / map 等块的深度：它们不该被当成 location 的结束 */
  let innerDepth = 0

  const closeServer = (): void => {
    if (!current) return
    if (current.serverNames.length > 0 || current.listens.length > 0) {
      blocks.push({
        file: current.file,
        serverNames: current.serverNames,
        listens: current.listens,
        routes: current.routes
      })
    }
    current = null
    route = null
    innerDepth = 0
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim()
    if (line === '') continue

    if (/^server\b[^{]*\{$/.test(line) || /^server\s*\{/.test(line)) {
      closeServer()
      current = { file, serverNames: [], listens: [], routes: [], sawReturn: false }
      continue
    }
    if (!current) continue

    // 关闭：整行只有右花括号（`};` 是 map 的写法）
    if (/^\}\s*;?$/.test(line)) {
      if (innerDepth > 0) {
        innerDepth--
      } else if (route) {
        if (route.upstream === null) route.redirectOnly = true
        current.routes.push(route)
        route = null
      } else {
        closeServer()
      }
      continue
    }

    const location = /^location\s+((?:=|\^~|~\*|~)\s*)?(.*?)\s*\{$/.exec(line)
    if (location) {
      if (route) {
        // 前一个 location 没闭合就遇到下一个：结构不可信，丢掉不猜
        warnings.push(`${file}:${i + 1} location 嵌套异常，「${snippet(route.match)}」未闭合，已跳过`)
        route = null
      }
      const rawMatch = location[2]
      const mod = (location[1] ?? '').trim()
      route = {
        match: rawMatch === '' ? '/' : rawMatch,
        kind: mod === '=' ? 'exact' : mod === '' ? 'prefix' : 'regex',
        upstream: null,
        redirectOnly: false
      }
      innerDepth = 0
      continue
    }

    // location 内部的嵌套块（if / limit_except / 多行 set 等）
    if (route && /\{\s*$/.test(line) && !line.startsWith('}')) {
      innerDepth++
      continue
    }

    const proxy = /^proxy_pass\s+(\S+?)\s*;/.exec(line)
    if (proxy) {
      const target = parseUpstream(proxy[1])
      if (route) {
        route.upstream = target
      } else if (target) {
        // server 块里直接写 proxy_pass（少见）——记成根路径路由，而不是丢掉
        current.routes.push({ match: '/', kind: 'prefix', upstream: target, redirectOnly: false })
      }
      continue
    }

    if (route) continue

    const listen = /^listen\s+(.+?)\s*;/.exec(line)
    if (listen) {
      const parsed = parseListen(listen[1])
      if (parsed) current.listens.push(parsed)
      else warnings.push(`${file}:${i + 1} 无法解析的 listen：${snippet(line)}`)
      continue
    }

    const names = /^server_name\s+(.+?)\s*;/.exec(line)
    if (names) {
      for (const n of names[1].split(/\s+/)) {
        // `_` 与空 server_name 是「默认站点」，不是可访问的域名
        if (n !== '' && n !== '_' && !current.serverNames.includes(n)) current.serverNames.push(n)
      }
      continue
    }

    if (/^(return|rewrite)\s/.test(line)) {
      current.sawReturn = true
      continue
    }
  }

  closeServer()
  return { blocks, warnings }
}

/** 去掉行内注释。`#` 出现在引号内时不当作注释起始 */
export function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i)
  }
  return line
}

/**
 * 解析 `listen` 的第一个参数。
 *
 * 这里刻意不用一条正则搞定：真机上 `listen 443 ssl http2;` 曾被贪婪匹配读成端口 **3**
 * （`[^:\s]+` 先吃掉了 `44`，`\d{1,5}` 再抓最后一位）。
 * 按空白切成 token、只在第一个 token 里取端口，就不会有这种歧义。
 */
export function parseListen(text: string): VhostListen | null {
  const tokens = text.split(/\s+/).filter((t) => t !== '')
  const first = tokens[0]
  if (first === undefined) return null

  // `80` / `[::]:80` / `127.0.0.1:8080` / `443`
  const portText = first.includes(':') ? first.slice(first.lastIndexOf(':') + 1) : first
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number(portText)
  if (port < 1 || port > 65535) return null

  return {
    port,
    ssl: tokens.slice(1).includes('ssl'),
    ipv6: first.includes('[::]')
  }
}

export function parseUpstream(text: string): VhostUpstream | null {
  const schemeMatch = /^(https?):\/\//.exec(text)
  if (!schemeMatch) {
    // 只有 upstream 名（proxy_pass http://backend 已被上面接住；这里是裸写）
    return { scheme: 'http', host: text, port: null, path: '', unresolved: true }
  }
  const scheme = schemeMatch[1] as 'http' | 'https'
  const rest = text.slice(schemeMatch[0].length)

  // 带变量的上游（$host / $backend 之类）无法静态解析
  if (rest.includes('$')) {
    return { scheme, host: rest.split('/')[0], port: null, path: '', unresolved: true }
  }

  const slash = rest.indexOf('/')
  const authority = slash === -1 ? rest : rest.slice(0, slash)
  const path = slash === -1 ? '' : rest.slice(slash)

  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(authority)
  if (v6) {
    return { scheme, host: v6[1], port: Number(v6[2]), path, unresolved: false }
  }

  const hostPort = /^([^:]+):(\d+)$/.exec(authority)
  if (hostPort) {
    return { scheme, host: hostPort[1], port: Number(hostPort[2]), path, unresolved: false }
  }

  // 只有主机名（upstream 名），端口交给 upstream 块，这里解析不到
  return { scheme, host: authority, port: null, path, unresolved: true }
}

/**
 * 同一个域名的 80 跳转块与 443 业务块合并成一个 vhost。
 * 不合并的话每个域名会出现两条记录：一条只有跳转、一条才有上游，界面上会重复。
 */
export function mergeVhosts(blocks: VhostListenBlock[]): Vhost[] {
  const byKey = new Map<string, Vhost>()
  for (const block of blocks) {
    // 没有 server_name 的块（默认站点）不构成域名入口
    if (block.serverNames.length === 0) continue
    const key = [...block.serverNames].sort().join(' ')
    const existing = byKey.get(key)
    const listens = mergeListens(block.listens)
    if (!existing) {
      byKey.set(key, {
        primaryName: block.serverNames[0],
        names: [...block.serverNames],
        listens,
        routes: [...block.routes],
        files: [block.file],
        scheme: 'http',
        publicPort: null
      })
      continue
    }
    existing.listens = mergeListens([...existing.listens, ...listens])
    existing.routes.push(...block.routes)
    if (!existing.files.includes(block.file)) existing.files.push(block.file)
  }

  const vhosts = [...byKey.values()]
  for (const vhost of vhosts) {
    vhost.scheme = vhost.listens.some((l) => l.ssl) ? 'https' : 'http'
    const ports = [...new Set(vhost.listens.map((l) => l.port))].sort((a, b) => b - a)
    vhost.publicPort = ports[0] ?? null
  }
  // 按主域名稳定排序。刻意用码点比较而不是 localeCompare：
  // 后者跟随环境 locale，同一份配置在不同机器上可能排出不同顺序，
  // 界面上会表现为「域名顺序偶尔变」，测试也会跟着飘。
  return vhosts.sort((a, b) => (a.primaryName < b.primaryName ? -1 : a.primaryName > b.primaryName ? 1 : 0))
}

function mergeListens(listens: VhostListen[]): VhostListen[] {
  const seen = new Set<string>()
  const out: VhostListen[] = []
  for (const l of listens) {
    const key = `${l.port}/${l.ssl}/${l.ipv6}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out
}

/**
 * 把域名接到服务上。
 *
 * 只认指向本机的上游（127.x / ::1 / localhost）：
 * `proxy_pass http://10.99.0.2:30400` 那种指向集群 NodePort 的上游，
 * 端口号恰好和本机某个监听撞上时会张冠李戴，宁可判为「不落本机」。
 */
export function linkVhosts(services: ServiceRecord[], vhosts: Vhost[]): VhostLink[] {
  const byPort = new Map<number, ServiceRecord[]>()
  for (const s of services) {
    if (s.systemSocket) continue
    const list = byPort.get(s.port)
    if (list) list.push(s)
    else byPort.set(s.port, [s])
  }
  const pick = (port: number): ServiceRecord | null => {
    const list = byPort.get(port)
    if (!list || list.length === 0) return null
    // 同端口出现在两种协议上时优先 tcp —— 网页入口不会是 udp
    return list.find((s) => s.protocol === 'tcp') ?? list[0]
  }

  return vhosts.map((vhost) => {
    const routes = vhost.routes.map((route) => {
      const up = route.upstream
      if (!up || up.unresolved || up.port === null) return { route, service: null }
      if (!LOOPBACK_RE.test(up.host)) return { route, service: null }
      return { route, service: pick(up.port) }
    })

    // 锚点：根路径命中的那个服务。没有根路径时退回第一条命中的路由 ——
    // 但绝不把「子路径引用」的服务当成这个域名的本体（博客域名的 /stats/ 不该抢走统计服务）
    const rootRoute = routes.find((r) => r.route.match === '/' && r.service !== null)
    const anchorPort = rootRoute?.service?.port ?? null

    return { vhost, routes, anchorPort }
  })
}

/**
 * 某个服务的全部域名入口（可能被多个域名引用）。
 *
 * 正则 location 不产出入口：`~* "^/static/….{8,}\.(js|css)$"` 是**路由规则**，
 * 那串东西不是能打开的地址。它指向的服务通常已经在根路径上有入口，
 * 硬留一条只会得到一个重复的域名，界面上变成同一个域名出现两次。
 * （这条规则由 `vhost.test.ts` 的「正则 location 既是路由也不冒充入口」锁住。）
 */
export function domainEntrancesFor(link: VhostLink[]): Map<string, DomainEntrance[]> {
  const out = new Map<string, DomainEntrance[]>()
  for (const item of link) {
    for (const { route, service } of item.routes) {
      if (!service) continue
      if (route.kind === 'regex') continue
      const entrance: DomainEntrance = {
        vhost: item.vhost,
        match: route.match,
        kind: route.kind,
        upstreamPort: service.port,
        isRoot: route.match === '/'
      }
      const list = out.get(service.id)
      if (list) list.push(entrance)
      else out.set(service.id, [entrance])
    }
  }
  return out
}

/**
 * 域名入口的展示地址。
 * 根路径就是域名本身；普通前缀/精确路径要带上路径 —— 少了 `/stats/` 会把人送到站点首页。
 *
 * 正则 location（`~` / `~*`）不拼路径：那串东西是匹配式不是 URL，
 * 拼进去会得到一个打不开的地址。
 */
export function domainUrl(entrance: DomainEntrance): string {
  const base = `${entrance.vhost.scheme}://${entrance.vhost.primaryName}`
  if (entrance.isRoot || entrance.kind === 'regex') return base
  return base + (entrance.match.startsWith('/') ? entrance.match : `/${entrance.match}`)
}
