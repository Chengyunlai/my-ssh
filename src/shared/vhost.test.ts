import { describe, expect, it } from 'vitest'
import { VHOST_EXPECTED, NGINX_SECTION } from '../../tests/fixtures/vhost-sample'
import { buildProxySummary, buildServiceEntrances } from './entrance'
import { buildServices, groupApplications, mergeByPort, parseNetlist } from './netlist'
import {
  domainEntrancesFor,
  domainUrl,
  linkVhosts,
  parseConfigText,
  parseListen,
  parseNginxSection,
  parseUpstream,
  splitFiles,
  stripComment,
  type Vhost
} from './vhost'

const parsed = parseNginxSection(NGINX_SECTION)

function vhost(name: string): Vhost {
  const found = parsed.vhosts.find((v) => v.primaryName === name)
  expect(found, `没有解析出域名 ${name}`).toBeDefined()
  return found!
}

describe('段落切分', () => {
  it('按 @@FILE / @@END 切出每个配置文件', () => {
    const files = splitFiles(NGINX_SECTION)
    expect(files.map((f) => f.path)).toEqual([
      '/etc/nginx/nginx.conf',
      '/etc/nginx/conf.d/connection-upgrade.conf',
      '/etc/nginx/conf.d/performance.conf',
      '/etc/nginx/sites-enabled/site-default',
      '/etc/nginx/sites-enabled/site-blog',
      '/etc/nginx/sites-enabled/site-rancher',
      '/etc/nginx/sites-enabled/site-oss-api',
      '/etc/nginx/sites-enabled/site-oss-console',
      '/etc/nginx/sites-enabled/site-gateway',
      '/etc/nginx/sites-enabled/site-internal',
      '/etc/nginx/sites-available/site-blog.bak-20260101'
    ])
  })

  it('远端被截断（缺 @@END）时最后一段也要留下，不能整份配置凭空消失', () => {
    const cut = ['@@FILE /a.conf', 'server {', '  listen 80;'].join('\n')
    expect(splitFiles(cut)).toEqual([{ path: '/a.conf', text: 'server {\n  listen 80;' }])
  })
})

describe('注释剥离', () => {
  it('行尾注释被去掉，指令本体保留', () => {
    expect(stripComment('gzip on;   # 行尾注释').trim()).toBe('gzip on;')
  })

  it('引号里的 # 不是注释起始', () => {
    expect(stripComment('add_header X "a#b" always;').trim()).toBe('add_header X "a#b" always;')
  })

  it('单引号里的 # 同理', () => {
    expect(stripComment("map $x 'a#b';").trim()).toBe("map $x 'a#b';")
  })
})

describe('listen 解析', () => {
  it('裸端口、IPv6、带地址的写法都取第一个 token 的端口', () => {
    expect(parseListen('80')).toMatchObject({ port: 80, ssl: false, ipv6: false })
    expect(parseListen('[::]:80')).toMatchObject({ port: 80, ssl: false, ipv6: true })
    expect(parseListen('127.0.0.1:8080')).toMatchObject({ port: 8080, ssl: false })
    expect(parseListen('8443 ssl')).toMatchObject({ port: 8443, ssl: true })
  })

  it('`443 ssl http2` 的端口是 443 —— 贪婪匹配曾把它读成 3', () => {
    // 真机上踩到的：`[^:\s]+` 先吃掉 44，`\d{1,5}` 再抓最后一位
    expect(parseListen('443 ssl http2')).toMatchObject({ port: 443, ssl: true })
    expect(parseListen('443 ssl http2 default_server')?.port).toBe(443)
  })

  it('ssl 只认独立的 token，不被单词里的字母骗到', () => {
    expect(parseListen('443 http2')?.ssl).toBe(false)
    expect(parseListen('8443 ssl')?.ssl).toBe(true)
  })

  it('socket 之类不是端口，返回 null 而不是猜一个数字', () => {
    expect(parseListen('unix:/var/run/nginx.sock')).toBeNull()
    expect(parseListen('')).toBeNull()
    expect(parseListen('70000')).toBeNull()
  })
})

describe('上游解析', () => {
  it('带端口与协议的常见写法', () => {
    expect(parseUpstream('http://127.0.0.1:30001')).toEqual({
      scheme: 'http',
      host: '127.0.0.1',
      port: 30001,
      path: '',
      unresolved: false
    })
    expect(parseUpstream('https://127.0.0.1:8443')).toMatchObject({ scheme: 'https', port: 8443 })
  })

  it('IPv6 上游按方括号取端口', () => {
    expect(parseUpstream('http://[::1]:8080')).toMatchObject({ host: '::1', port: 8080 })
  })

  it('带 URI 部分时端口照样取得出来，路径单独记下', () => {
    expect(parseUpstream('http://127.0.0.1:9000/api/')).toMatchObject({ port: 9000, path: '/api/' })
  })

  it('只有 upstream 名时端口为 null 且标为未解析 —— 不编一个默认端口', () => {
    expect(parseUpstream('http://internal_api')).toMatchObject({
      host: 'internal_api',
      port: null,
      unresolved: true
    })
  })

  it('带变量的上游标为未解析', () => {
    expect(parseUpstream('http://$backend:8080')).toMatchObject({ port: null, unresolved: true })
  })
})

describe('整体解析', () => {
  it('一台机器上的域名清单认得齐', () => {
    expect(parsed.vhosts.map((v) => v.primaryName)).toEqual([...VHOST_EXPECTED.primaryNames])
  })

  it('未启用的 sites-available（含 .bak 备份）不参与 —— 那里是池子不是生效配置', () => {
    expect(parsed.vhosts.some((v) => v.names.includes('old.example.com'))).toBe(false)
  })

  it('server_name _ 是默认站点，不是可访问域名', () => {
    expect(parsed.vhosts.some((v) => v.names.includes('_'))).toBe(false)
    expect(parsed.blocks.length).toBeGreaterThan(parsed.vhosts.length)
  })

  it('同一域名的 80 跳转块与 443 业务块合并成一条', () => {
    const blog = vhost('blog.example.com')
    expect(blog.names).toEqual(['blog.example.com', 'www.blog.example.com'])
    // 注意 `.sort()` 不带比较器是按字符串排的（443 会排到 80 前面），这里必须给数值比较器
    expect(blog.listens.map((l) => l.port).sort((a, b) => a - b)).toEqual([80, 80, 443, 443])
    expect(blog.files).toEqual(['/etc/nginx/sites-enabled/site-blog'])
  })

  it('对外协议由 listen 上的 ssl 决定，公网端口取最大的那个', () => {
    expect(vhost('blog.example.com').scheme).toBe('https')
    expect(vhost('blog.example.com').publicPort).toBe(443)
  })

  it('解析没有 warning —— 夹具里每一条都该认得出来', () => {
    expect(parsed.warnings).toEqual([])
  })

  it('conf.d 里只有 map、没有 server 块时不产出域名', () => {
    expect(parsed.blocks.every((b) => !b.file.startsWith('/etc/nginx/conf.d/'))).toBe(true)
  })
})

describe('location 与上游', () => {
  it('根路径与子路径都认得出来，并区分前缀 / 精确 / 正则', () => {
    const routes = vhost('blog.example.com').routes
    expect(routes.map((r) => [r.match, r.kind])).toEqual([
      ['/stats', 'exact'],
      ['/stats/', 'prefix'],
      ['/', 'prefix'],
      ['"^/static/[^?]+\\.[0-9a-f]{8,}\\.(js|css|svg|png|woff2?)$"', 'regex']
    ])
  })

  it('只有 return 的 location 标为纯跳转，不会伪造上游', () => {
    const redirect = vhost('blog.example.com').routes.find((r) => r.kind === 'exact')!
    expect(redirect.upstream).toBeNull()
    expect(redirect.redirectOnly).toBe(true)
  })

  it('location 里的 if 块不让 location 提前结束，后续指令仍归它', () => {
    const root = vhost('blog.example.com').routes.find((r) => r.match === '/')!
    expect(root.upstream?.port).toBe(30001)
    expect(root.kind).toBe('prefix')
  })

  it('正则 location 里带量词的花括号不会被当成块结构', () => {
    // 花括号计数法在这种行上必错；这里能解析出来就说明走的是行首关键字
    const ossConsole = vhost('oss-console.example.com')
    expect(ossConsole.routes.some((r) => r.kind === 'regex')).toBe(true)
    expect(ossConsole.routes.length).toBe(2)
  })
})

describe('上游接到本机服务', () => {
  /** 服务清单复用端口发现夹具，只取 ports 关心的那些 */
  const services = mergeByPort(
    buildServices(parseNetlist(['MYSSH_NETLIST_V1', '[tcplisten]', 'END'].join('\n')), {
      nodeId: 'n',
      now: 0
    })
  )
  const links = linkVhosts(services, parsed.vhosts)

  it('上游不在本机监听清单里时如实报「落不到」，不张冠李戴', () => {
    const gateway = links.find((l) => l.vhost.primaryName === 'llm.example.com')!
    expect(gateway.routes.every((r) => r.service === null)).toBe(true)
    expect(gateway.anchorPort).toBeNull()
  })

  it('只解析出 upstream 名的域名同样落不到本机', () => {
    const internal = links.find((l) => l.vhost.primaryName === 'internal.example.com')!
    expect(internal.routes[0].service).toBeNull()
  })

  it('指向本机之外的内网地址不会和本机同号端口误配', () => {
    // llm 的上游是 10.99.0.2:30400；就算本机既有 30400 也不该认领
    const withLocal30400 = mergeByPort(
      buildServices(
        parseNetlist(
          [
            'MYSSH_NETLIST_V1',
            '[tcplisten]',
            'LISTEN 0 128 127.0.0.1:30400 0.0.0.0:* users:(("node",pid=1,fd=3))',
            'END'
          ].join('\n')
        ),
        { nodeId: 'n', now: 0 }
      )
    )
    const links = linkVhosts(withLocal30400, parsed.vhosts)
    const gateway = links.find((l) => l.vhost.primaryName === 'llm.example.com')!
    expect(gateway.routes.every((r) => r.service === null)).toBe(true)
  })

  it('根路径命中的服务才是这个域名的锚点，子路径不抢归属', () => {
    const services = mergeByPort(
      buildServices(
        parseNetlist(
          [
            'MYSSH_NETLIST_V1',
            '[tcplisten]',
            'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=1,fd=3))',
            'LISTEN 0 128 127.0.0.1:8099 0.0.0.0:* users:(("python3",pid=2,fd=3))',
            'END'
          ].join('\n')
        ),
        { nodeId: 'n', now: 0 }
      )
    )
    const links = linkVhosts(services, parsed.vhosts)
    const blog = links.find((l) => l.vhost.primaryName === 'blog.example.com')!
    expect(blog.anchorPort).toBe(30001)

    // 前置事实：本站点确实有一条正则 location 也指向 30001（静态资源缓存规则）。
    // 它必须仍然作为**路由**存在，但不允许变成第二条入口。
    expect(blog.vhost.routes.filter((r) => r.kind === 'regex' && r.upstream?.port === 30001)).toHaveLength(1)

    const entrances = domainEntrancesFor(links)
    const blogEntrances = entrances.get('n:tcp:30001')!
    expect(blogEntrances.map((e) => e.match)).toEqual(['/'])
    // 8099 被 /stats/ 引用，但那是子路径 —— 它自己的身份不该被博客域名吞掉
    expect(entrances.get('n:tcp:8099')!.map((e) => e.match)).toEqual(['/stats/'])
    expect(blog.anchorPort).not.toBe(8099)
  })
})

describe('域名就是应用边界', () => {
  /**
   * 真机上的错配：一个容器映射了 5 个宿主端口，按容器归组会得到
   * 「一个应用有 5 个口」，可那 5 个口背后是 5 个各自有域名的独立服务。
   */
  const services = mergeByPort(
    buildServices(
      parseNetlist(
        [
          'MYSSH_NETLIST_V1',
          '[tcplisten]',
          'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=1,fd=3))',
          'LISTEN 0 128 127.0.0.1:8099 0.0.0.0:* users:(("python3",pid=2,fd=3))',
          'LISTEN 0 128 127.0.0.1:30900 0.0.0.0:* users:(("minio",pid=3,fd=3))',
          'LISTEN 0 128 127.0.0.1:30901 0.0.0.0:* users:(("minio",pid=4,fd=3))',
          'LISTEN 0 128 127.0.0.1:8443 0.0.0.0:* users:(("rancher",pid=5,fd=3))',
          'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=6,fd=3))',
          'END'
        ].join('\n')
      ),
      { nodeId: 'n', now: 0 }
    )
  )
  const links = linkVhosts(services, parsed.vhosts)
  const apps = groupApplications(services, { links })

  it('有域名的服务各自成一个应用，名字就是域名', () => {
    expect(apps.filter((a) => a.kind === 'domain').map((a) => a.displayName)).toEqual([
      'blog.example.com',
      'oss-console.example.com',
      'oss.example.com',
      'rancher.example.com'
    ])
    expect(apps.every((a) => a.kind === 'domain' || a.domain === null)).toBe(true)
  })

  it('被域名子路径引用的服务并进同一个应用，而不是另开一张卡', () => {
    // /stats/ 是博客域名的一个页面，人眼里它就是同一个站
    const blog = apps.find((a) => a.displayName === 'blog.example.com')!
    expect(blog.ports).toEqual([30001, 8099])
    expect(blog.primaryId).toBe('n:tcp:30001')
  })

  it('域名应用排在进程应用前面，因为那才是人真正会用的入口', () => {
    expect(apps.map((a) => a.kind)).toEqual(['domain', 'domain', 'domain', 'domain', 'process'])
    expect(apps[apps.length - 1].displayName).toBe('OpenSSH')
  })

  it('落不到本机的域名不产生应用，但也没被悄悄吃掉', () => {
    // llm 的上游是集群 NodePort、internal 的上游是 upstream 名
    expect(apps.some((a) => a.displayName === 'llm.example.com')).toBe(false)
    const summary = buildProxySummary(parsed, links)
    expect(summary.domains).toBe(6)
    expect(summary.linked).toBe(4)
    expect(summary.external.map((e) => e.host).sort()).toEqual(['internal.example.com', 'llm.example.com'])
  })

  it('同一个服务被两个域名指向时只成一个应用，别名不会重复出现', () => {
    // 给 blog 加一个别名域名，两个域名的根路径都打到 30001
    const alias = parseNginxSection(
      [
        '@@FILE /etc/nginx/sites-enabled/site-alias',
        'server {',
        '    listen 443 ssl;',
        '    server_name alias.example.com;',
        '    location / {',
        '        proxy_pass http://127.0.0.1:30001;',
        '    }',
        '}',
        '@@END'
      ].join('\n')
    )
    const both = groupApplications(services, { links: linkVhosts(services, [...parsed.vhosts, ...alias.vhosts]) })
    expect(both.filter((a) => a.ports.includes(30001))).toHaveLength(1)
    // 别名没被丢掉：它仍然在这个服务的域名入口清单里
    const entrances = buildServiceEntrances(linkVhosts(services, [...parsed.vhosts, ...alias.vhosts]))
    expect(entrances.filter((e) => e.serviceId === 'n:tcp:30001').map((e) => e.host)).toEqual([
      'alias.example.com',
      'blog.example.com'
    ])
  })

  it('没有反向代理时退回容器/进程轴，结果与以前一致', () => {
    const withoutLinks = groupApplications(services)
    expect(withoutLinks.every((a) => a.kind !== 'domain' && a.domain === null)).toBe(true)
    expect(withoutLinks.map((a) => a.displayName).sort()).toEqual([
      'HTTPS 备用端口',
      'Node 服务',
      'OpenSSH',
      'Python 服务',
      'minio · 端口 30900'
    ])
    // 退回旧轴就退回旧缺陷：30900 与 30901 同名进程被并成一个应用。
    // 这不是新引入的问题，是因为这两把尺子本来就不够用 —— 域名够用的时候就不走这条路
    const minio = withoutLinks.find((a) => a.displayName.startsWith('minio'))!
    expect(minio.ports).toEqual([30900, 30901])
  })
})

describe('已知的通用性边界（写成断言，改的时候必须是有意的）', () => {
  /**
   * 上游是 upstream 名时，名字指向哪台机器写在同一份配置的 `upstream` 块里，
   * 但解析器目前不读那些块 —— 所以这类域名会落到 `proxy.external`。
   * 现状：**如实报「落不到本机」，不硬凑**。补齐要判上游块语义（负载均衡、多 server、权重），
   * 属于独立一块工作，没做。
   */
  it('上游是 upstream 名时不认领，即使 upstream 块就在同一份配置里', () => {
    const services = mergeByPort(
      buildServices(
        parseNetlist(
          [
            'MYSSH_NETLIST_V1',
            '[tcplisten]',
            'LISTEN 0 128 127.0.0.1:9000 0.0.0.0:* users:(("app",pid=1,fd=3))',
            'END'
          ].join('\n')
        ),
        { nodeId: 'n', now: 0 }
      )
    )
    const links = linkVhosts(services, parsed.vhosts)
    const internal = links.find((l) => l.vhost.primaryName === 'internal.example.com')!
    // 夹具里 `upstream internal_api { server 127.0.0.1:9000; }` 是真的，本机也真的在听 9000
    expect(internal.anchorPort).toBeNull()
    expect(buildProxySummary(parsed, links).external.some((e) => e.host === 'internal.example.com')).toBe(true)
  })

  /**
   * 上游写这台机器自己的 LAN 地址 / docker 网桥地址（`172.17.0.1:30001`）时同样不认领。
   * 判据是「上游主机必须是回环」；放宽到「任意私网地址」会引入误配 ——
   * 集群里另一台机器的同号端口会被算成这台机器的服务。
   * 要正确支持得先采集本机地址清单，属于独立一块工作。
   */
  it('上游是内网地址时不认领，即便本机同号端口绑在 0.0.0.0 上', () => {
    const raw = [
      '@@FILE /etc/nginx/sites-enabled/lan',
      'server {',
      '    listen 443 ssl;',
      '    server_name lan.example.com;',
      '    location / {',
      '        proxy_pass http://10.0.0.12:8080;',
      '    }',
      '}',
      '@@END'
    ].join('\n')
    const vhosts = parseNginxSection(raw).vhosts
    const services = mergeByPort(
      buildServices(
        parseNetlist(
          [
            'MYSSH_NETLIST_V1',
            '[tcplisten]',
            'LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("app",pid=1,fd=3))',
            'END'
          ].join('\n')
        ),
        { nodeId: 'n', now: 0 }
      )
    )
    const links = linkVhosts(services, vhosts)
    expect(links[0].anchorPort).toBeNull()
    expect(links[0].routes[0].service).toBeNull()
  })
})

describe('域名入口地址', () => {
  const services = mergeByPort(
    buildServices(
      parseNetlist(
        [
          'MYSSH_NETLIST_V1',
          '[tcplisten]',
          'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=1,fd=3))',
          'LISTEN 0 128 127.0.0.1:8099 0.0.0.0:* users:(("python3",pid=2,fd=3))',
          'END'
        ].join('\n')
      ),
      { nodeId: 'n', now: 0 }
    )
  )
  const entrances = domainEntrancesFor(linkVhosts(services, parsed.vhosts))

  it('根路径就是域名本身，不带端口', () => {
    expect(domainUrl(entrances.get('n:tcp:30001')![0])).toBe('https://blog.example.com')
  })

  it('子路径要带上路径，否则会把人送到站点首页', () => {
    expect(domainUrl(entrances.get('n:tcp:8099')![0])).toBe('https://blog.example.com/stats/')
  })

  it('精确匹配的路径也带上', () => {
    const blog = parsed.vhosts.find((v) => v.primaryName === 'blog.example.com')!
    expect(
      domainUrl({
        vhost: blog,
        match: '/stats/login',
        kind: 'exact',
        upstreamPort: 8099,
        isRoot: false
      })
    ).toBe('https://blog.example.com/stats/login')
  })

  it('正则 location 不拼路径 —— 那串是匹配式不是 URL', () => {
    const ossConsole = parsed.vhosts.find((v) => v.primaryName === 'oss-console.example.com')!
    const regexRoute = ossConsole.routes.find((r) => r.kind === 'regex')!
    expect(
      domainUrl({
        vhost: ossConsole,
        match: regexRoute.match,
        kind: 'regex',
        upstreamPort: 30901,
        isRoot: false
      })
    ).toBe('https://oss-console.example.com')
  })
})

describe('没有 nginx 的机器', () => {
  it('解析空段得到空清单，不抛异常', () => {
    const empty = parseNginxSection('')
    expect(empty.vhosts).toEqual([])
    expect(empty.blocks).toEqual([])
    expect(empty.warnings).toEqual([])
  })

  it('nginx 没装时采集段是空的，链接结果是空 —— 调用方据此退回容器/进程归组', () => {
    const services = mergeByPort(
      buildServices(
        parseNetlist(
          [
            'MYSSH_NETLIST_V1',
            '[tcplisten]',
            'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))',
            'END'
          ].join('\n')
        ),
        { nodeId: 'n', now: 0 }
      )
    )
    expect(linkVhosts(services, parseNginxSection('').vhosts)).toEqual([])
  })
})

describe('结构异常时不猜', () => {
  it('location 未闭合就遇到下一个时记 warning 并跳过，而不是把上游接到错的块上', () => {
    const bad = [
      '@@FILE /etc/nginx/sites-enabled/bad',
      'server {',
      '    listen 443 ssl;',
      '    server_name bad.example.com;',
      '    location /a {',
      '        proxy_pass http://127.0.0.1:1111;',
      '    location /b {',
      '        proxy_pass http://127.0.0.1:2222;',
      '    }',
      '}',
      '@@END'
    ].join('\n')
    const result = parseConfigText('/etc/nginx/sites-enabled/bad', splitFiles(bad)[0].text)
    expect(result.warnings.some((w) => w.includes('未闭合'))).toBe(true)
  })

  it('认不出的 listen 记 warning 并跳过该条，不影响同一个 server 的其他指令', () => {
    const text = [
      'server {',
      '    listen unix:/run/nginx.sock;',
      '    listen 443 ssl;',
      '    server_name odd.example.com;',
      '}'
    ].join('\n')
    const result = parseConfigText('/x', text)
    expect(result.warnings).toHaveLength(1)
    expect(result.blocks[0].listens.map((l) => l.port)).toEqual([443])
  })

  it('告警里回显的原文会被截断 —— 它会经 IPC 进渲染进程，不该整行带过去', () => {
    const long = `/very/long/path/${'x'.repeat(400)}.sock`
    const result = parseConfigText('/x', `server {\n    listen unix:${long};\n    server_name odd.example.com;\n}`)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('…')
    expect(result.warnings[0].length).toBeLessThan(140)
  })
})
