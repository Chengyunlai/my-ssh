import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, InstalledPlugin, MarketRegistry, StorageInfo } from '@shared/types'
import { loadPluginStates, savePluginState, type PluginStates } from '../plugins'
import type { MySshPlugin } from '../plugins/types'
import { formatSize } from '../utils/format'

interface Props {
  plugins: MySshPlugin[]
  pluginStates: PluginStates
  onToggle: (id: string, enabled: boolean) => void
  onPluginsChanged: () => Promise<void>
  onBack: () => void
}

type SettingsTab = 'plugins' | 'market' | 'storage' | 'about'

const MARKET_URL_KEY = 'myssh:market-url'

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

  const [marketUrl, setMarketUrl] = useState(() => localStorage.getItem(MARKET_URL_KEY) ?? '')
  const [registry, setRegistry] = useState<MarketRegistry | null>(null)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const refreshStorage = useCallback(async (): Promise<void> => {
    setStorage(await window.ssh.storageScan(plugins.map((p) => p.id)))
  }, [plugins])

  const refreshInstalled = useCallback(async (): Promise<void> => {
    setInstalled(await window.ssh.marketListInstalled())
  }, [])

  useEffect(() => {
    void window.ssh.appInfo().then(setAppInfo).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'storage') void refreshStorage()
  }, [tab, refreshStorage])

  useEffect(() => {
    if (tab === 'market') void refreshInstalled()
  }, [tab, refreshInstalled])

  const loadMarket = async (): Promise<void> => {
    const url = marketUrl.trim()
    if (!url) {
      setTip('请先填写市场清单地址(registry.json)')
      return
    }
    setLoadingMarket(true)
    try {
      setRegistry(await window.ssh.marketFetchRegistry(url))
      localStorage.setItem(MARKET_URL_KEY, url)
      setTip(`市场加载成功:共 ${(await window.ssh.marketFetchRegistry(url)).plugins.length} 个插件`)
      await refreshInstalled()
    } catch (err) {
      setTip(`加载市场失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingMarket(false)
    }
  }

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
        <button className="btn btn-ghost" onClick={onBack}>
          ← 返回
        </button>
        <h2>设置</h2>
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
          <ul className="plugin-list">
            {plugins.map((p) => {
              const enabled = pluginStates[p.id] ?? p.defaultEnabled ?? true
              const psize = storage?.plugins[p.id] ?? 0
              return (
                <li key={p.id} className={`plugin-item${enabled ? ' enabled' : ''}`}>
                  <div className="plugin-info">
                    <div className="plugin-name">
                      {p.name}
                      {p.builtin && <span className="badge badge-builtin">内置</span>}
                      {p.panel && (
                        <span className="badge">{p.panel.scope === 'app' ? '全局' : '会话'}</span>
                      )}
                      {p.widget && <span className="badge">终端栏</span>}
                      <span className="plugin-version">v{p.version}</span>
                    </div>
                    <div className="plugin-desc">{p.description}</div>
                    <div className="plugin-meta">
                      {p.author ? `作者:${p.author} · ` : ''}id: {p.id}
                      {storage ? ` · 磁盘占用:${formatSize(psize)}` : ''}
                    </div>
                    <div className="plugin-actions">
                      {!p.builtin && (
                        <button className="btn btn-xs" onClick={() => void uninstallPlugin(p.id)}>
                          卸载
                        </button>
                      )}
                      {psize > 0 && (
                        <button
                          className="btn btn-xs"
                          disabled={cleaningPlugin === p.id}
                          onClick={() => void cleanPlugin(p.id)}
                        >
                          {cleaningPlugin === p.id ? '清理中…' : '清理缓存'}
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onToggle(p.id, e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </li>
              )
            })}
          </ul>
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
            <ul className="market-list">
              {registry.plugins.map((p) => {
                const iv = installed.find((i) => i.id === p.id)
                const isInstalling = installing === p.id
                const isLatest = iv !== undefined && iv.version === p.version
                return (
                  <li className="market-item" key={p.id}>
                    <div className="market-info">
                      <div className="plugin-name">
                        {p.name}
                        <span className="plugin-version">v{p.version}</span>
                        {iv && <span className="badge badge-builtin">已安装 {iv.version}</span>}
                      </div>
                      <div className="plugin-desc">{p.description}</div>
                      <div className="plugin-meta">
                        id: {p.id}
                        {p.author ? ` · 作者:${p.author}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm"
                      disabled={isInstalling}
                      onClick={() => void installPlugin(p.id)}
                    >
                      {isInstalling ? '安装中…' : iv ? (isLatest ? '重新安装' : '更新') : '安装'}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="storage-loading">填写市场清单地址后点击「加载市场」</div>
          )}
        </section>
      )}

      {tab === 'storage' && (
        <section className="settings-section">
          <div className="storage-actions">
            <button className="btn btn-sm" onClick={() => void refreshStorage()}>
              刷新
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

      {tab === 'about' && (
        <section className="settings-section">
          <div className="about-logo">MySSH</div>
          <h3>{appInfo?.name ?? 'MySSH'}</h3>
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
