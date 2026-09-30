import { describe, expect, it } from 'vitest'
import { PROC_HEADER, PROC_ROWS, SS_EXPECTED, SS_OUTPUT } from '../../tests/fixtures/netlist-sample'
import {
  buildServices,
  decodeProcAddress,
  deriveBindScope,
  findTunnelPortCollisions,
  groupApplications,
  inferScheme,
  mergeByPort,
  NETLIST_COMMAND,
  NETLIST_SECTION_KEYS,
  parseContainerLine,
  parseListenLine,
  parseLocalAddress,
  parseNetlist,
  parseProcNetLine,
  tunnelPortFor,
  TUNNEL_PORT_RANGE,
  type MergedService,
  type ServiceRecord
} from './netlist'

const NOW = 1_700_000_000_000

/** 走完整收敛链的前两步：监听记录 → 服务（按端口合并 v4/v6） */
function servicesFrom(raw: string): MergedService[] {
  return mergeByPort(buildServices(parseNetlist(raw), { nodeId: 'session-1', now: NOW }))
}


describe('地址解析', () => {
  it('解析常规 IPv4', () => {
    expect(parseLocalAddress('0.0.0.0:22')).toEqual({ addr: '0.0.0.0', scope: undefined, port: 22, family: 4 })
  })

  it('解析带方括号的 IPv6，端口要从最后一个 ] 之后取', () => {
    expect(parseLocalAddress('[::]:443')).toEqual({ addr: '::', scope: undefined, port: 443, family: 6 })
    expect(parseLocalAddress('[fe80::1]:8080')).toMatchObject({ addr: 'fe80::1', port: 8080, family: 6 })
  })

  it('把作用域后缀从地址里剥掉但保留下来', () => {
    expect(parseLocalAddress('127.0.0.53%lo:53')).toEqual({ addr: '127.0.0.53', scope: 'lo', port: 53, family: 4 })
    expect(parseLocalAddress('10.0.0.12%eth0:68')).toMatchObject({ addr: '10.0.0.12', scope: 'eth0', port: 68 })
  })

  it('拒绝没有端口的文本', () => {
    expect(parseLocalAddress('0.0.0.0')).toBeNull()
    expect(parseLocalAddress('abc:xyz')).toBeNull()
  })

  it('按地址推监听范围', () => {
    expect(deriveBindScope('0.0.0.0')).toBe('all')
    expect(deriveBindScope('::')).toBe('all')
    expect(deriveBindScope('127.0.0.1')).toBe('loopback')
    expect(deriveBindScope('::1')).toBe('loopback')
    expect(deriveBindScope('10.0.0.12')).toBe('specific')
  })
})

describe('ss 行解析', () => {
  it('一 socket 多持有者时保留全部进程', () => {
    const line =
      'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1201,fd=6),("nginx",pid=1202,fd=6),("nginx",pid=1203,fd=6))'
    const socket = parseListenLine(line, 'tcp')
    expect(socket?.processes).toHaveLength(3)
    expect(socket?.owner?.pid).toBe(1201)
  })

  it('socket 激活时跳过 systemd，归属给真正的服务进程', () => {
    const line = 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("systemd",pid=1,fd=45),("sshd",pid=812,fd=3))'
    const socket = parseListenLine(line, 'tcp')
    expect(socket?.owner).toEqual({ name: 'sshd', pid: 812, fd: 3 })
    expect(socket?.processes).toHaveLength(2)
  })

  it('列尾空格不一致也能解析（不能按固定列宽切）', () => {
    const padded = 'LISTEN 0      128          0.0.0.0:22           0.0.0.0:*      users:(("sshd",pid=1,fd=3))'
    const raw = 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))'
    expect(parseListenLine(padded, 'tcp')?.port).toBe(22)
    expect(parseListenLine(raw, 'tcp')?.port).toBe(22)
  })

  it('端口没进程名时 owner 为 null（非 root 的典型形态）', () => {
    const socket = parseListenLine('LISTEN 0 128 0.0.0.0:22 0.0.0.0:*', 'tcp')
    expect(socket?.owner).toBeNull()
    expect(socket?.processes).toEqual([])
  })
})

describe('/proc 退化路径', () => {
  it('十六进制地址按 32 位小端还原', () => {
    expect(decodeProcAddress('0100007F')).toEqual({ addr: '127.0.0.1', family: 4 })
    expect(decodeProcAddress('00000000')).toEqual({ addr: '0.0.0.0', family: 4 })
    expect(decodeProcAddress('0A00000A')).toEqual({ addr: '10.0.0.10', family: 4 })
  })

  it('IPv6 十六进制地址压成标准写法', () => {
    expect(decodeProcAddress('00000000000000000000000000000000')).toEqual({ addr: '::', family: 6 })
    expect(decodeProcAddress('00000000000000000000000001000000')).toEqual({ addr: '::1', family: 6 })
  })

  it('只取 TCP 的 LISTEN 状态，其他状态丢掉', () => {
    const listen = '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 1'
    const established = '   0: 0100007F:1F90 0100007F:0050 01 00000000:00000000 00:00000000 00000000  1000 0 1'
    expect(parseProcNetLine(listen, 'tcp')?.port).toBe(8080)
    expect(parseProcNetLine(established, 'tcp')).toBeNull()
  })

  it('退化路径能拿到端口，且明确标注拿不到进程名', () => {
    const raw = [...PROC_HEADER, ...PROC_ROWS, 'END'].join('\n')
    const parsed = parseNetlist(raw)

    expect(parsed.usedProcFallback).toBe(true)
    // 关键：读不出来 ≠ 什么都没监听。这条路径必须给出记录，不能静默返回空表。
    expect(parsed.tcp.map((s) => s.port).sort((a, b) => a - b)).toEqual([80, 8080])
    expect(parsed.warnings.some((w) => w.includes('退化到 /proc'))).toBe(true)
    expect(parsed.tcp.every((s) => s.owner === null)).toBe(true)
    // 表头行不是记录，也不该算作解析失败
    expect(parsed.warnings.some((w) => w.includes('无法解析'))).toBe(false)
  })

  it('把 /proc 格式误当 ss 解析会得到空表 —— 用来锁住这条路径必须显式识别', () => {
    const headerOnly = ['MYSSH_NETLIST_V1', '[tcplisten]', '  sl  local_address rem_address   st', 'END'].join('\n')
    const parsed = parseNetlist(headerOnly)
    expect(parsed.tcp).toEqual([])
    // 所以识别标志必须在，否则上层无法区分「读不出来」和「没有监听」
    expect(parsed.usedProcFallback).toBe(true)
  })
})

describe('容器行解析', () => {
  it('解析单个映射与端口区间映射', () => {
    const record = parseContainerLine(
      'panel\tportainer/portainer-ce:2.19.4\t127.0.0.1:8080->80/tcp, 127.0.0.1:30001-30002->30001-30002/tcp'
    )
    expect(record?.mappings.map((m) => [m.hostPort, m.containerPort])).toEqual([
      [8080, 80],
      [30001, 30001],
      [30002, 30002]
    ])
    expect(record?.mappings[0].bindAddr).toBe('127.0.0.1')
  })

  it('区间长度不一致时按较短的一边对齐，不造出不存在的映射', () => {
    const record = parseContainerLine('c\timg\t9000-9002->80-81/tcp')
    expect(record?.mappings.map((m) => [m.hostPort, m.containerPort])).toEqual([
      [9000, 80],
      [9001, 81]
    ])
  })

  it('只有 EXPOSE 没有映射时不算宿主端口', () => {
    const record = parseContainerLine('c\timg\t80/tcp, 443/tcp')
    expect(record?.mappings).toEqual([])
    expect(record?.exposedOnly).toEqual([
      { port: 80, protocol: 'tcp' },
      { port: 443, protocol: 'tcp' }
    ])
  })
})

describe('整体解析', () => {
  const parsed = parseNetlist(SS_OUTPUT)

  it('识别格式版本并读完整个输出', () => {
    expect(parsed.formatVersion).toBe('MYSSH_NETLIST_V1')
    expect(parsed.truncated).toBe(false)
    expect(parsed.unsupported).toBe(false)
    expect(parsed.usedProcFallback).toBe(false)
    expect(parsed.warnings).toEqual([])
  })

  it('拿到 16 条监听记录（12 TCP + 4 UDP）', () => {
    expect(parsed.tcp).toHaveLength(12)
    expect(parsed.udp).toHaveLength(4)
    expect(parsed.tcp.length + parsed.udp.length).toBe(SS_EXPECTED.sockets)
  })

  it('提权标记决定进程名可信度，不依赖 uid', () => {
    // uid=1000 但 sudo=1 —— 只看 uid 会误判成「进程名不可信」
    expect(parsed.meta).toMatchObject({ uid: 1000, usedSudo: true, elevated: true })
  })

  it('解析 /etc/os-release 时剥掉值两侧的引号', () => {
    expect(parsed.os).toEqual({ id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04.4 LTS' })
  })

  it('docker ps 的端口映射进入容器清单', () => {
    expect(parsed.containers).toHaveLength(4)
    expect(parsed.containers.every((c) => c.containerName === 'panel')).toBe(true)
  })

  it('缺少 END 哨兵时判定为被截断', () => {
    const cut = parseNetlist(SS_OUTPUT.replace('\nEND', ''))
    expect(cut.truncated).toBe(true)
    expect(cut.warnings.some((w) => w.includes('END'))).toBe(true)
  })

  it('远端报告不支持时不抛异常', () => {
    const unsupported = parseNetlist(['MYSSH_NETLIST_UNSUPPORTED', 'END'].join('\n'))
    expect(unsupported.unsupported).toBe(true)
    expect(unsupported.tcp).toEqual([])
  })

  it('首行不是已知哨兵时降级解析并记 warning', () => {
    const odd = parseNetlist(['something else', '[tcplisten]', 'END'].join('\n'))
    expect(odd.formatVersion).toBeNull()
    expect(odd.warnings.some((w) => w.includes('哨兵'))).toBe(true)
  })
})

describe('服务归约', () => {
  const services = servicesFrom(SS_OUTPUT)

  it('16 条监听记录收成 12 个服务（v4/v6 合并）', () => {
    expect(services).toHaveLength(SS_EXPECTED.services)
    expect(services.filter((s) => !s.systemSocket)).toHaveLength(SS_EXPECTED.accessibleServices)
    const port22 = services.filter((s) => s.port === 22)
    expect(port22).toHaveLength(1)
    expect(port22[0].bindAddr).toBe('0.0.0.0')
  })

  it('合并后的标识按 (协议, 端口) 稳定，不把绑定地址写进身份', () => {
    expect(services.find((s) => s.port === 80)?.id).toBe('session-1:tcp:80')
    const eighty = services.find((s) => s.port === 80)!
    expect(eighty.family).toBe('both')
    expect(eighty.bindAddrs).toEqual(['0.0.0.0', '::'])
  })

  it('把系统后台套接字单独标出来', () => {
    const system = services.filter((s) => s.systemSocket)
    // 53/tcp、53/udp、68/udp、323/udp
    expect(system).toHaveLength(SS_EXPECTED.systemSockets)
    expect(system.map((s) => s.port).sort((a, b) => a - b)).toEqual([53, 53, 68, 323])
    expect(system.find((s) => s.port === 68)?.systemSocketReason).toContain('DHCP')
  })

  it('系统套接字的判据是进程职责而不是端口号', () => {
    // 53 号端口本身不构成判据：DNS 存根是系统套接字，但接管它的若是别的进程就不该被隔离
    const lookup = parseListenLine('LISTEN 0 128 127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=1,fd=3))', 'tcp')
    const record = buildServices(
      {
        ...parseNetlist(['MYSSH_NETLIST_V1', '[tcplisten]', 'END'].join('\n')),
        tcp: [lookup!],
        containers: []
      },
      { nodeId: 'n', now: NOW }
    )[0]
    expect(record.systemSocket).toBe(false)
  })

  it('docker-proxy 不认领服务名，服务名来自容器镜像', () => {
    const panel = services.filter((s) => s.container?.name === 'panel')
    expect(panel).toHaveLength(4)
    expect(panel.every((s) => s.displayName === 'Portainer')).toBe(true)
    expect(panel.every((s) => s.category === 'panel')).toBe(true)
    expect(panel.every((s) => s.confidence === 'high')).toBe(true)
  })

  it('把「一端口多进程」写进证据链，不让它在界面上消失', () => {
    const ssh = services.find((s) => s.port === 22)!
    const processEvidence = ssh.evidence.find((e) => e.source === 'process')!
    expect(processEvidence.value).toContain('sshd (pid 812)')
    expect(processEvidence.value).toContain('另由 systemd(pid 1) 持有')
  })

  it('进程名可识别时用模型名，不可识别时退回进程名', () => {
    expect(services.find((s) => s.port === 80)?.displayName).toBe('nginx')
    expect(services.find((s) => s.port === 80)?.process?.name).toBe('nginx')
  })

  it('没有进程也没有容器时才用端口表，且可信度降到 low', () => {
    const bare = buildServices(
      { ...parseNetlist(['MYSSH_NETLIST_V1', '[tcplisten]', 'END'].join('\n')), tcp: [parseListenLine('LISTEN 0 128 0.0.0.0:6379 0.0.0.0:*', 'tcp')!] },
      { nodeId: 'n', now: NOW }
    )[0]
    expect(bare.displayName).toBe('Redis')
    expect(bare.confidence).toBe('low')
    expect(bare.evidence.map((e) => e.source)).toEqual(['port-table'])
  })

  it('按监听范围排序，可直连的排在只绑本机的之前', () => {
    const order = services.map((s) => s.bindScope)
    const weight: Record<string, number> = { all: 0, specific: 1, loopback: 2 }
    const weights = order.map((s) => weight[s])
    expect(weights).toEqual([...weights].sort((a, b) => a - b))
  })
})

describe('协议推断', () => {
  const services = servicesFrom(SS_OUTPUT)

  it('容器内是 443/80 时反推出协议 —— 宿主端口本身看不出来', () => {
    expect(inferScheme(services.find((s) => s.port === 8443)!)).toMatchObject({ scheme: 'https', confident: true })
    expect(inferScheme(services.find((s) => s.port === 8080)!)).toMatchObject({ scheme: 'http', confident: true })
  })

  it('标准端口直接给结论', () => {
    expect(inferScheme(services.find((s) => s.port === 443)!)).toMatchObject({ scheme: 'https', confident: true })
    expect(inferScheme(services.find((s) => s.port === 80)!)).toMatchObject({ scheme: 'http', confident: true })
  })

  it('SSH 不给协议，理由指向终端', () => {
    const verdict = inferScheme(services.find((s) => s.port === 22)!)
    expect(verdict.scheme).toBe('unknown')
    expect(verdict.reason).toContain('终端')
  })

  it('看不出来时返回 unknown 而不是猜一个 http', () => {
    const verdict = inferScheme(services.find((s) => s.port === 30001)!)
    expect(verdict.scheme).toBe('unknown')
    expect(verdict.confident).toBe(false)
    expect(verdict.reason).toContain('两个都备着')
  })
})

describe('应用归组', () => {
  const services = servicesFrom(SS_OUTPUT)
  const apps = groupApplications(services)

  it('12 个服务收成 4 个应用', () => {
    expect(apps).toHaveLength(SS_EXPECTED.applications)
    expect(apps.map((a) => a.displayName)).toEqual([...SS_EXPECTED.apps])
    // 收敛链每一级都要比上一级更少，否则「收敛」这个词就不成立
    expect(apps.length).toBeLessThan(services.filter((s) => !s.systemSocket).length)
    expect(services.length).toBeLessThan(SS_EXPECTED.sockets)
  })

  it('一个容器对外开的 4 个宿主端口是同一个应用', () => {
    const panel = apps[0]
    expect(panel.kind).toBe('container')
    expect(panel.ports).toEqual([8443, 8080, 30001, 30002])
    expect(panel.detail).toContain('portainer/portainer-ce:2.19.4')
  })

  it('归组键不看端口号：30001/30002 与 8080/8443 同属一个容器应用', () => {
    expect(apps.find((a) => a.id === 'container:panel')?.ports).toHaveLength(4)
  })

  it('默认入口取协议最确定的那个，https 优先于 http', () => {
    const panel = apps[0]
    expect(panel.primaryId).toBe(panel.services[0].id)
    expect(panel.services[0].port).toBe(8443)
    expect(apps.find((a) => a.id === 'process:nginx')?.services[0].port).toBe(443)
  })

  it('同一进程的多个端口并成一个应用', () => {
    const nginx = apps.find((a) => a.id === 'process:nginx')!
    expect(nginx.ports).toEqual([443, 80])
    expect(nginx.kind).toBe('process')
  })

  it('系统后台套接字默认不进应用清单', () => {
    expect(apps.some((a) => a.displayName.includes('chronyd'))).toBe(false)
    expect(apps.some((a) => a.displayName.includes('DNS'))).toBe(false)
  })

  it('显式要求时才把系统套接字算进来', () => {
    const withSystem = groupApplications(services, { includeSystemSockets: true })
    expect(withSystem.length).toBeGreaterThan(apps.length)
    expect(withSystem.some((a) => a.detail.includes('chronyd'))).toBe(true)
  })
})

describe('隧道端口推导', () => {
  it('只依赖远端端口，重扫不变', () => {
    expect(tunnelPortFor(8080)).toBe(28080)
    expect(tunnelPortFor(8443)).toBe(28443)
    expect(tunnelPortFor(22)).toBe(20022)
    expect(tunnelPortFor(30901)).toBe(23901)
  })

  it('落在声明区间内', () => {
    for (const port of [1, 22, 80, 443, 8080, 30001, 65535]) {
      const local = tunnelPortFor(port)
      expect(local).toBeGreaterThanOrEqual(TUNNEL_PORT_RANGE.from)
      expect(local).toBeLessThan(TUNNEL_PORT_RANGE.to + 1)
    }
  })

  it('只有相差 9000 整数倍的远端端口才会撞车', () => {
    expect(tunnelPortFor(8080)).not.toBe(tunnelPortFor(8081))
    expect(tunnelPortFor(8080)).toBe(tunnelPortFor(8080 + 9000))
  })
})

describe('隧道端口撞车检测', () => {
  /**
   * 撞车判定只读 port / protocol / bindScope / systemSocket 四个字段，
   * 其余按最小可满足构造 —— 让测试失败时指向推导规则，而不是夹具噪声。
   */
  function service(over: Partial<ServiceRecord> & { port: number }): ServiceRecord {
    return {
      id: `n:${over.protocol ?? 'tcp'}:${over.port}`,
      nodeId: 'n',
      protocol: 'tcp',
      bindAddr: '127.0.0.1',
      // 默认 loopback：只有「绑本机」的服务才需要隧道
      bindScope: 'loopback',
      evidence: [],
      displayName: `port-${over.port}`,
      category: 'unknown',
      confidence: 'low',
      systemSocket: false,
      ...over
    }
  }

  it('同一个端口号出现在两种协议上会撞车（推导只看端口号）', () => {
    const collisions = findTunnelPortCollisions([
      service({ port: 53, protocol: 'tcp' }),
      service({ port: 53, protocol: 'udp' })
    ])
    expect(collisions).toHaveLength(1)
    expect(collisions[0].localPort).toBe(20053)
    expect(collisions[0].services.map((s) => s.protocol).sort()).toEqual(['tcp', 'udp'])
  })

  it('远端端口相差 9000 的整数倍会撞车', () => {
    const collisions = findTunnelPortCollisions([
      service({ port: 8080 }),
      service({ port: 17080 })
    ])
    expect(collisions).toHaveLength(1)
    expect(collisions[0].localPort).toBe(28080)
    expect(collisions[0].services.map((s) => s.port).sort((a, b) => a - b)).toEqual([8080, 17080])
  })

  it('推导结果互不相同时返回空数组，而不是给一堆长度为 1 的组', () => {
    expect(
      findTunnelPortCollisions([
        service({ port: 8080 }),
        service({ port: 8081 }),
        service({ port: 30001 })
      ])
    ).toEqual([])
  })

  it('系统后台套接字不参与 —— 它们不会被建隧道', () => {
    // 夹具里 53/tcp 与 53/udp 恰好是同一个端口号跨两种协议，
    // 但两侧都是 systemd-resolved 存根，所以不该报冲突。
    const collisions = findTunnelPortCollisions(servicesFrom(SS_OUTPUT))
    const fiftyThree = servicesFrom(SS_OUTPUT).filter((s) => s.port === 53)
    expect(fiftyThree).toHaveLength(2)
    expect(fiftyThree.every((s) => s.systemSocket)).toBe(true)
    expect(collisions).toEqual([])
  })

  it('能直连的服务不参与 —— 直连不需要隧道', () => {
    const collisions = findTunnelPortCollisions([
      service({ port: 53, protocol: 'tcp', bindScope: 'all' }),
      service({ port: 53, protocol: 'udp', bindScope: 'all' })
    ])
    expect(collisions).toEqual([])
  })

  it('夹具里可访问服务的推导端口两两不同（锁住真实场景不该误报）', () => {
    const accessible = servicesFrom(SS_OUTPUT).filter((s) => !s.systemSocket)
    const locals = accessible.map((s) => tunnelPortFor(s.port))
    expect(new Set(locals).size).toBe(locals.length)
    expect(findTunnelPortCollisions(accessible)).toEqual([])
  })
})

describe('采集脚本本身', () => {
  /**
   * 硬约束：这整条脚本会作为**单个参数**下发给远端 shell。
   * 任何一个单引号都会截断外层引号，脚本会以「语法错误」或「命令被腰斩」的形式坏掉，
   * 而截断后的输出仍然可能被解析成一份看似正常的清单 —— 所以这条要机器守着。
   */
  it('不含单引号', () => {
    expect(NETLIST_COMMAND.includes("'")).toBe(false)
  })

  it('打的每个分段标记，解析侧都认得', () => {
    const markers = [...NETLIST_COMMAND.matchAll(/printf "\[([a-z]+)\]/g)].map((m) => m[1])
    expect(markers.length).toBeGreaterThan(0)
    for (const marker of markers) {
      expect(NETLIST_SECTION_KEYS[marker], `脚本打了 [${marker}]，但解析侧没有对应键`).toBeDefined()
    }
    // 反向：解析侧认得的标记也都在脚本里出现了 —— 只认不打同样是缺陷
    for (const key of Object.keys(NETLIST_SECTION_KEYS)) {
      expect(markers, `解析侧认得 [${key}]，但脚本从未打这个标记`).toContain(key)
    }
  })

  it('按 @@FILE / @@END 采集 nginx 配置，且不碰未启用的 sites-available', () => {
    expect(NETLIST_COMMAND).toContain('printf "[nginxconf]')
    expect(NETLIST_COMMAND).toContain('printf "@@FILE %s\\n"')
    expect(NETLIST_COMMAND).toContain('/etc/nginx/sites-enabled/*')
    expect(NETLIST_COMMAND).not.toContain('sites-available')
  })
})

describe('nginx 配置段的搬运', () => {
  const raw = [
    'MYSSH_NETLIST_V1',
    '[tcplisten]',
    'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=1,fd=3))',
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
    'END'
  ].join('\n')

  it('原文按行收集，交给上层解析 —— 这一步不解析域名', () => {
    const parsed = parseNetlist(raw)
    expect(parsed.nginxConfig).toContain('@@FILE /etc/nginx/sites-enabled/site-blog')
    expect(parsed.nginxConfig).toContain('proxy_pass http://127.0.0.1:30001;')
    expect(parsed.warnings).toEqual([])
  })

  it('没有 [nginxconf] 段时是空字符串，不是 undefined，也不记 warning', () => {
    const parsed = parseNetlist(['MYSSH_NETLIST_V1', '[tcplisten]', 'END'].join('\n'))
    expect(parsed.nginxConfig).toBe('')
    expect(parsed.warnings).toEqual([])
  })

  it('nginx 段里带方括号的行不会被误认成新分段', () => {
    const withBracket = raw.replace(
      '    listen 443 ssl;',
      '    listen 443 ssl;\n    # 形如 [nginxconf] 的注释行不该切换分段\n    add_header X "[meta]" always;'
    )
    const parsed = parseNetlist(withBracket)
    expect(parsed.tcp).toHaveLength(1)
    expect(parsed.nginxConfig).toContain('形如 [nginxconf] 的注释行')
    expect(parsed.nginxConfig).toContain('add_header X "[meta]" always;')
  })
})
