import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SS_EXPECTED, SS_OUTPUT } from '../../../../../tests/fixtures/netlist-sample'
import { NGINX_SECTION } from '../../../../../tests/fixtures/vhost-sample'
import { buildScanSnapshot, type EntranceEndpoint } from '@shared/entrance'
import type { ServiceScanSnapshot } from '@shared/types'
import ServicesView, { type ServicesViewProps } from './ServicesView'

/**
 * 展示层的静态渲染断言。
 *
 * 用静态渲染而不是真浏览器，原因是本机浏览器不可用（Chrome headless 被信号终止，
 * 自带无头 shell 连不上 127.0.0.1）。它能验的是**节点结构与文本**，
 * 验不了观感、间距、字体 —— 观感这一层没有被验证过，不要当成验过。
 *
 * 之所以还是值得写：上一版同类界面出过的三个问题（静态按钮没有处理函数、
 * 折叠属性被 CSS 覆盖、多端口应用「折叠了但还在渲染」）里，
 * 有两个正是「节点树里到底有没有这个元素」的问题。
 */

const NOW = 1_700_000_000_000

const ENDPOINT: EntranceEndpoint = {
  host: '10.0.0.12',
  sshPort: 22,
  username: 'deploy',
  keyPath: '/home/deploy/.ssh/id_ed25519'
}

/** 走产品里同一条装配链，而不是在测试里手搭一个中间态 */
function snapshotFrom(raw: string): ServiceScanSnapshot {
  return buildScanSnapshot(raw, { nodeId: 'session-1', now: NOW })!
}

const SNAPSHOT = snapshotFrom(SS_OUTPUT)

/**
 * 带反向代理的那份输出：端口夹具的 socket 行 + nginx 夹具的配置段。
 * 有意思的是两份夹具里的端口号本来就对得上（30001 / 8099 / 30900 / 30901 / 8443）——
 * 于是这里不需要发明新数据，就能验「域名把服务认领成了哪些应用」。
 */
const PROXIED_OUTPUT = [
  'MYSSH_NETLIST_V1',
  '[meta]',
  'uid=0',
  'sudo=1',
  '[tcplisten]',
  'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("node",pid=31001,fd=3))',
  'LISTEN 0 128 127.0.0.1:8099 0.0.0.0:* users:(("python3",pid=8099,fd=3))',
  'LISTEN 0 128 127.0.0.1:30900 0.0.0.0:* users:(("minio",pid=30900,fd=3))',
  'LISTEN 0 128 127.0.0.1:30901 0.0.0.0:* users:(("minio",pid=30901,fd=3))',
  'LISTEN 0 128 127.0.0.1:8443 0.0.0.0:* users:(("rancher",pid=8443,fd=3))',
  '[nginxconf]',
  NGINX_SECTION,
  'END'
].join('\n')

const PROXIED = snapshotFrom(PROXIED_OUTPUT)

/** 自建 DNS：同一个端口号出现在 tcp + udp 上，两侧都不是系统套接字 */
const DNS_BOTH_PROTOCOLS = [
  'MYSSH_NETLIST_V1',
  '[meta]',
  'uid=0',
  'sudo=1',
  '[tcplisten]',
  'LISTEN 0 128 127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=100,fd=3))',
  '[udplisten]',
  'UNCONN 0 0 127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=100,fd=4))',
  '[identity]',
  '0',
  'END'
].join('\n')

function render(over: Partial<ServicesViewProps> = {}): string {
  return renderToStaticMarkup(
    <ServicesView
      snapshot={SNAPSHOT}
      error={null}
      scanning={false}
      scannedLabel="刚刚"
      endpoint={ENDPOINT}
      selectedPorts={{}}
      toast={null}
      onRescan={() => {}}
      onSelectPort={() => {}}
      onCopy={() => {}}
      onOpen={() => {}}
      {...over}
    />
  )
}

/** 数某个原文出现几次。用原文而不是正则，避免 \b 在 `services-chip-star` 上误命中 */
function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1
}

function sliceBetween(html: string, from: string, to: string): string {
  const start = html.indexOf(from)
  expect(start, `没有找到 ${from}`).toBeGreaterThanOrEqual(0)
  const end = html.indexOf(to, start)
  expect(end, `从 ${from} 之后没有找到 ${to}`).toBeGreaterThan(start)
  return html.slice(start, end)
}

const CARD_OPEN = 'class="services-card"'
const CARDS_OPEN = 'class="services-cards"'
const FOLD_OPEN = 'class="services-fold"'

describe('首屏是应用而不是端口', () => {
  const html = render()

  it('渲染出 4 张应用卡，而不是 12 条端口记录', () => {
    expect(countOf(html, CARD_OPEN)).toBe(SS_EXPECTED.applications)
  })

  it('收敛链的四个数字都出现，且有一句可核对的原文', () => {
    // 视觉上是四个格子，句子形式挂在 aria-label 上 —— 模型里算好的那句必须真被用上，
    // 不能只存在于测试里（上一版的 /proc 退化路径就是这么变成死代码的）
    expect(html).toContain('aria-label="16 监听记录 → 12 服务 → 8 入口 → 4 应用"')
    expect(html).toContain('<strong>16</strong><span>监听记录</span>')
    expect(html).toContain('<strong>8</strong><span>入口</span>')
  })

  it('每个应用名都在卡上', () => {
    for (const name of SS_EXPECTED.apps) {
      expect(html).toContain(`<h3>${name}</h3>`)
    }
  })

  it('容器应用标了「容器」，进程应用标了「进程」', () => {
    expect(html).toContain('services-kind-container')
    expect(html).toContain('services-kind-process')
  })
})

describe('每个应用都有可点的入口', () => {
  const html = render()
  const firstCard = sliceBetween(html, CARD_OPEN, '</section>')

  it('默认入口是协议最确定的那个：Rancher 给 8443 的 https 地址', () => {
    expect(firstCard).toContain('https://127.0.0.1:28443')
    expect(firstCard).toContain('需隧道')
  })

  it('可直连的应用给出直连地址与「打开」按钮', () => {
    expect(html).toContain('https://10.0.0.12:443')
    expect(html).toContain('可直连')
    expect(sliceBetween(html, 'nginx</h3>', '</section>')).toContain('>打开</button>')
  })

  it('需要隧道的入口给出隧道命令，并说明不会替你建隧道', () => {
    expect(html).toContain(
      'ssh -N -L 127.0.0.1:28443:127.0.0.1:8443 -p 22 -i /home/deploy/.ssh/id_ed25519 deploy@10.0.0.12'
    )
    expect(html).toContain('本面板不会替你建隧道')
  })

  it('协议看不出来的入口给裸地址加两个候选按钮，绝不补一个 http://', () => {
    const html = render({ selectedPorts: { 'container:panel': 30001 } })
    const card = sliceBetween(html, CARD_OPEN, '</section>')
    expect(card).toContain('<code>127.0.0.1:23001</code>')
    expect(card).not.toContain('<code>http://')
    expect(card).toContain('协议待确认')
    expect(card).toContain('>用 http</button>')
    expect(card).toContain('>用 https</button>')
  })

  it('SSH 入口给的是终端命令，不是网页，且命令本身看得见', () => {
    const sshCard = sliceBetween(html, '<h3>OpenSSH</h3>', '</section>')
    expect(sshCard).toContain('复制 SSH 命令')
    // 只复制不展示等于让人盲抄：命令必须印在卡上
    expect(sshCard).toContain('<code>ssh -i /home/deploy/.ssh/id_ed25519 deploy@10.0.0.12</code>')
    expect(sshCard).not.toContain('>打开</button>')
    expect(sshCard).not.toContain('用 http')
  })

  it('每个入口都带协议判断依据，用户能核对而不是只能信', () => {
    expect(html).toContain('services-entrance-reason')
    expect(html).toContain('容器内是 443')
  })
})

describe('端口切换', () => {
  it('多端口应用把端口列成可点的 chip，而不是摊成多张卡', () => {
    const html = render()
    // 夹具里只有 Portainer（4 个宿主端口）与 nginx（2 个）需要切换，
    // 单端口应用不给 chip 行 —— 一个口的「切换」是假的
    expect(countOf(html, 'role="tab"')).toBe(6)
    expect(countOf(html, 'services-chip-star')).toBe(2)
    expect(html).toContain('aria-label="Portainer 的端口"')
    expect(html).not.toContain('aria-label="OpenSSH 的端口"')
  })

  it('选中另一个端口时换的是卡上的入口地址，不是换一张卡', () => {
    const html = render({ selectedPorts: { 'container:panel': 30001 } })
    expect(countOf(html, CARD_OPEN)).toBe(SS_EXPECTED.applications)
    const card = sliceBetween(html, CARD_OPEN, '</section>')
    expect(card).toContain('127.0.0.1:23001')
    expect(card).not.toContain('127.0.0.1:28443')
  })
})

describe('隧道端口撞车标在入口上', () => {
  it('同端口跨协议时给出冲突说明，而不是静默换端口', () => {
    const html = render({ snapshot: snapshotFrom(DNS_BOTH_PROTOCOLS) })
    expect(html).toContain('services-tunnel-conflict')
    expect(html).toContain('53/tcp、53/udp')
    expect(html).toContain('不自动改端口')
  })

  it('没有撞车时不出现冲突说明', () => {
    expect(render()).not.toContain('services-tunnel-conflict')
  })
})

describe('排除掉的东西不能消失', () => {
  const html = render()

  it('系统后台套接字收在折叠区里，并说明为什么隔离', () => {
    expect(html).toContain('系统后台套接字 4 个 · 已从入口里隔离')
    expect(html).toContain('systemd-resolved DNS 存根解析器，仅本机可用')
    expect(html).toContain('DHCP 客户端套接字')
  })

  it('折叠区里的端口不出现在卡片区', () => {
    const cards = sliceBetween(html, CARDS_OPEN, FOLD_OPEN)
    for (const port of [53, 68, 323]) {
      expect(cards).not.toContain(`>${port}<`)
    }
  })

  it('能力边界写在界面上，不只在汇报里', () => {
    expect(html).toContain('没有连过这些端口')
    expect(html).toContain('不猜协议')
  })

  it('提示条挂在面板内部，才有定位上下文（拿出去会被 flex 布局当成兄弟项）', () => {
    const withToast = render({ toast: '已复制隧道命令' })
    expect(withToast).toContain('已复制隧道命令')
    const panelOpen = withToast.indexOf('class="services-panel"')
    const bodyClose = withToast.lastIndexOf('</div>')
    expect(withToast.indexOf('services-toast')).toBeGreaterThan(panelOpen)
    expect(withToast.indexOf('services-toast')).toBeLessThan(bodyClose)
  })
})

describe('错误与等待状态', () => {
  it('说清是哪种失败，且不冒充「什么都没监听」', () => {
    const html = render({
      snapshot: null,
      error: { code: 'unsupported', message: '远端既没有 ss 也读不到 /proc/net/tcp,无法发现端口' }
    })
    expect(html).toContain('没能读到端口清单')
    expect(html).toContain('这不是故障')
    expect(html).not.toContain(CARD_OPEN)
  })

  it('首次扫描中给出等待文案，而不是空白', () => {
    const html = render({ snapshot: null, scanning: true })
    expect(html).toContain('正在通过当前 SSH 会话读取监听端口')
    expect(html).toContain('扫描中…')
  })
})

/**
 * 配了反向代理的机器：首屏必须是域名，不是 IP:端口。
 *
 * 这一组的存在理由是一句用户反馈的原话：「这些服务我都配过域名，现在都是纯 ip 访问」——
 * 面板当时把域名这一层整个漏掉了，把 IP:端口当成入口，还要求先建隧道。
 */
describe('有域名时首屏是域名', () => {
  const html = render({ snapshot: PROXIED })

  it('域名应用一张卡一个域名，标题就是域名本身', () => {
    expect(countOf(html, CARD_OPEN)).toBe(4)
    expect(countOf(html, 'services-kind-domain')).toBe(4)
    expect(html).toContain('<h3>rancher.example.com</h3>')
    expect(html).toContain('<h3>oss.example.com</h3>')
  })

  it('默认入口是域名，打开按钮直接可用', () => {
    const card = sliceBetween(html, '<h3>rancher.example.com</h3>', '</section>')
    expect(card).toContain('<code>https://rancher.example.com</code>')
    expect(card).toContain('>打开</button>')
    expect(card).toContain('services-tag domain')
  })

  it('域名入口上不打「需隧道」—— 走域名不需要，标了是在教人绕远路', () => {
    const card = sliceBetween(html, '<h3>rancher.example.com</h3>', '</section>')
    expect(sliceBetween(card, 'services-entrance-address', 'services-entrance-actions')).not.toContain('需隧道')
    expect(card).not.toContain('本面板不会替你建隧道')
  })

  it('IP:端口降级进折叠区，但仍然给得出隧道命令', () => {
    const card = sliceBetween(html, '<h3>rancher.example.com</h3>', '</section>')
    expect(card).toContain('绕过 nginx 直接访问这个端口')
    expect(card).toContain('<code>127.0.0.1:28443</code>')
    expect(card).toContain('复制隧道命令')
    // 折叠区之前的正文里不该再出现那个 IP 端口
    expect(sliceBetween(card, 'services-entrance-address', 'services-alt')).not.toContain('28443')
  })

  it('子路径页面与本体是同一个应用，点 8099 拿到带路径的域名地址', () => {
    const blog = sliceBetween(html, '<h3>blog.example.com</h3>', '</section>')
    expect(blog).toContain('2 个后端端口')
    expect(blog).toContain('aria-label="blog.example.com 的端口"')
    const swapped = sliceBetween(
      render({ snapshot: PROXIED, selectedPorts: { 'domain:blog.example.com': 8099 } }),
      '<h3>blog.example.com</h3>',
      '</section>'
    )
    expect(swapped).toContain('<code>https://blog.example.com/stats/</code>')
  })

  it('域名入口的判断依据写清「哪个域名反代到哪个端口」', () => {
    expect(html).toContain('反向代理入口：blog.example.com → 127.0.0.1:30001')
  })

  it('落不到本机的域名收在折叠区，并说清是哪种成因', () => {
    expect(html).toContain('域名 2 个 · 上游不在这台机器上')
    expect(html).toContain('上游 10.99.0.2:30400 不在本机')
    expect(html).toContain('静态解析不出端口')
  })

  it('连锁文案带上域名，且域名数说的是「落在本机」的那部分', () => {
    expect(html).toContain('aria-label="5 监听记录 → 5 服务 → 5 入口 → 4 应用（6 个域名）"')
    expect(html).toContain('识别出 6 个域名，其中 4 个落在本机服务上')
  })

  it('反过来：没有域名的那份快照里一个域名痕迹都不该有', () => {
    const plain = render()
    expect(plain).not.toContain('services-kind-domain')
    expect(plain).not.toContain('绕过 nginx')
    expect(plain).not.toContain('个域名')
  })
})
