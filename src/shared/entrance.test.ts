import { describe, expect, it } from 'vitest'
import { SS_EXPECTED, SS_OUTPUT } from '../../tests/fixtures/netlist-sample'
import {
  buildApplicationViews,
  buildEntrance,
  buildOverview,
  buildScanSnapshot,
  buildSystemSocketViews,
  buildTunnelCommand,
  formatScannedAt,
  needsTunnel,
  scanBoundaries,
  systemSocketReason,
  type EntranceEndpoint
} from './entrance'
import type { ServiceScanSnapshot } from './types'

const NOW = 1_700_000_000_000

const ENDPOINT: EntranceEndpoint = {
  host: '10.0.0.12',
  sshPort: 22,
  username: 'deploy',
  keyPath: '/home/deploy/.ssh/id_ed25519'
}

function snapshotFrom(raw: string, nodeId = 'session-1'): ServiceScanSnapshot {
  // 走产品里同一条装配链，而不是在测试里手搭一个中间态
  return buildScanSnapshot(raw, { nodeId, now: NOW })!
}

const SNAPSHOT = snapshotFrom(SS_OUTPUT)

/** 同一个端口号出现在 tcp + udp 上，且两侧都不是系统套接字（自建 DNS 的典型形态） */
const DNS_BOTH_PROTOCOLS = [
  'MYSSH_NETLIST_V1',
  '[meta]',
  'uid=0',
  'sudo=1',
  '[tcplisten]',
  'LISTEN 0 128 127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=100,fd=3))',
  '[udplisten]',
  'UNCONN 0 0 127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=100,fd=4))',
  '[osrelease]',
  'ID=ubuntu',
  '[identity]',
  '0',
  'END'
].join('\n')

function entranceOf(snapshot: ServiceScanSnapshot, port: number, protocol: 'tcp' | 'udp' = 'tcp') {
  const service = snapshot.services.find((s) => s.port === port && s.protocol === protocol)!
  return buildEntrance(service, ENDPOINT)
}

describe('收敛概览', () => {
  const overview = buildOverview(SNAPSHOT.counts)

  it('把四级数字连成一句可核对的链', () => {
    // 四级收敛是这个面板的整个卖点，少一级就退化成一张平铺的端口表
    expect(overview.chainText).toBe('16 监听记录 → 12 服务 → 8 入口 → 4 应用')
    expect(overview.sockets).toBe(SS_EXPECTED.sockets)
    expect(overview.applications).toBe(SS_EXPECTED.applications)
  })

  it('给出「需要进入的」那个数字：服务减去系统后台套接字', () => {
    expect(overview.accessible).toBe(SS_EXPECTED.accessibleServices)
    expect(overview.systemSockets).toBe(SS_EXPECTED.systemSockets)
  })
})

describe('应用卡片', () => {
  const views = buildApplicationViews(SNAPSHOT, ENDPOINT)

  it('第一屏是 4 个应用，不是 12 条端口记录', () => {
    expect(views.map((v) => v.title)).toEqual([...SS_EXPECTED.apps])
  })

  it('一个容器的 4 个宿主端口收在同一张卡上', () => {
    const panel = views[0]
    expect(panel.kindLabel).toBe('容器')
    expect(panel.chips.map((c) => c.port)).toEqual([8443, 8080, 30001, 30002])
    expect(panel.detail).toContain('portainer/portainer-ce:2.19.4')
  })

  it('卡上的默认入口是协议最确定的那个（8443 而不是端口最小的 8080）', () => {
    expect(views[0].primary.service.port).toBe(8443)
    expect(views[0].chips.filter((c) => c.isPrimary).map((c) => c.port)).toEqual([8443])
  })

  it('每张卡的入口数与端口数一致，不存在「有端口但进不去」', () => {
    for (const v of views) {
      expect(v.entrances).toHaveLength(v.chips.length)
    }
  })
})

describe('入口地址', () => {
  it('只绑本机的服务走隧道，地址落在回环上', () => {
    const entrance = entranceOf(SNAPSHOT, 8443)
    expect(entrance.needsTunnel).toBe(true)
    expect(entrance.localAddress).toBe('127.0.0.1:28443')
    expect(entrance.address).toBe('https://127.0.0.1:28443')
  })

  it('隧道命令把本地端口、远端地址、ssh 端口、私钥都写对', () => {
    const entrance = entranceOf(SNAPSHOT, 8443)
    expect(entrance.tunnelCommand).toBe(
      'ssh -N -L 127.0.0.1:28443:127.0.0.1:8443 -p 22 -i /home/deploy/.ssh/id_ed25519 deploy@10.0.0.12'
    )
  })

  it('绑全网卡的服务直连，不给隧道命令', () => {
    const entrance = entranceOf(SNAPSHOT, 443)
    expect(entrance.needsTunnel).toBe(false)
    expect(entrance.tunnelCommand).toBeNull()
    expect(entrance.address).toBe('https://10.0.0.12:443')
    expect(entrance.openUrl).toBe('https://10.0.0.12:443')
  })

  it('协议看不出来时不补 http://，而是把两个候选摆出来让人自己选', () => {
    const entrance = entranceOf(SNAPSHOT, 30001)
    expect(entrance.protocol).toBe('unknown')
    expect(entrance.action).toBe('choose')
    expect(entrance.openUrl).toBeNull()
    expect(entrance.address).toBe('127.0.0.1:23001')
    expect(entrance.schemeChoices).toEqual(['http://127.0.0.1:23001', 'https://127.0.0.1:23001'])
  })

  it('SSH 端口给的是终端命令，不是网页候选', () => {
    const entrance = entranceOf(SNAPSHOT, 22)
    expect(entrance.action).toBe('ssh')
    expect(entrance.schemeChoices).toEqual([])
    expect(entrance.sshCommand).toBe('ssh -i /home/deploy/.ssh/id_ed25519 deploy@10.0.0.12')
  })

  it('非 22 的 SSH 端口会把 -p 带上', () => {
    const service = { ...SNAPSHOT.services.find((s) => s.port === 22)!, port: 2222, bindScope: 'all' as const }
    expect(buildEntrance(service, ENDPOINT).sshCommand).toBe(
      'ssh -p 2222 -i /home/deploy/.ssh/id_ed25519 deploy@10.0.0.12'
    )
  })

  it('密码认证时不出现 -i', () => {
    const entrance = entranceOf(SNAPSHOT, 8443)
    const withPassword = buildEntrance(entrance.service, { ...ENDPOINT, keyPath: undefined })
    expect(withPassword.tunnelCommand).not.toContain('-i')
  })

  it('主机名是 IPv6 时地址带方括号', () => {
    const entrance = buildEntrance(SNAPSHOT.services.find((s) => s.port === 8443)!, {
      ...ENDPOINT,
      host: 'fe80::1'
    })
    expect(entrance.address).toBe('https://127.0.0.1:28443')
    expect(buildEntrance(SNAPSHOT.services.find((s) => s.port === 443)!, { ...ENDPOINT, host: 'fe80::1' }).address).toBe(
      'https://[fe80::1]:443'
    )
  })

  it('绑到具体网卡时隧道目标是那个网卡，不是回环', () => {
    const service = { ...SNAPSHOT.services.find((s) => s.port === 8443)!, bindAddr: '10.0.0.12', bindScope: 'specific' as const }
    expect(buildTunnelCommand(service, ENDPOINT, 28443)).toContain('-L 127.0.0.1:28443:10.0.0.12:8443')
  })
})

describe('隧道端口撞车', () => {
  it('同端口跨协议时，撞车信息挂在两个入口上', () => {
    const snapshot = snapshotFrom(DNS_BOTH_PROTOCOLS)
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.applications).toHaveLength(1)

    const views = buildApplicationViews(snapshot, ENDPOINT)
    const [tcp, udp] = views[0].entrances
    expect(tcp.localAddress).toBe('127.0.0.1:20053')
    expect(udp.localAddress).toBe('127.0.0.1:20053')
    // 撞车不能悄悄改端口，只能标出来 —— 改了就等于把「稳定」作废
    expect(tcp.localPortConflicts.sort()).toEqual(['53/tcp', '53/udp'])
    expect(udp.localPortConflicts).toEqual(tcp.localPortConflicts)
  })

  it('夹具里没有撞车，入口不该平白多出警告', () => {
    for (const v of buildApplicationViews(SNAPSHOT, ENDPOINT)) {
      for (const e of v.entrances) {
        expect(e.localPortConflicts).toEqual([])
      }
    }
  })
})

describe('系统后台套接字不消失', () => {
  it('从应用清单里排除，但在单独一区里列出来', () => {
    const system = buildSystemSocketViews(SNAPSHOT)
    expect(system).toHaveLength(SS_EXPECTED.systemSockets)
    expect(system.map((s) => s.label)).toEqual(['53/tcp', '53/udp', '68/udp', '323/udp'])
    expect(system.every((s) => s.systemSocket)).toBe(true)
  })

  it('每条都带隔离理由，人能看到为什么被折叠', () => {
    expect(systemSocketReason(SNAPSHOT, 68)).toContain('DHCP')
    expect(systemSocketReason(SNAPSHOT, 53)).toContain('DNS')
  })

  it('系统套接字永远不需要隧道', () => {
    for (const s of SNAPSHOT.services.filter((x) => x.systemSocket)) {
      expect(needsTunnel(s)).toBe(false)
    }
  })
})

describe('边界与时间', () => {
  it('边界文案写明没探测过连通性', () => {
    const lines = scanBoundaries(SNAPSHOT)
    expect(lines[0]).toContain('没有连过这些端口')
    expect(lines.some((l) => l.includes('不猜协议'))).toBe(true)
  })

  it('未提权时额外说明进程名可信度', () => {
    const lines = scanBoundaries({ ...SNAPSHOT, elevated: false })
    expect(lines.some((l) => l.includes('没有取得 root'))).toBe(true)
  })

  it('有解析警告时把条数说出来', () => {
    const lines = scanBoundaries({ ...SNAPSHOT, warnings: ['a', 'b'] })
    expect(lines.some((l) => l.includes('2 条'))).toBe(true)
  })

  it('扫描时间用相对说法，超过一小时才给钟点', () => {
    expect(formatScannedAt(NOW, NOW)).toBe('刚刚')
    expect(formatScannedAt(NOW - 30_000, NOW)).toBe('刚刚')
    expect(formatScannedAt(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
    expect(formatScannedAt(NOW - 3 * 3_600_000, NOW)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('有域名时入口换成域名', () => {
  const service = SNAPSHOT.services.find((s) => s.port === 8443)!
  const domain = {
    serviceId: service.id,
    host: 'rancher.example.com',
    url: 'https://rancher.example.com',
    match: '/',
    kind: 'prefix' as const,
    isRoot: true,
    scheme: 'https' as const,
    source: '/etc/nginx/sites-enabled/site-rancher'
  }

  it('地址就是域名，且不再要求建隧道 —— 走域名本来就不需要', () => {
    const entrance = buildEntrance(service, ENDPOINT, new Map(), domain)
    expect(entrance.address).toBe('https://rancher.example.com')
    expect(entrance.openUrl).toBe('https://rancher.example.com')
    expect(entrance.action).toBe('open')
    expect(entrance.protocol).toBe('https')
    expect(entrance.needsTunnel).toBe(false)
    expect(entrance.schemeChoices).toEqual([])
  })

  it('隧道命令不因为有域名就撤掉 —— 备选地址没有它就是一串打不开的字', () => {
    const entrance = buildEntrance(service, ENDPOINT, new Map(), domain)
    expect(entrance.tunnelCommand).toContain('-L 127.0.0.1:28443:127.0.0.1:8443')
    expect(entrance.localAddress).toBe('127.0.0.1:28443')
  })

  it('判断依据换成「这个域名反代到哪个端口」，用户能核对', () => {
    const entrance = buildEntrance(service, ENDPOINT, new Map(), domain)
    expect(entrance.protocolReason).toContain('rancher.example.com')
    expect(entrance.protocolReason).toContain('127.0.0.1:8443')
    expect(entrance.protocolReason).toContain('site-rancher')
  })

  it('直连写法降级成备注保留下来 —— 域名解析坏了它还能用', () => {
    const entrance = buildEntrance(service, ENDPOINT, new Map(), domain)
    expect(entrance.directAddress).toBe('127.0.0.1:28443')
    expect(entrance.directOpenUrl).toBe('https://127.0.0.1:28443')
  })

  it('没有域名时行为和以前完全一样：地址是 IP:端口，不给 direct 备注', () => {
    const entrance = buildEntrance(service, ENDPOINT)
    expect(entrance.domain).toBeNull()
    expect(entrance.directAddress).toBeNull()
    expect(entrance.address).toBe('https://127.0.0.1:28443')
    expect(entrance.needsTunnel).toBe(true)
  })

  it('SSH 服务不会被域名抢走入口 —— 没有人在浏览器里开一个 ssh 端口', () => {
    const ssh = SNAPSHOT.services.find((s) => s.port === 22)!
    const entrance = buildEntrance(ssh, ENDPOINT, new Map(), { ...domain, serviceId: ssh.id })
    expect(entrance.action).toBe('ssh')
    expect(entrance.domain).toBeNull()
    expect(entrance.address).toBe('10.0.0.12:22')
  })

  it('子路径入口带上路径，别把人送到站点首页', () => {
    const stats = { ...domain, url: 'https://rancher.example.com/stats/', match: '/stats/', isRoot: false }
    const entrance = buildEntrance(service, ENDPOINT, new Map(), stats)
    expect(entrance.address).toBe('https://rancher.example.com/stats/')
  })
})

describe('域名入口清单与反向代理总览', () => {
  const PROXIED = [
    'MYSSH_NETLIST_V1',
    '[meta]',
    'uid=0',
    'sudo=1',
    '[tcplisten]',
    'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=1,fd=3))',
    'LISTEN 0 128 127.0.0.1:8443 0.0.0.0:* users:(("rancher",pid=2,fd=3))',
    '[nginxconf]',
    '@@FILE /etc/nginx/sites-enabled/site-blog',
    'server {',
    '    listen 443 ssl;',
    '    server_name blog.example.com;',
    '    location / {',
    '        proxy_pass http://127.0.0.1:30001;',
    '    }',
    '}',
    '@@END',
    '@@FILE /etc/nginx/sites-enabled/site-gateway',
    'server {',
    '    listen 443 ssl;',
    '    server_name llm.example.com;',
    '    location = / {',
    '        return 302 /ui/;',
    '    }',
    '    location / {',
    '        proxy_pass http://10.99.0.2:30400;',
    '    }',
    '    location ~* "^/_next/static/.+\\.js$" {',
    '        proxy_pass http://10.99.0.2:30400;',
    '    }',
    '}',
    '@@END',
    'END'
  ].join('\n')
  const snapshot = snapshotFrom(PROXIED)

  it('域名入口扁平清单带得出服务 id、地址与配置来源', () => {
    expect(snapshot.entrances).toHaveLength(1)
    expect(snapshot.entrances[0]).toMatchObject({
      serviceId: 'session-1:tcp:30001',
      host: 'blog.example.com',
      url: 'https://blog.example.com',
      isRoot: true,
      scheme: 'https',
      source: '/etc/nginx/sites-enabled/site-blog'
    })
  })

  it('域名总数与「落在本机上」的数目分开报 —— 报错了就是在骗人', () => {
    expect(snapshot.proxy.domains).toBe(2)
    expect(snapshot.proxy.linked).toBe(1)
    expect(snapshot.proxy.files).toBe(2)
  })

  it('上游在外面的域名说出四种成因里的哪一种', () => {
    expect(snapshot.proxy.external).toHaveLength(1)
    expect(snapshot.proxy.external[0].reason).toContain('不在本机')
  })

  it('一个域名下有多条落不到本机的路由时，仍只算这个域名一个', () => {
    // llm 有 3 条路由（= / 跳转、/ 上游、正则静态资源），落不到本机的是 2 条。
    // 按路由数报就会把 1 个域名说成 2 个 —— 真机上踩到过这个说法
    expect(snapshot.proxy.external).toHaveLength(1)
    expect(snapshot.proxy.external[0].host).toBe('llm.example.com')
    expect(snapshot.proxy.external[0].routes).toBe(2)
    // 代表这个域名的那一条是根路径，不是静态资源正则
    expect(snapshot.proxy.external[0].match).toBe('/')
  })

  it('连锁文案在有域名时补上域名，没有域名时一字不变', () => {
    expect(buildOverview(snapshot.counts).chainText).toContain('（2 个域名）')
    expect(buildOverview({ ...snapshot.counts, domains: 0 }).chainText).not.toContain('域名')
  })

  it('有域名时应用名就是域名', () => {
    expect(snapshot.applications[0].displayName).toBe('blog.example.com')
    expect(snapshot.applications[0].domain).toBe('blog.example.com')
  })
})
