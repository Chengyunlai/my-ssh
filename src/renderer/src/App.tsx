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

/** 一个会话标签:独立终端 + 面板页签,切换时保持挂载不丢缓冲 */
interface SessionTab {
  sessionId: string
  profile: Profile
  /** 面板页签:'terminal' 或会话级插件 id */
  panelTab: string
}

const STATUS_TEXT: Record<SessionStatus['status'], string> = {
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败'
}


function liveIn(map: Record<string, SessionStatus>, sessionId: string): boolean {
  const st = map[sessionId]?.status
  return st === 'connecting' || st === 'connected'
}

function renderPanel(
  p: MySshPlugin,
  session: SessionTab | null,
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
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [statusMap, setStatusMap] = useState<Record<string, SessionStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /** app 级插件面板:独立于会话,挂在会话标签栏右侧 */
  const [appPanelActive, setAppPanelActive] = useState<string | null>(null)
  const [pluginStates, setPluginStates] = useState<PluginStates>(() => loadPluginStates())
  const [allPlugins, setAllPlugins] = useState<MySshPlugin[]>(builtinPlugins)
  // 连接覆盖层:connecting(logo 装配循环) -> settling(连接完成,收尾定格) -> leaving(淡出) -> null
  const [connectOverlay, setConnectOverlay] = useState<'connecting' | 'settling' | 'leaving' | null>(null)
  const [overlaySessionId, setOverlaySessionId] = useState<string | null>(null)
  const [connectProgress, setConnectProgress] = useState(0)
  const smoothProgress = useSmoothProgress(connectProgress, !!connectOverlay)
  const sessionsRef = useRef<SessionTab[]>([])
  const statusMapRef = useRef<Record<string, SessionStatus>>({})
  const activeSessionIdRef = useRef<string | null>(null)
  const overlaySessionIdRef = useRef<string | null>(null)
  const lastProfileRef = useRef<Profile | null>(null)

  const enabledPlugins = allPlugins.filter((p) => pluginStates[p.id] ?? p.defaultEnabled ?? true)
  const appScopePlugins = enabledPlugins.filter((p) => p.panel?.scope === 'app')

  /** 异步回调里判定会话存活:读 ref 拿调用时刻的最新值 */
  const isLive = useCallback(
    (sessionId: string): boolean => {
      const st = statusMapRef.current[sessionId]?.status
      return st === 'connecting' || st === 'connected'
    },
    []
  )

  const activeSession =
    sessions.find((s) => s.sessionId === activeSessionId) ?? null
  const activeStatus = activeSession ? statusMap[activeSession.sessionId] : undefined
  const activeIndex = sessions.findIndex((s) => s.sessionId === activeSessionId)

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
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    statusMapRef.current = statusMap
  }, [statusMap])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    overlaySessionIdRef.current = overlaySessionId
  }, [overlaySessionId])

  // 活动会话切换时,侧边栏选中态跟随其服务器
  useEffect(() => {
    setSelectedId(activeSession?.profile.id ?? null)
  }, [activeSessionId, sessions])

  const refresh = useCallback(async () => {
    setProfiles(await window.ssh.listProfiles())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const sid = activeSessionId
    const st = sid ? statusMap[sid] : undefined
    if (st?.status === 'connecting') {
      setOverlaySessionId(sid)
      setConnectOverlay('connecting')
    } else if (connectOverlay === 'connecting' && overlaySessionId === activeSessionId && st?.status === 'connected') {
      // 连接完成:动效收尾(装配定格 + 磁贴浮现)后进入,时长与连接节奏绑定
      setConnectOverlay('settling')
    } else if (
      connectOverlay &&
      overlaySessionId === activeSessionId &&
      (st?.status === 'disconnected' || st?.status === 'error')
    ) {
      setConnectOverlay(null)
      setOverlaySessionId(null)
    }
  }, [activeSessionId, statusMap, connectOverlay, overlaySessionId])

  useEffect(() => {
    if (connectOverlay === 'settling') {
      const t = window.setTimeout(() => setConnectOverlay('leaving'), 430)
      return () => window.clearTimeout(t)
    }
    if (connectOverlay === 'leaving') {
      const t = window.setTimeout(() => {
        setConnectOverlay(null)
        setOverlaySessionId(null)
      }, 220)
      return () => window.clearTimeout(t)
    }
  }, [connectOverlay])

  useEffect(() => {
    return window.ssh.onStatus((s) => {
      setStatusMap((m) => ({ ...m, [s.sessionId]: s }))
    })
  }, [])

  // 连接阶段进度:主进程按 TCP / 握手 / 认证 / 会话 阶段上报
  useEffect(() => {
    return window.ssh.onProgress((p) => {
      if (p.sessionId === undefined || p.sessionId === overlaySessionIdRef.current) {
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

  const activateSession = useCallback((sessionId: string): void => {
    setActiveSessionId(sessionId)
    setAppPanelActive(null)
  }, [])

  const connect = useCallback(
    async (profile: Profile) => {
      lastProfileRef.current = profile
      setSelectedId(profile.id)
      // 从编辑/新建表单直接点列表连接时,退出编辑态,避免表单挡住会话视图
      setShowForm(false)
      setEditing(null)
      setError(null)
      // 同一服务器已有存活会话:直接切换过去,不重复建连
      const existing = sessionsRef.current.find(
        (t) => t.profile.id === profile.id && isLive(t.sessionId)
      )
      if (existing) {
        activateSession(existing.sessionId)
        return
      }
      setConnectProgress(0)
      try {
        const { sessionId } = await window.ssh.connect(profile)
        setStatusMap((m) => ({ ...m, [sessionId]: { sessionId, status: 'connecting' } }))
        // 重连场景:替换同一服务器的失效标签
        const deadIds = sessionsRef.current
          .filter((t) => t.profile.id === profile.id && !isLive(t.sessionId))
          .map((t) => t.sessionId)
        setSessions((list) => [
          ...list.filter((t) => !deadIds.includes(t.sessionId)),
          { sessionId, profile, panelTab: 'terminal' }
        ])
        setStatusMap((m) => {
          const next = { ...m }
          for (const id of deadIds) delete next[id]
          return next
        })
        activateSession(sessionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [activateSession, isLive]
  )

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

  const closeSession = useCallback(
    (tab: SessionTab): void => {
      const live = isLive(tab.sessionId)
      if (live && !window.confirm(`断开并关闭「${tab.profile.name}」?`)) return
      if (live) window.ssh.disconnect(tab.sessionId)
      const list = sessionsRef.current
      const idx = list.findIndex((t) => t.sessionId === tab.sessionId)
      const next = list.filter((t) => t.sessionId !== tab.sessionId)
      setSessions(next)
      setStatusMap((m) => {
        const n = { ...m }
        delete n[tab.sessionId]
        return n
      })
      if (activeSessionIdRef.current === tab.sessionId) {
        const neighbor = next[Math.min(idx, next.length - 1)]
        setActiveSessionId(neighbor ? neighbor.sessionId : null)
      }
      if (overlaySessionIdRef.current === tab.sessionId) {
        setConnectOverlay(null)
        setOverlaySessionId(null)
      }
    },
    [isLive]
  )

  const handleDelete = async (id: string): Promise<void> => {
    const profile = profiles.find((p) => p.id === id)
    const name = profile?.name ?? id
    if (!window.confirm(`删除服务器「${name}」?将移除其连接配置。`)) return
    const related = sessionsRef.current.filter((t) => t.profile.id === id)
    for (const t of related) {
      if (isLive(t.sessionId)) window.ssh.disconnect(t.sessionId)
    }
    const remaining = sessionsRef.current.filter((t) => t.profile.id !== id)
    setSessions(remaining)
    setStatusMap((m) => {
      const n = { ...m }
      for (const t of related) delete n[t.sessionId]
      return n
    })
    if (related.some((t) => t.sessionId === activeSessionIdRef.current)) {
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null)
    }
    if (related.some((t) => t.sessionId === overlaySessionIdRef.current)) {
      setConnectOverlay(null)
      setOverlaySessionId(null)
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
    if (!enabled) {
      // 被禁用的插件不再有面板:相关页签全部回落到终端
      setSessions((list) => list.map((t) => (t.panelTab === id ? { ...t, panelTab: 'terminal' } : t)))
      setAppPanelActive((cur) => (cur === id ? null : cur))
    }
  }

  const connectedProfileIds = new Set(
    sessions.filter((t) => liveIn(statusMap, t.sessionId)).map((t) => t.profile.id)
  )

  const sessionLabel = activeSession
    ? `${activeSession.profile.name} — ${activeSession.profile.username}@${activeSession.profile.host}`
    : '未连接'

  const statusText = activeStatus
    ? `${STATUS_TEXT[activeStatus.status]}${activeStatus.message ? `: ${activeStatus.message}` : ''}`
    : '未连接'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <img className="topbar-logo" src={mysshIcon} alt="" aria-hidden="true" />
          <span className="topbar-title">MySSH</span>
          {activeSession && <span className="topbar-session">{activeSession.profile.name}</span>}
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
                    <span className={`profile-dot${connectedProfileIds.has(p.id) ? ' on' : ''}`} />
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
                {(sessions.length > 0 || appScopePlugins.length > 0) && (
                  <div className="session-strip">
                {sessions.map((tab) => {
                  const st = statusMap[tab.sessionId]?.status ?? 'connecting'
                  const dead = !liveIn(statusMap, tab.sessionId)
                      return (
                        <div
                          key={tab.sessionId}
                          className={`session-tab${tab.sessionId === activeSessionId ? ' active' : ''}${dead ? ' dead' : ''}`}
                          title={`${tab.profile.username}@${tab.profile.host}:${tab.profile.port}`}
                          onClick={() => activateSession(tab.sessionId)}
                        >
                          <span className={`session-tab-dot status-${st}`} />
                          <span className="session-tab-name">{tab.profile.name}</span>
                          <button
                            className="session-tab-close"
                            title="关闭会话"
                            aria-label="关闭会话"
                            onClick={(e) => {
                              e.stopPropagation()
                              closeSession(tab)
                            }}
                          >
                            <CloseIcon size={11} />
                          </button>
                        </div>
                      )
                    })}
                    {appScopePlugins.map((p) => (
                      <button
                        key={p.id}
                        className={`session-tab app-panel${appPanelActive === p.id ? ' active' : ''}`}
                        onClick={() => setAppPanelActive(appPanelActive === p.id ? null : p.id)}
                      >
                        {p.panel!.title}
                      </button>
                    ))}
                  </div>
                )}

                {sessions.map((tab) => {
                  const isActive = tab.sessionId === activeSessionId && !appPanelActive
                  const live = liveIn(statusMap, tab.sessionId)
                  const st = statusMap[tab.sessionId]
                  return (
                    <div
                      key={tab.sessionId}
                      className={`session-view${isActive ? '' : ' hidden'}`}
                    >
                      {live && (
                        <div className="tabs">
                          <button
                            className={`tab${tab.panelTab === 'terminal' ? ' active' : ''}`}
                            onClick={() =>
                              setSessions((list) =>
                                list.map((t) =>
                                  t.sessionId === tab.sessionId ? { ...t, panelTab: 'terminal' } : t
                                )
                              )
                            }
                          >
                            终端
                          </button>
                          {enabledPlugins
                            .filter((p) => p.panel && (p.panel.scope ?? 'session') === 'session')
                            .map((p) => (
                              <button
                                key={p.id}
                                className={`tab${tab.panelTab === p.id ? ' active' : ''}`}
                                onClick={() =>
                                  setSessions((list) =>
                                    list.map((t) =>
                                      t.sessionId === tab.sessionId ? { ...t, panelTab: p.id } : t
                                    )
                                  )
                                }
                              >
                                {p.panel!.title}
                              </button>
                            ))}
                        </div>
                      )}

                      {live && (
                        <div className={`tab-pane${tab.panelTab === 'terminal' ? '' : ' hidden'}`}>
                          <TerminalView sessionId={tab.sessionId} />
                        </div>
                      )}
                      {live &&
                        tab.panelTab === 'terminal' &&
                        enabledPlugins
                          .filter((p) => p.widget && p.widget.placement === 'terminal-bottom')
                          .map((p) => (
                            <div className="terminal-bar" key={p.id}>
                              {p.widget &&
                                createElement(p.widget.Component as ComponentType<SessionPanelProps>, {
                                  sessionId: tab.sessionId,
                                  profile: tab.profile
                                })}
                            </div>
                          ))}
                      {live &&
                        enabledPlugins
                          .filter((p) => p.panel && (p.panel.scope ?? 'session') === 'session')
                          .map((p) => (
                            <div
                              className={`tab-pane${tab.panelTab === p.id ? '' : ' hidden'}`}
                              key={p.id}
                            >
                              {p.panel && renderPanel(p, tab, isActive && tab.panelTab === p.id)}
                            </div>
                          ))}

                      {!live && (
                        <div className={st?.status === 'error' ? 'error-state' : 'empty-state'}>
                          <h2>{st?.status === 'error' ? '连接失败' : '连接已断开'}</h2>
                          {st?.message && <p className="error-message">{st.message}</p>}
                          <button className="btn btn-primary" onClick={() => void connect(tab.profile)}>
                            重新连接
                          </button>
                        </div>
                      )}

                      {tab.sessionId === overlaySessionId && connectOverlay && (
                        <div className={`connect-overlay${connectOverlay === 'leaving' ? ' closing' : ''}`}>
                          <div
                            className={`connect-logo-stage${connectOverlay === 'settling' ? ' done' : ''}`}
                            aria-hidden="true"
                          >
                            <GooeyLogoIcon size={96} />
                            <img className="connect-logo-tile" src={mysshIcon} alt="" />
                          </div>
                          <p className="connect-label">正在连接 {tab.profile.host}…</p>
                          <div className="connect-progress">
                            <div className="connect-progress-inner" style={{ width: `${smoothProgress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {enabledPlugins
                  .filter((p) => p.panel && p.panel.scope === 'app' && appPanelActive === p.id)
                  .map((p) => (
                    <div className="tab-pane" key={p.id}>
                      {renderPanel(p, activeSession, true)}
                    </div>
                  ))}

                {sessions.length === 0 && !appPanelActive && (
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
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span className="statusbar-left">
          {sessionLabel}
          {sessions.length > 1 && activeIndex >= 0 && ` (${activeIndex + 1}/${sessions.length})`}
        </span>
        <span className={`statusbar-right status-${activeStatus?.status ?? 'idle'}`}>
          {activeStatus?.status === 'connected' ? (
            <CheckIcon size={12} />
          ) : activeStatus?.status === 'connecting' ? (
            <span className="status-spinner" />
          ) : activeStatus?.status === 'error' ? (
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
