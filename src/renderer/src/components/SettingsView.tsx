import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppInfo,
  InstalledPlugin,
  LogInfo,
  MarketRegistry,
  StorageInfo,
  UpdateState
} from '@shared/types'
import { isVersionSupported } from '@shared/versions'
import type { PluginPlatform } from '@shared/types'
import { loadPluginStates, savePluginState, type PluginStates } from '../plugins'
import type { MySshPlugin } from '../plugins/types'
import { formatSize } from '../utils/format'
import { ArrowBackIcon, CloseIcon, OfficialIcon, RefreshIcon, SearchIcon } from './icons'
import mysshIcon from '../assets/myssh-icon-tile.png'

interface Props {
  plugins: MySshPlugin[]
  pluginStates: PluginStates
  onToggle: (id: string, enabled: boolean) => void
  onPluginsChanged: () => Promise<void>
  onBack: () => void
}

type SettingsTab = 'plugins' | 'market' | 'storage' | 'logs' | 'about'

const MARKET_URL_KEY = 'myssh:market-url'
/** 官方默认市场(GitHub Pages 自动部署),用户可改为自建市场地址 */
const DEFAULT_MARKET_URL = 'https://chengyunlai.github.io/my-ssh-plug/registry.json'

/** 官方分类表(与 docs/PLUGIN.md §5 保持一致) */
const CATEGORY_ORDER = ['terminal', 'files', 'tool', 'monitor', 'integration', 'other'] as const
const CATEGORY_LABELS: Record<string, string> = {
  terminal: '终端增强',
  files: '文件传输',
  tool: '效率工具',
  monitor: '监控运维',
  integration: '服务集成',
  other: '其他'
}

function supportText(min?: string, max?: string): string {
  if (min && max) return `兼容 MySSH ${min} ~ ${max}`
  if (min) return `需要 MySSH ${min}+`
  if (max) return `最高支持 MySSH ${max}`
  return ''
}

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p
}

/** 平台要求文本;全平台(未声明)返回空 */
function platformsText(platforms?: string[]): string {
  if (!platforms?.length) return ''
  return `仅支持 ${platforms.map(platformLabel).join(' / ')}`
}

export default function SettingsView({
  plugins,
  pluginStates,
  onToggle,
  onPluginsChanged,
  onBack
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('plugins')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleaningPlugin, setCleaningPlugin] = useState<string | null>(null)
  const [tip, setTip] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [logs, setLogs] = useState<LogInfo | null>(null)
  const [logCopied, setLogCopied] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)

  const [marketUrl, setMarketUrl] = useState(
    () => localStorage.getItem(MARKET_URL_KEY) ?? DEFAULT_MARKET_URL
  )
  const [registry, setRegistry] = useState<MarketRegistry | null>(null)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const marketAutoLoadedRef = useRef(false)

  const q = search.trim().toLowerCase()
  const matchPlugin = (name: string, id: string, desc: string): boolean =>
    !q ||
    name.toLowerCase().includes(q) ||
    id.toLowerCase().includes(q) ||
    desc.toLowerCase().includes(q)
  const filteredPlugins = plugins.filter((p) => matchPlugin(p.name, p.id, p.description))
  const filteredMarket =
    registry?.plugins.filter(
      (p) =>
        matchPlugin(p.name, p.id, p.description) &&
        (!categoryFilter || p.category === categoryFilter)
    ) ?? []
  const appVersion = appInfo?.version ?? ''
  const platform = window.ssh.platform
  const isCompatible = (min?: string, max?: string): boolean =>
    !appVersion || isVersionSupported(appVersion, { min, max })

  const refreshStorage = useCallback(async (): Promise<void> => {
    setStorage(await window.ssh.storageScan(plugins.map((p) => p.id)))
  }, [plugins])

  const refreshInstalled = useCallback(async (): Promise<void> => {
    setInstalled(await window.ssh.marketListInstalled())
  }, [])

  useEffect(() => {
    void window.ssh.appInfo().then(setAppInfo).catch(() => {})
  }, [])

  // 订阅应用更新状态:启动时已静默检查过的结果会立即回传
  useEffect(() => {
    return window.ssh.onUpdateState(setUpdate)
  }, [])

  useEffect(() => {
    if (tab === 'storage') void refreshStorage()
  }, [tab, refreshStorage])

  const refreshLogs = useCallback(async (): Promise<void> => {
    setLogs(await window.ssh.logRead())
  }, [])

  useEffect(() => {
    if (tab === 'logs') void refreshLogs()
  }, [tab, refreshLogs])

  const copyLog = async (): Promise<void> => {
    if (!logs?.content) return
    window.ssh.copyText(logs.content)
    setLogCopied(true)
    window.setTimeout(() => setLogCopied(false), 1500)
  }

  const checkUpdate = async (): Promise<void> => {
    setUpdate(await window.ssh.checkUpdate())
  }

  const downloadUpdate = async (): Promise<void> => {
    setUpdate(await window.ssh.downloadUpdate())
  }

  const clearLog = async (): Promise<void> => {
    if (!window.confirm('清空全部日志?')) return
    await window.ssh.logClear()
    await refreshLogs()
  }

  const loadMarket = useCallback(async (): Promise<void> => {
    const url = marketUrl.trim()
    if (!url) {
      setTip('请先填写市场清单地址(registry.json)')
      return
    }
    setLoadingMarket(true)
    try {
      const reg = await window.ssh.marketFetchRegistry(url)
      setRegistry(reg)
      localStorage.setItem(MARKET_URL_KEY, url)
      setTip(`市场加载成功:共 ${reg.plugins.length} 个插件`)
      await refreshInstalled()
    } catch (err) {
      setTip(`加载市场失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingMarket(false)
    }
  }, [marketUrl, refreshInstalled])

  useEffect(() => {
    if (tab !== 'market') return
    void refreshInstalled()
    // 首次打开「插件市场」自动加载默认/上次使用的市场
    if (!marketAutoLoadedRef.current && marketUrl.trim()) {
      marketAutoLoadedRef.current = true
      void loadMarket()
    }
  }, [tab, refreshInstalled, loadMarket, marketUrl])

  const installPlugin = async (id: string): Promise<void> => {
    const url = marketUrl.trim()
    if (!url) {
      setTip('请先填写市场清单地址')
      return
    }
    setInstalling(id)
    try {
      const info = await window.ssh.marketInstall(url, id)
      if (loadPluginStates()[id] === undefined) savePluginState(id, info.defaultEnabled ?? true)
      setTip(`已安装 ${info.name}@${info.version}`)
      await refreshInstalled()
      await onPluginsChanged()
      await refreshStorage()
    } catch (err) {
      setTip(`安装失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstalling(null)
    }
  }

  const uninstallPlugin = async (id: string): Promise<void> => {
    const p = plugins.find((x) => x.id === id)
    if (!window.confirm(`卸载插件「${p?.name ?? id}」?将禁用并删除其本地数据。`)) return
    onToggle(id, false)
    try {
      await window.ssh.storageCleanPlugin(id)
      await refreshInstalled()
      await onPluginsChanged()
      await refreshStorage()
      setTip(`已卸载 ${p?.name ?? id}`)
    } catch (err) {
      setTip(`卸载失败:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const cleanCache = async (): Promise<void> => {
    if (
      !window.confirm(
        '清理 Chromium 缓存(Cache / GPUCache 等)?应用运行时会自动重建,不影响配置与数据。'
      )
    )
      return
    setCleaning(true)
    try {
      const { freed } = await window.ssh.storageCleanCache()
      setTip(`已清理 ${formatSize(freed)}`)
      await refreshStorage()
    } catch (err) {
      setTip(`清理失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCleaning(false)
    }
  }

  const cleanPlugin = async (id: string): Promise<void> => {
    const p = plugins.find((x) => x.id === id)
    if (!window.confirm(`清理插件「${p?.name ?? id}」的本地数据(缓存 / 临时文件)?`)) return
    setCleaningPlugin(id)
    try {
      const { freed } = await window.ssh.storageCleanPlugin(id)
      setTip(`已清理 ${formatSize(freed)}`)
      await refreshStorage()
    } catch (err) {
      setTip(`清理失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCleaningPlugin(null)
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>设置</h2>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowBackIcon size={14} /> 返回
        </button>
      </div>

      <nav className="tabs settings-tabs">
        <button
          className={`tab${tab === 'plugins' ? ' active' : ''}`}
          onClick={() => setTab('plugins')}
        >
          插件
        </button>
        <button
          className={`tab${tab === 'market' ? ' active' : ''}`}
          onClick={() => setTab('market')}
        >
          插件市场
        </button>
        <button
          className={`tab${tab === 'storage' ? ' active' : ''}`}
          onClick={() => setTab('storage')}
        >
          存储
        </button>
        <button
          className={`tab${tab === 'logs' ? ' active' : ''}`}
          onClick={() => setTab('logs')}
        >
          日志
        </button>
        <button
          className={`tab${tab === 'about' ? ' active' : ''}`}
          onClick={() => setTab('about')}
        >
          关于
        </button>
      </nav>

      {tab === 'plugins' && (
        <section className="settings-section">
          <p className="settings-tip">
            开关用于启用 / 禁用插件;非内置插件可「卸载」(删除本地数据)。内置插件随应用分发,只能禁用。外部插件请到「插件市场」安装。
          </p>
          <div className="plugin-search">
            <SearchIcon size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索插件名称 / 描述 / id"
              spellCheck={false}
            />
            {search && (
              <button className="plugin-search-clear" onClick={() => setSearch('')}>
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <div className="settings-table plugin-table">
            <div className="settings-table-head">
              <span>插件名称</span>
              <span>版本</span>
              <span>功能介绍</span>
              <span>功能操作</span>
              <span>卸载</span>
              <span>启用</span>
            </div>
            {filteredPlugins.map((p) => {
              const enabled = pluginStates[p.id] ?? p.defaultEnabled ?? true
              const psize = storage?.plugins[p.id] ?? 0
              return (
                <div className="settings-table-row" key={p.id}>
                  <div className="plugin-table-name">
                    <span className="plugin-name-inline">
                      {p.name}
                      {p.official && (
                        <span className="badge badge-official">
                          <OfficialIcon size={11} /> 官方
                        </span>
                      )}
                      {p.builtin && <span className="badge badge-builtin">内置</span>}
                      {p.panel && (
                        <span className="badge">{p.panel.scope === 'app' ? '全局' : '会话'}</span>
                      )}
                      {p.widget && <span className="badge">终端栏</span>}
                    </span>
                    <span className="plugin-table-meta">
                      {p.author ? `作者:${p.author} · ` : ''}id: {p.id}
                      {storage ? ` · 占用 ${formatSize(psize)}` : ''}
                      {supportText(p.minAppVersion, p.maxAppVersion) &&
                        ` · ${supportText(p.minAppVersion, p.maxAppVersion)}`}
                      {platformsText(p.platforms) && ` · ${platformsText(p.platforms)}`}
                    </span>
                  </div>
                  <span className="plugin-table-version">v{p.version}</span>
                  <span className="plugin-table-desc">{p.description}</span>
                  <div className="plugin-table-ops">
                    {psize > 0 ? (
                      <button
                        className="btn btn-xs"
                        disabled={cleaningPlugin === p.id}
                        onClick={() => void cleanPlugin(p.id)}
                      >
                        {cleaningPlugin === p.id ? '清理中…' : '清理缓存'}
                      </button>
                    ) : (
                      <span className="table-empty">—</span>
                    )}
                  </div>
                  <div className="plugin-table-ops">
                    {!p.builtin ? (
                      <button className="btn btn-xs btn-danger" onClick={() => void uninstallPlugin(p.id)}>
                        卸载
                      </button>
                    ) : (
                      <span className="table-empty">内置</span>
                    )}
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onToggle(p.id, e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              )
            })}
          </div>
          {filteredPlugins.length === 0 && (
            <div className="storage-loading">未找到匹配的插件</div>
          )}
        </section>
      )}

      {tab === 'market' && (
        <section className="settings-section">
          <p className="settings-tip">
            市场清单是 my-ssh-plug 仓库构建产物的 registry.json,支持 https:// 与本地 file:// 地址。
          </p>
          <div className="market-bar">
            <input
              className="market-url"
              value={marketUrl}
              onChange={(e) => setMarketUrl(e.target.value)}
              placeholder="https://example.com/my-ssh-plug/dist/registry.json"
              spellCheck={false}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={loadingMarket}
              onClick={() => void loadMarket()}
            >
              {loadingMarket ? '加载中…' : '加载市场'}
            </button>
          </div>
          {tip && <p className="settings-tip">{tip}</p>}
          {registry ? (
            <>
              <div className="plugin-toolbar">
                <div className="plugin-search">
                  <SearchIcon size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索市场插件名称 / 描述 / id"
                    spellCheck={false}
                  />
                  {search && (
                    <button className="plugin-search-clear" onClick={() => setSearch('')}>
                      <CloseIcon size={12} />
                    </button>
                  )}
                </div>
                <select
                  className="plugin-filter"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">全部分类</option>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-table market-table">
                <div className="settings-table-head">
                  <span>插件名称</span>
                  <span>版本</span>
                  <span>功能介绍</span>
                  <span>操作</span>
                </div>
                {filteredMarket.map((p) => {
                  const iv = installed.find((i) => i.id === p.id)
                  const isInstalling = installing === p.id
                  const isLatest = iv !== undefined && iv.version === p.version
                  const compatible = isCompatible(p.minAppVersion, p.maxAppVersion)
                  const platText = platformsText(p.platforms)
                  // 环境检测:声明了平台且不含当前平台时禁止安装
                  const platformOk =
                    !p.platforms?.length || p.platforms.includes(platform as PluginPlatform)
                  const installable = compatible && platformOk
                  const blockedTitle = !compatible
                    ? `当前 MySSH ${appVersion},不满足插件版本要求:${supportText(p.minAppVersion, p.maxAppVersion)}`
                    : !platformOk
                      ? `此插件 ${platText},当前系统为 ${platformLabel(platform)},不满足环境要求`
                      : undefined
                  return (
                    <div className="settings-table-row" key={p.id}>
                      <div className="plugin-table-name">
                        <span className="plugin-name-inline">
                          {p.name}
                          {p.official && (
                            <span className="badge badge-official">
                              <OfficialIcon size={11} /> 官方
                            </span>
                          )}
                          {iv && <span className="badge badge-builtin">已安装 {iv.version}</span>}
                        </span>
                        <span className="plugin-table-meta">
                          {p.author ? `作者:${p.author} · ` : ''}id: {p.id}
                          {supportText(p.minAppVersion, p.maxAppVersion) &&
                            ` · ${supportText(p.minAppVersion, p.maxAppVersion)}`}
                          {platText && ` · ${platText}`}
                        </span>
                      </div>
                      <span className="plugin-table-version">v{p.version}</span>
                      <span className="plugin-table-desc">{p.description}</span>
                      <button
                        className="btn btn-sm"
                        disabled={isInstalling || !installable}
                        title={blockedTitle}
                        onClick={() => void installPlugin(p.id)}
                      >
                        {isInstalling ? '安装中…' : iv ? (isLatest ? '重新安装' : '更新') : '安装'}
                      </button>
                    </div>
                  )
                })}
              </div>
              {filteredMarket.length === 0 && <div className="storage-loading">未找到匹配的插件</div>}
            </>
          ) : (
            <div className="storage-loading">填写市场清单地址后点击「加载市场」</div>
          )}
        </section>
      )}

      {tab === 'storage' && (
        <section className="settings-section">
          <div className="storage-actions">
            <button className="btn btn-sm" onClick={() => void refreshStorage()}>
              <RefreshIcon size={14} /> 刷新
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={cleaning}
              onClick={() => void cleanCache()}
            >
              {cleaning ? '清理中…' : '清理缓存'}
            </button>
          </div>
          {tip && <p className="settings-tip">{tip}</p>}
          {storage ? (
            <div className="storage-grid">
              <div className="storage-card">
                <span className="storage-label">总占用</span>
                <span className="storage-value">{formatSize(storage.total)}</span>
              </div>
              <div className="storage-card">
                <span className="storage-label">缓存(Cache / GPUCache 等)</span>
                <span className="storage-value">{formatSize(storage.cache)}</span>
              </div>
              <div className="storage-card">
                <span className="storage-label">连接配置</span>
                <span className="storage-value">{formatSize(storage.profiles)}</span>
              </div>
              {plugins
                .filter((p) => (storage.plugins[p.id] ?? 0) > 0)
                .map((p) => (
                  <div className="storage-card" key={p.id}>
                    <span className="storage-label">插件:{p.name}</span>
                    <span className="storage-value">{formatSize(storage.plugins[p.id] ?? 0)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="storage-loading">正在计算磁盘占用…</div>
          )}
          {appInfo && (
            <p className="settings-tip" title={appInfo.userData}>
              数据目录:{appInfo.userData}
            </p>
          )}
        </section>
      )}

      {tab === 'logs' && (
        <section className="settings-section">
          <p className="settings-tip">
            日志记录运行中的错误(连接失败、插件异常等),超过 {logs ? (logs.max / 1024).toFixed(0) : '1024'} KB
            自动滚动覆盖,只保留最新内容。
          </p>
          <div className="log-actions">
            <button className="btn btn-sm" onClick={() => void refreshLogs()}>
              <RefreshIcon size={14} /> 刷新
            </button>
            <button className="btn btn-sm" disabled={!logs?.content} onClick={() => void copyLog()}>
              {logCopied ? '已复制' : '复制日志'}
            </button>
            <button className="btn btn-sm btn-danger" disabled={!logs?.content} onClick={() => void clearLog()}>
              清空日志
            </button>
            {logs && (
              <span className="log-meta">
                {formatSize(logs.size)} / {formatSize(logs.max)}
              </span>
            )}
          </div>
          {logs?.content ? (
            <pre className="log-view">{logs.content}</pre>
          ) : (
            <div className="storage-loading">暂无日志</div>
          )}
        </section>
      )}

      {tab === 'about' && (
        <section className="settings-section">
          <img className="about-logo" src={mysshIcon} alt="MySSH logo" />
          <h3>{appInfo?.name ?? 'MySSH'}</h3>
          <div className="about-update">
            <div className="about-update-row">
              <span className="about-update-label">应用更新</span>
              <button
                className="btn btn-sm"
                disabled={update?.status === 'checking' || update?.status === 'downloading'}
                onClick={() => void checkUpdate()}
              >
                {update?.status === 'checking' ? '检查中…' : '检查更新'}
              </button>
            </div>
            {update && update.status !== 'disabled' && (
              <div className={`about-update-status update-${update.status}`}>
                {update.status === 'available' && (
                  <>
                    <span>
                      发现新版本 v{update.version}(当前 v{update.currentVersion})
                    </span>
                    <button className="btn btn-sm btn-primary" onClick={() => void downloadUpdate()}>
                      下载
                    </button>
                  </>
                )}
                {update.status === 'downloading' && (
                  <>
                    <div className="update-bar">
                      <div className="update-bar-inner" style={{ width: `${update.percent ?? 0}%` }} />
                    </div>
                    <span>
                      正在下载 v{update.version} {update.percent ?? 0}%
                    </span>
                  </>
                )}
                {update.status === 'downloaded' && (
                  <>
                    <span>v{update.version} 已下载,重启后生效</span>
                    <button className="btn btn-sm btn-primary" onClick={() => window.ssh.installUpdate()}>
                      重启安装
                    </button>
                  </>
                )}
                {update.status === 'current' && <span>已是最新版本</span>}
                {update.status === 'error' && (
                  <span className="update-error">检查更新失败:{update.error ?? '未知错误'}</span>
                )}
              </div>
            )}
            {update?.status === 'disabled' && (
              <div className="about-update-status">
                <span>{update.error ?? '当前环境不支持应用内更新'}</span>
              </div>
            )}
          </div>
          <dl className="about-list">
            <div>
              <dt>版本</dt>
              <dd>v{appInfo?.version ?? '…'}</dd>
            </div>
            <div>
              <dt>Electron</dt>
              <dd>{appInfo?.electron ?? '…'}</dd>
            </div>
            <div>
              <dt>Chromium</dt>
              <dd>{appInfo?.chrome ?? '…'}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{appInfo?.node ?? '…'}</dd>
            </div>
            <div>
              <dt>数据目录</dt>
              <dd>{appInfo?.userData ?? '…'}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  )
}
