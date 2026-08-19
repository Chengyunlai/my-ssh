import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import type { Profile, SessionStatus } from '@shared/types'
import ProfileForm from './components/ProfileForm'
import {
  AddIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  GooeyLogoIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon
} from './components/icons'
import SettingsView from './components/SettingsView'
import TerminalView from './components/TerminalView'
import mysshIcon from './assets/myssh-icon-tile.png'
import { useSmoothProgress } from './hooks/useSmoothProgress'
import {
  builtinPlugins,
  loadPluginStates,
  refreshExternalPlugins,
  savePluginState,
  type PluginStates
} from './plugins'
import type { AppPanelProps, MySshPlugin, SessionPanelProps } from './plugins/types'

interface ActiveSession {
  sessionId: string
  profile: Profile
}

const STATUS_TEXT: Record<SessionStatus['status'], string> = {
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败'
}


function renderPanel(
  p: MySshPlugin,
  session: ActiveSession | null,
  active: boolean
): React.JSX.Element | null {
  if (!p.panel) return null
  if (p.panel.scope === 'app') {
    return createElement(p.panel.Component as ComponentType<AppPanelProps>)
  }
  if (!session) {
    return (
      <div className="empty-state">
        <h2>请先连接服务器</h2>
        <p>「{p.name}」需要已建立的 SSH 会话</p>
      </div>
    )
  }
  return createElement(p.panel.Component as ComponentType<SessionPanelProps>, {
    sessionId: session.sessionId,
    profile: session.profile,
    active
  })
}

export default function App(): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Profile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState('terminal')
  const [pluginStates, setPluginStates] = useState<PluginStates>(() => loadPluginStates())
  const [allPlugins, setAllPlugins] = useState<MySshPlugin[]>(builtinPlugins)
  // 连接覆盖层:connecting(logo 装配循环) -> settling(连接完成,收尾定格) -> leaving(淡出) -> null
  const [connectOverlay, setConnectOverlay] = useState<'connecting' | 'settling' | 'leaving' | null>(null)
  const [connectProgress, setConnectProgress] = useState(0)
  const smoothProgress = useSmoothProgress(connectProgress, !!connectOverlay)
  const sessionRef = useRef<ActiveSession | null>(null)
  const lastProfileRef = useRef<Profile | null>(null)

  const enabledPlugins = allPlugins.filter((p) => pluginStates[p.id] ?? p.defaultEnabled ?? true)

  const filteredProfiles = profiles.filter((p) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      p.host.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q)
    )
  })

  const reloadPlugins = useCallback(async (): Promise<void> => {
    setAllPlugins(await refreshExternalPlugins())
  }, [])

  useEffect(() => {
    void reloadPlugins()
  }, [reloadPlugins])

  useEffect(() => {
    setActiveTab('terminal')
  }, [session?.sessionId])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    const p = allPlugins.find((x) => x.panel && x.id === activeTab)
    if (p?.panel?.scope === 'session' && !session) setActiveTab('terminal')
  }, [session, activeTab, allPlugins])

  const refresh = useCallback(async () => {
    setProfiles(await window.ssh.listProfiles())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (status?.status === 'connecting') {
      setConnectOverlay('connecting')
    } else if (connectOverlay === 'connecting' && status?.status === 'connected') {
      // 连接完成:动效收尾(装配定格 + 磁贴浮现)后进入,时长与连接节奏绑定
      setConnectOverlay('settling')
    } else if (connectOverlay && status?.status !== 'connected') {
      setConnectOverlay(null)
    }
  }, [status, connectOverlay])

  useEffect(() => {
    if (connectOverlay === 'settling') {
      const t = window.setTimeout(() => setConnectOverlay('leaving'), 430)
      return () => window.clearTimeout(t)
    }
    if (connectOverlay === 'leaving') {
      const t = window.setTimeout(() => setConnectOverlay(null), 220)
      return () => window.clearTimeout(t)
    }
  }, [connectOverlay])

  useEffect(() => {
    return window.ssh.onStatus((s) => {
      setStatus(s)
      if (s.status === 'disconnected' || s.status === 'error') {
        setSession((cur) => (cur && cur.sessionId === s.sessionId ? null : cur))
        if (s.status === 'error') setError(s.message || '连接失败')
      } else {
        setError(null)
      }
    })
  }, [])

  // 连接阶段进度:主进程按 TCP / 握手 / 认证 / 会话 阶段上报
  useEffect(() => {
    return window.ssh.onProgress((p) => {
      if (p.sessionId === undefined || p.sessionId === sessionRef.current?.sessionId) {
        setConnectProgress(p.percent)
      }
    })
  }, [])

  // 全局阻止拖放默认行为:避免文件拖到窗口任意位置时被浏览器直接打开/导航
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const connect = useCallback(async (profile: Profile) => {
    if (sessionRef.current) window.ssh.disconnect(sessionRef.current.sessionId)
    lastProfileRef.current = profile
    setSelectedId(profile.id)
    // 从编辑/新建表单直接点列表连接时,退出编辑态,避免表单挡住会话视图
    setShowForm(false)
    setEditing(null)
    setError(null)
    setConnectProgress(0)
    try {
      const { sessionId } = await window.ssh.connect(profile)
      setStatus({ sessionId, status: 'connecting' })
      setSession({ sessionId, profile })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
    }
  }, [])

  const handleSaveAndConnect = useCallback(
    async (profile: Profile) => {
      const saved = await window.ssh.saveProfile(profile)
      await refresh()
      setShowForm(false)
      setEditing(null)
      await connect(saved)
    },
    [connect, refresh]
  )

  const handleEdit = (profile: Profile): void => {
    setEditing(profile)
    setShowForm(true)
  }

  const handleDelete = async (id: string): Promise<void> => {
    const profile = profiles.find((p) => p.id === id)
    const name = profile?.name ?? id
    if (!window.confirm(`删除服务器「${name}」?将移除其连接配置。`)) return
    if (selectedId === id) setSelectedId(null)
    if (sessionRef.current?.profile.id === id) {
      window.ssh.disconnect(sessionRef.current.sessionId)
      setSession(null)
    }
    await window.ssh.deleteProfile(id)
    await refresh()
  }

  const handleNew = (): void => {
    setEditing(null)
    setShowForm(true)
  }

  const togglePlugin = (id: string, enabled: boolean): void => {
    savePluginState(id, enabled)
    setPluginStates(loadPluginStates())
    if (!enabled && activeTab === id) setActiveTab('terminal')
  }

  const showTabs = session !== null || enabledPlugins.some((p) => p.panel?.scope === 'app')

  const sessionLabel = session
    ? `${session.profile.name} — ${session.profile.username}@${session.profile.host}`
    : '未连接'

  const statusText = status
    ? `${STATUS_TEXT[status.status]}${status.message ? `: ${status.message}` : ''}`
    : '未连接'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <img className="topbar-logo" src={mysshIcon} alt="" aria-hidden="true" />
          <span className="topbar-title">MySSH</span>
          {session && <span className="topbar-session">{session.profile.name}</span>}
        </div>
        <div className="topbar-right">
          <button
            className={`icon-btn${sidebarOpen && view === 'main' ? ' active' : ''}`}
            title="侧边栏"
            aria-label="侧边栏"
            onClick={() => {
              // 设置页里侧边栏不渲染,直接点它 = 回到主视图并展开侧边栏,
              // 避免只改隐藏状态导致返回主视图时状态对不上
              if (view !== 'main') {
                setView('main')
                setSidebarOpen(true)
              } else {
                setSidebarOpen((v) => !v)
              }
            }}
          >
            <MenuIcon />
          </button>
          <button
            className={`icon-btn${view === 'settings' ? ' active' : ''}`}
            title="设置"
            aria-label="设置"
            onClick={() => setView((v) => (v === 'settings' ? 'main' : 'settings'))}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="app-body">
        {view === 'main' && sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">服务器</span>
              <span className="sidebar-count">{profiles.length}</span>
            </div>
            <div className="sidebar-search">
              <SearchIcon />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索服务器"
                spellCheck={false}
              />
            </div>
            <ul className="profile-list">
              {filteredProfiles.map((p) => (
                <li key={p.id}>
                  <button
                    className={`profile-item${p.id === selectedId ? ' selected' : ''}`}
                    title={`${p.username}@${p.host}:${p.port}`}
                    onClick={() => void connect(p)}
                  >
                    <span className={`profile-dot${p.id === selectedId ? ' on' : ''}`} />
                    <span className="profile-main">
                      <span className="profile-name">{p.name}</span>
                      <span className="profile-detail">
                        {p.username}@{p.host}:{p.port}
                      </span>
                    </span>
                  </button>
                  <div className="profile-actions">
                    <button
                      className="icon-btn sm"
                      title="编辑"
                      aria-label="编辑"
                      onClick={() => handleEdit(p)}
                    >
                      <EditIcon />
                    </button>
                    <button
                      className="icon-btn sm danger"
                      title="删除"
                      aria-label="删除"
                      onClick={() => void handleDelete(p.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ))}
              {filteredProfiles.length === 0 && (
                <li className="empty-tip">
                  {profiles.length === 0 ? '还没有服务器,点「+」添加' : '没有匹配的服务器'}
                </li>
              )}
            </ul>
            <button className="sidebar-new" onClick={handleNew}>
              <AddIcon size={16} />
              新建服务器
            </button>
          </aside>
        )}

        <main className="main">
          {view === 'settings' ? (
            <SettingsView
              plugins={allPlugins}
              pluginStates={pluginStates}
              onToggle={togglePlugin}
              onPluginsChanged={reloadPlugins}
              onBack={() => setView('main')}
            />
          ) : (
            <>
              {showForm && (
                <ProfileForm
                  initial={editing}
                  onSave={(p) => void handleSaveAndConnect(p)}
                  onCancel={() => {
                    setShowForm(false)
                    setEditing(null)
                  }}
                />
              )}
              <div className={`session-views${showForm ? ' hidden' : ''}`}>
                {showTabs && (
                  <div className="tabs">
                    {session && (
                      <button
                        className={`tab${activeTab === 'terminal' ? ' active' : ''}`}
                        onClick={() => setActiveTab('terminal')}
                      >
                        终端
                      </button>
                    )}
                    {enabledPlugins
                      .filter((p) => p.panel && (p.panel.scope === 'app' || session))
                      .map((p) => (
                        <button
                          key={p.id}
                          className={`tab${activeTab === p.id ? ' active' : ''}`}
                          onClick={() => setActiveTab(p.id)}
                        >
                          {p.panel!.title}
                        </button>
                      ))}
                  </div>
                )}

                {session && (
                  <div className={`tab-pane${activeTab === 'terminal' ? '' : ' hidden'}`}>
                    <TerminalView sessionId={session.sessionId} />
                  </div>
                )}
                {session &&
                  activeTab === 'terminal' &&
                  enabledPlugins
                    .filter((p) => p.widget && p.widget.placement === 'terminal-bottom')
                    .map((p) => (
                      <div className="terminal-bar" key={p.id}>
                        {p.widget &&
                          createElement(p.widget.Component as ComponentType<SessionPanelProps>, {
                            sessionId: session.sessionId,
                            profile: session.profile
                          })}
                      </div>
                    ))}
                {session &&
                  enabledPlugins
                    .filter((p) => p.panel && (p.panel.scope ?? 'session') === 'session')
                    .map((p) => (
                      <div className={`tab-pane${activeTab === p.id ? '' : ' hidden'}`} key={p.id}>
                        {p.panel && renderPanel(p, session, activeTab === p.id)}
                      </div>
                    ))}
                {enabledPlugins
                  .filter((p) => p.panel && p.panel.scope === 'app' && activeTab === p.id)
                  .map((p) => (
                    <div className="tab-pane" key={p.id}>
                      {renderPanel(p, session, true)}
                    </div>
                  ))}

                {!session && activeTab === 'terminal' && (
                  <>
                    {error ? (
                      <div className="error-state">
                        <h2>连接失败</h2>
                        <p className="error-message">{error}</p>
                        {lastProfileRef.current && (
                          <button
                            className="btn btn-primary"
                            onClick={() => void connect(lastProfileRef.current!)}
                          >
                            重试
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <img className="empty-state-logo" src={mysshIcon} alt="" aria-hidden="true" />
                        <h2>连接你的服务器</h2>
                        <p>在左侧选择服务器,或用侧边栏「+」配置账号密码 / PEM 私钥</p>
                      </div>
                    )}
                  </>
                )}

                {connectOverlay && session && (
                  <div className={`connect-overlay${connectOverlay === 'leaving' ? ' closing' : ''}`}>
                    <div
                      className={`connect-logo-stage${connectOverlay === 'settling' ? ' done' : ''}`}
                      aria-hidden="true"
                    >
                      <GooeyLogoIcon size={96} />
                      <img className="connect-logo-tile" src={mysshIcon} alt="" />
                    </div>
                    <p className="connect-label">正在连接 {session.profile.host}…</p>
                    <div className="connect-progress">
                      <div className="connect-progress-inner" style={{ width: `${smoothProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span className="statusbar-left">{sessionLabel}</span>
        <span className={`statusbar-right status-${status?.status ?? 'idle'}`}>
          {status?.status === 'connected' ? (
            <CheckIcon size={12} />
          ) : status?.status === 'connecting' ? (
            <span className="status-spinner" />
          ) : status?.status === 'error' ? (
            <CloseIcon size={12} />
          ) : (
            <span className="status-dot" />
          )}
          {statusText}
        </span>
      </footer>
    </div>
  )
}
