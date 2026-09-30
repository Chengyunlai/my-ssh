import {
  buildApplicationViews,
  buildOverview,
  buildSystemSocketViews,
  scanBoundaries,
  systemSocketReason,
  type ApplicationView,
  type EntranceView,
  type EntranceEndpoint
} from '@shared/entrance'
import type { ServiceScanError, ServiceScanSnapshot } from '@shared/types'
import { RefreshIcon } from '../../components/icons'

/**
 * 服务入口面板的展示层：只吃 props，不读会话、不发请求。
 *
 * 拆这一层的理由是「必须能被断言」。上一个版本的同类界面里，
 * 把「有没有渲染」交给截图判断，结果两个静态按钮没有处理函数、
 * 一个折叠属性被 CSS 覆盖，都是肉眼才发现的。这一层可以用静态渲染来锁。
 */
export interface ServicesViewProps {
  snapshot: ServiceScanSnapshot | null
  error: ServiceScanError | null
  scanning: boolean
  /** 扫描时间的人话写法，由容器按当前时刻算好传进来 */
  scannedLabel: string
  endpoint: EntranceEndpoint
  /** 每个应用当前选中的入口端口 */
  selectedPorts: Record<string, number>
  /** 一次性提示（复制成功 / 已交给浏览器）。挂在 .services-panel 内部才有定位上下文 */
  toast: string | null
  onRescan: () => void
  onSelectPort: (appId: string, port: number) => void
  onCopy: (text: string, what: string) => void
  onOpen: (url: string) => void
}

export default function ServicesView({
  snapshot,
  error,
  scanning,
  scannedLabel,
  endpoint,
  selectedPorts,
  toast,
  onRescan,
  onSelectPort,
  onCopy,
  onOpen
}: ServicesViewProps): React.JSX.Element {
  const overview = snapshot ? buildOverview(snapshot.counts) : null
  const views = snapshot ? buildApplicationViews(snapshot, endpoint) : []

  return (
    <div className="services-panel">
      <header className="services-head">
        <div className="services-head-main">
          <span className="panel-kicker">SERVICE ENTRIES</span>
          <h2>
            服务入口
            {snapshot && <span className="services-head-time">· {scannedLabel}</span>}
          </h2>
        </div>
        <button className="btn btn-sm" onClick={onRescan} disabled={scanning}>
          <RefreshIcon size={13} />
          {scanning ? '扫描中…' : '重新扫描'}
        </button>
      </header>

      <div className="services-body">
        {scanning && !snapshot && !error && (
          <p className="services-hint">正在通过当前 SSH 会话读取监听端口…</p>
        )}

        {error && <ScanErrorView error={error} onRetry={onRescan} />}

        {snapshot && overview && (
          <>
            <section className="services-chain">
              <div className="services-chain-steps" aria-label={overview.chainText}>
                {(
                  [
                    ['监听记录', overview.sockets],
                    ['服务', overview.services],
                    ['入口', overview.accessible],
                    ['应用', overview.applications]
                  ] as const
                ).map(([label, value], index) => (
                  <div className="services-chain-step" key={label}>
                    {index > 0 && <span className="services-chain-arrow">→</span>}
                    <div className="services-chain-cell">
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="services-chain-note">
                {overview.systemSockets > 0 &&
                  `${overview.services} 个服务里有 ${overview.systemSockets} 个是系统自带的后台套接字（DNS 存根、DHCP、NTP），它们不是入口，已单独收在下面。`}
                {snapshot.proxy.domains > 0 &&
                  ` 识别出 ${snapshot.proxy.domains} 个域名，其中 ${snapshot.proxy.linked} 个落在本机服务上，已用作应用名与默认入口 —— 走域名不需要隧道。`}
                {snapshot.proxy.external.length > 0 &&
                  ` 另外 ${snapshot.proxy.external.length} 条路由的上游不在这台机器上，单独收在下面。`}
                {snapshot.os && ` 远端系统：${snapshot.os.prettyName}。`}
              </p>
            </section>

            {views.length === 0 ? (
              <p className="services-hint">这台机器上没有发现可访问的服务。</p>
            ) : (
              <div className="services-cards">
                {views.map((view) => (
                  <ApplicationCard
                    key={view.app.id}
                    view={view}
                    selected={
                      view.entrances.find((e) => e.service.port === selectedPorts[view.app.id]) ??
                      view.primary
                    }
                    onSelect={(port) => onSelectPort(view.app.id, port)}
                    onCopy={onCopy}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}

            <SystemSockets snapshot={snapshot} />
            <ExternalDomains snapshot={snapshot} />
            <Boundaries snapshot={snapshot} />
          </>
        )}
      </div>

      {toast && <div className="services-toast">{toast}</div>}
    </div>
  )
}

function ScanErrorView({ error, onRetry }: { error: ServiceScanError; onRetry: () => void }): React.JSX.Element {
  const hint: Record<ServiceScanError['code'], string> = {
    'session-not-found': 'SSH 会话已断开，重新连接后再试。',
    'not-ready': '会话还在建立中，稍等片刻再试。',
    unsupported: '远端既没有 ss 也读不到 /proc/net/tcp —— 这不是故障，是这台机器没有可读的端口清单。',
    timeout: '远端读取超时。机器负载高或网络抖动时会这样，重试通常就好。',
    'output-limit': '远端端口清单超过大小上限，可能是容器数量异常，也可能是某份 nginx 配置特别大。',
    'rate-limited': '扫描过于频繁，几秒后再试。',
    busy: '上一次扫描还没结束。',
    'remote-error': '远端命令返回了错误，详情见下。',
    'parse-error': '远端输出与解析规则不匹配，可能是系统版本差异。'
  }
  return (
    <div className="services-error">
      <strong>没能读到端口清单</strong>
      <p>{error.message}</p>
      <p className="services-error-hint">{hint[error.code]}</p>
      <button className="btn btn-sm" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}

function ApplicationCard({
  view,
  selected,
  onSelect,
  onCopy,
  onOpen
}: {
  view: ApplicationView
  selected: EntranceView
  onSelect: (port: number) => void
  onCopy: (text: string, what: string) => void
  onOpen: (url: string) => void
}): React.JSX.Element {
  return (
    <section className="services-card">
      <div className="services-card-head">
        <div className="services-card-title">
          <h3>{view.title}</h3>
          <span className={`services-kind services-kind-${view.app.kind}`}>{view.kindLabel}</span>
        </div>
        <span className="services-card-count">
          {view.app.kind === 'domain' ? `${view.chips.length} 个后端端口` : `${view.chips.length} 个端口`}
        </span>
      </div>
      <p className="services-card-detail" title={view.detail}>
        {view.detail}
      </p>

      {view.chips.length > 1 && (
        <div className="services-chips" role="tablist" aria-label={`${view.title} 的端口`}>
          {view.chips.map((chip) => (
            <button
              key={`${chip.port}/${chip.protocol}`}
              role="tab"
              aria-selected={chip.port === selected.service.port}
              className={`services-chip${chip.port === selected.service.port ? ' on' : ''}${
                chip.needsTunnel && !chip.hasDomain ? ' tunnel' : ''
              }`}
              title={
                chip.hasDomain
                  ? '已配置域名入口，点开走域名'
                  : chip.needsTunnel
                    ? '只对本机监听，需要先建隧道'
                    : '可直接访问'
              }
              onClick={() => onSelect(chip.port)}
            >
              {chip.port}
              {chip.port === view.primary.service.port && <span className="services-chip-star">默认</span>}
            </button>
          ))}
        </div>
      )}

      <EntranceRow entrance={selected} onCopy={onCopy} onOpen={onOpen} />
    </section>
  )
}

function EntranceRow({
  entrance,
  onCopy,
  onOpen
}: {
  entrance: EntranceView
  onCopy: (text: string, what: string) => void
  onOpen: (url: string) => void
}): React.JSX.Element {
  const conflict = entrance.localPortConflicts.length > 0
  const domain = entrance.domain
  return (
    <div className="services-entrance">
      <div className="services-entrance-address">
        {domain && <span className="services-tag domain">域名</span>}
        <code>{entrance.address}</code>
        {/* 有域名时不打「需隧道」：走域名本来就不需要，标上去反而是在教人绕远路 */}
        {!domain && (
          <span className={`services-tag${entrance.needsTunnel ? ' tunnel' : ' direct'}`}>
            {entrance.needsTunnel ? '需隧道' : '可直连'}
          </span>
        )}
        {entrance.protocol === 'unknown' && <span className="services-tag unknown">协议待确认</span>}
      </div>

      <div className="services-entrance-actions">
        {entrance.action === 'open' && entrance.openUrl && (
          <button className="btn btn-primary btn-sm" onClick={() => onOpen(entrance.openUrl!)}>
            打开
          </button>
        )}
        {entrance.action === 'choose' &&
          entrance.schemeChoices.map((choice) => (
            <button
              key={choice}
              className="btn btn-sm"
              title="协议看不出来，按你选的来，不替你猜"
              onClick={() => onOpen(choice)}
            >
              用 {choice.startsWith('https') ? 'https' : 'http'}
            </button>
          ))}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onCopy(entrance.openUrl ?? entrance.address, ' 地址')}
        >
          复制地址
        </button>
      </div>

      <p className="services-entrance-reason">{entrance.protocolReason}</p>

      {entrance.sshCommand && (
        <div className="services-tunnel">
          <div className="services-tunnel-line">
            <span className="services-tunnel-label">命令</span>
            <code>{entrance.sshCommand}</code>
          </div>
          <div className="services-tunnel-foot">
            <button className="btn btn-xs" onClick={() => onCopy(entrance.sshCommand!, ' SSH 命令')}>
              复制 SSH 命令
            </button>
            <span>在任意终端的本机命令行里执行，走的就是这个账号和端口。</span>
          </div>
        </div>
      )}

      {/* 有域名时把「直连端口」整块收进折叠区：它是备选，不是入口。
          不能收掉 —— 域名解析坏了、证书过期了，这个地址仍然通。 */}
      {domain && (entrance.directAddress || entrance.tunnelCommand) && (
        <details className="services-alt">
          <summary>绕过 nginx 直接访问这个端口</summary>
          {entrance.directAddress && (
            <div className="services-tunnel-line">
              <span className="services-tunnel-label">地址</span>
              <code>{entrance.directAddress}</code>
            </div>
          )}
          {entrance.tunnelCommand && (
            <>
              <div className="services-tunnel-line">
                <span className="services-tunnel-label">隧道</span>
                <code>{entrance.tunnelCommand}</code>
              </div>
              <div className="services-tunnel-foot">
                <button className="btn btn-xs" onClick={() => onCopy(entrance.tunnelCommand!, '隧道命令')}>
                  复制隧道命令
                </button>
                <span>这个端口只对本机监听，要先建隧道才能从本机连上 —— 走上面的域名不用。</span>
              </div>
            </>
          )}
        </details>
      )}

      {!domain && entrance.needsTunnel && (
        <div className="services-tunnel">
          <div className="services-tunnel-line">
            <span className="services-tunnel-label">隧道</span>
            <code>{entrance.tunnelCommand}</code>
          </div>
          <div className="services-tunnel-foot">
            <button className="btn btn-xs" onClick={() => onCopy(entrance.tunnelCommand!, '隧道命令')}>
              复制隧道命令
            </button>
            <span>在终端里执行后，上面的地址才会通 —— 本面板不会替你建隧道。</span>
          </div>
          {conflict && (
            <p className="services-tunnel-conflict">
              本地端口 {entrance.localAddress} 与 {entrance.localPortConflicts.join('、')}{' '}
              推导结果相同。不自动改端口，请在命令里手工换一个 —— 换了才不会每次重扫都变。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 认出域名、但上游不在本机监听的那些。
 *
 * 单独列出来而不是丢掉：这类域名的 `proxy_pass` 指向集群里的 Pod / NodePort 地址，
 * 而不是本机端口，它对这个面板「该给什么入口」没有用，但它**存在**这件事有用 ——
 * 不列出来，界面上就像这台机器少了一个域名。
 */
function ExternalDomains({ snapshot }: { snapshot: ServiceScanSnapshot }): React.JSX.Element | null {
  const { external } = snapshot.proxy
  if (external.length === 0) return null
  return (
    <details className="services-fold">
      <summary>域名 {external.length} 个 · 上游不在这台机器上</summary>
      <ul className="services-fold-list">
        {external.map((item) => (
          <li key={item.host}>
            <code>
              {item.host}
              {item.match === '/' ? '' : item.match}
            </code>
            <span>
              {item.reason}
              {item.routes > 1 && `（这个域名下还有 ${item.routes - 1} 条同样的路由）`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function SystemSockets({ snapshot }: { snapshot: ServiceScanSnapshot }): React.JSX.Element | null {
  const chips = buildSystemSocketViews(snapshot)
  if (chips.length === 0) return null
  return (
    <details className="services-fold">
      <summary>系统后台套接字 {chips.length} 个 · 已从入口里隔离</summary>
      <ul className="services-fold-list">
        {chips.map((chip) => (
          <li key={chip.label}>
            <code>{chip.label}</code>
            <span>{systemSocketReason(snapshot, chip.port)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Boundaries({ snapshot }: { snapshot: ServiceScanSnapshot }): React.JSX.Element {
  const lines = scanBoundaries(snapshot)
  return (
    <details className="services-fold services-fold-boundaries">
      <summary>这次扫描做了什么、没做什么</summary>
      <ul className="services-fold-list">
        {lines.map((line) => (
          <li key={line}>
            <span>{line}</span>
          </li>
        ))}
        {snapshot.warnings.map((w) => (
          <li key={w} className="services-fold-warn">
            <code>!</code>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
