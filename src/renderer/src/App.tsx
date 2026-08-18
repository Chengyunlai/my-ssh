import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import type { Profile, SessionStatus } from '@shared/types'
import ProfileForm from './components/ProfileForm'
import SettingsView from './components/SettingsView'
import TerminalView from './components/TerminalView'
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

function renderPanel(p: MySshPlugin, session: ActiveSession | null): React.JSX.Element | null {
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
    profile: session.profile
  })
}

export default function App(): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [editing, setEditing] = useState<Profile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('terminal')
  const [pluginStates, setPluginStates] = useState<PluginStates>(() => loadPluginStates())
  const [allPlugins, setAllPlugins] = useState<MySshPlugin[]>(builtinPlugins)
  const sessionRef = useRef<ActiveSession | null>(null)
  const lastProfileRef = useRef<Profile | null>(null)

  const enabledPlugins = allPlugins.filter((p) => pluginStates[p.id] ?? p.defaultEnabled ?? true)

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

  const connect = useCallback(async (profile: Profile) => {
    if (sessionRef.current) window.ssh.disconnect(sessionRef.current.sessionId)
    lastProfileRef.current = profile
    setSelectedId(profile.id)
    setError(null)
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo">MySSH</span>
          <button className="btn btn-primary btn-sm" onClick={handleNew}>
            + 新建
          </button>
        </div>
        <ul className="profile-list">
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                className={`profile-item${p.id === selectedId ? ' selected' : ''}`}
                title={`${p.username}@${p.host}:${p.port}`}
                onClick={() => void connect(p)}
              >
                <span className="profile-name">{p.name}</span>
                <span className="profile-detail">
                  {p.username}@{p.host}:{p.port}
                </span>
              </button>
              <div className="profile-actions">
                <button className="btn btn-ghost btn-xs" onClick={() => handleEdit(p)}>
                  编辑
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => void handleDelete(p.id)}>
                  删除
                </button>
              </div>
            </li>
          ))}
          {profiles.length === 0 && <li className="empty-tip">还没有服务器,点「新建」添加</li>}
        </ul>
        <div className="sidebar-footer">
          <button
            className={`btn btn-ghost sidebar-settings${view === 'settings' ? ' active' : ''}`}
            onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
          >
            ⚙ 设置
          </button>
        </div>
      </aside>

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
              {session && (
                <div className="session-bar">
                  <span className="session-title">
                    {session.profile.name} — {session.profile.username}@{session.profile.host}
                  </span>
                  <span className={`status status-${status?.status ?? 'connecting'}`}>
                    {status
                      ? `${STATUS_TEXT[status.status]}${status.message ? `: ${status.message}` : ''}`
                      : ''}
                  </span>
                </div>
              )}
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
                      {p.panel && renderPanel(p, session)}
                    </div>
                  ))}
              {enabledPlugins
                .filter((p) => p.panel && p.panel.scope === 'app' && activeTab === p.id)
                .map((p) => (
                  <div className="tab-pane" key={p.id}>
                    {renderPanel(p, session)}
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
                      <h2>连接你的服务器</h2>
                      <p>选择左侧的服务器,或点「新建」配置账号密码 / PEM 私钥</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
