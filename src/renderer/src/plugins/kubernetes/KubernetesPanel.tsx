import { useEffect, useRef, useState } from 'react'
import type { KubernetesConfig, KubernetesSavedConfig, KubernetesTarget, KubernetesForward } from '@shared/kubernetes'
import KubernetesPodInspector from './KubernetesPodInspector'
import type { AppPanelProps } from '../types'
import './kubernetes.css'

const databaseNames = { mysql: 'MySQL', postgresql: 'PostgreSQL', redis: 'Redis', unknown: '其他服务' }

export default function KubernetesPanel({ active = true }: AppPanelProps): React.JSX.Element {
  const inspectorTrigger = useRef<HTMLButtonElement | null>(null)
  const [selectedPod, setSelectedPod] = useState<{ target: KubernetesTarget; pod: string; tab: 'metrics' | 'logs' } | null>(null)
  const [savedConfigs, setSavedConfigs] = useState<KubernetesSavedConfig[]>([])
  const [cleanup, setCleanup] = useState<'current' | 'all' | null>(null)
  const [config, setConfig] = useState<KubernetesConfig | null>(null)
  const [context, setContext] = useState('')
  const [namespace, setNamespace] = useState('')
  const [targets, setTargets] = useState<KubernetesTarget[]>([])
  const [forwards, setForwards] = useState<KubernetesForward[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [query, setQuery] = useState('')
  const [databaseOnly, setDatabaseOnly] = useState(false)

  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  const clearResults = (): void => { setTargets([]); setSearched(false); setSelectedPod(null) }
  const closeForward = async (id: string): Promise<void> => {
    await window.ssh.kubernetes.stop(id)
    setForwards(await window.ssh.kubernetes.forwards())
  }

  useEffect(() => {
    let active = true
    const update = (): void => {
      void window.ssh.kubernetes.forwards().then((items) => {
        if (active) setForwards(items)
      }).catch(() => {})
    }
    update()
    const timer = setInterval(update, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const restoreRemembered = async (): Promise<void> => {
    const state = await window.ssh.kubernetes.remembered()
    setSavedConfigs(state.configs)
    if (!state.selectedId) {
      setConfig(null); setContext(''); setNamespace(''); clearResults()
      return
    }
    const selected = await window.ssh.kubernetes.selectConfig(state.selectedId)
    setConfig(selected); setContext(selected.context); setNamespace(selected.namespace)
    clearResults()
  }

  useEffect(() => {
    let canceled = false
    setBusy(true)
    void window.ssh.kubernetes.remembered().then(async (state) => {
      if (canceled) return
      setSavedConfigs(state.configs)
      if (state.selectedId) {
        const selected = await window.ssh.kubernetes.selectConfig(state.selectedId)
        if (!canceled) { setConfig(selected); setContext(selected.context); setNamespace(selected.namespace) }
      }
    }).catch((error) => { if (!canceled) setError(error instanceof Error ? error.message : '无法恢复集群配置') })
      .finally(() => { if (!canceled) setBusy(false) })
    return () => { canceled = true }
  }, [])

  const rememberScope = (nextContext: string, nextNamespace: string): void => {
    if (!config) return
    void window.ssh.kubernetes.rememberSelection(config.id, nextContext, nextNamespace).catch((error) => setError(error instanceof Error ? error.message : '无法保存选择'))
  }

  const databases = targets.filter((target) => target.database !== 'unknown')
  const visibleTargets = targets.filter((target) => {
    if (databaseOnly && target.database === 'unknown') return false
    const text = `${target.namespace} ${target.service} ${target.port} ${target.portName} ${target.database}`.toLowerCase()
    return text.includes(query.trim().toLowerCase())
  }).sort((a, b) => Number(b.database !== 'unknown') - Number(a.database !== 'unknown') ||
    a.namespace.localeCompare(b.namespace) || a.service.localeCompare(b.service) || a.port - b.port)

  return (
    <section className="kubernetes-panel" aria-label="Kubernetes 集群">
      <header className="kubernetes-heading">
        <div>
          <h2>Kubernetes</h2>
          <p>发现集群服务，连接你的数据库。</p>
        </div>
        <span className="kubernetes-config-state">{config ? `已保存 · ${config.name}` : '尚未选择集群'}</span>
      </header>

      <form className="kubernetes-controls" onSubmit={(event) => {
        event.preventDefault()
        void act(async () => {
          clearResults()
          if (config) {
            setTargets(await window.ssh.kubernetes.discover(config.id, context, namespace))
            setSearched(true)
          }
        })
      }}>
        <div className="kubernetes-config-control">
          <span className="kubernetes-field-label">连接配置</span>
          <select className="kubernetes-input" aria-label="已保存配置" disabled={busy || !savedConfigs.length} value={config?.id ?? ''} onChange={(event) => {
            const id = event.target.value
            void act(async () => {
              const selected = await window.ssh.kubernetes.selectConfig(id)
              setConfig(selected); setContext(selected.context); setNamespace(selected.namespace)
              setCleanup(null); clearResults()
            })
          }}>
            {!config && <option value="">尚未导入配置</option>}
            {savedConfigs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <label>Context
          <select className="kubernetes-input kubernetes-context" disabled={busy || !config} value={context} onChange={(event) => {
            setContext(event.target.value); rememberScope(event.target.value, namespace); clearResults()
          }}>
            {!config && <option value="">请先导入配置</option>}
            {config?.contexts.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label>命名空间
          <input className="kubernetes-input" disabled={busy} value={namespace} placeholder="全部命名空间" onBlur={() => rememberScope(context, namespace)} onChange={(event) => {
            setNamespace(event.target.value); clearResults()
          }} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !config}>{busy ? '正在处理…' : '查看服务'}</button>
      </form>
      <div className="kubernetes-config-management">
        <span className="kubernetes-muted">配置加密保存在本机，自动记住上次选择。</span>
        <div>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act(async () => {
            const value = await window.ssh.kubernetes.importConfig()
            if (value) { setCleanup(null); await restoreRemembered() }
          })}>导入 kubeconfig</button>
          <button type="button" className="btn btn-sm" disabled={busy || !config} onClick={() => setCleanup('current')}>移除当前配置</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setCleanup('all')}>清空记录</button>
        </div>
      </div>
      {cleanup && <div className="kubernetes-cleanup-confirm" role="group" aria-label="确认清理配置">
        <span>{cleanup === 'all' ? '清空所有已保存配置？' : `移除「${config?.name}」？`}相关转发将关闭，原始文件保留。</span>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void act(async () => {
          if (cleanup === 'all') await window.ssh.kubernetes.clearConfigs()
          else if (config) await window.ssh.kubernetes.removeConfig(config.id)
          setCleanup(null)
          await restoreRemembered()
          setForwards(await window.ssh.kubernetes.forwards())
        })}>确认{cleanup === 'all' ? '清空' : '移除'}</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => setCleanup(null)}>取消</button>
      </div>}
      {error && <div className="kubernetes-error" role="alert">{error}</div>}

      {selectedPod && <KubernetesPodInspector key={`${selectedPod.target.id}/${selectedPod.pod}`} target={selectedPod.target} initialPod={selectedPod.pod} initialTab={selectedPod.tab} active={active} onClose={() => { setSelectedPod(null); requestAnimationFrame(() => inspectorTrigger.current?.focus({ preventScroll: true })) }} />}

      <div className="kubernetes-resource-bar">
        <div className="kubernetes-filters" aria-label="服务类型">
          <button type="button" aria-pressed={!databaseOnly} onClick={() => setDatabaseOnly(false)}>全部服务 <span>{new Set(targets.map((target) => `${target.namespace}/${target.service}`)).size}</span></button>
          <button type="button" aria-pressed={databaseOnly} onClick={() => setDatabaseOnly(true)}>数据库 <span>{new Set(databases.map((target) => `${target.namespace}/${target.service}`)).size}</span></button>
        </div>
        <input className="kubernetes-input kubernetes-search" type="search" aria-label="搜索服务" placeholder="搜索名称、命名空间或端口" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <div className="kubernetes-results" aria-busy={busy}>
        <table>
          <thead><tr><th>服务</th><th>类型</th><th>端口</th><th>运行状态</th><th>连接</th></tr></thead>
          <tbody>
            {visibleTargets.map((target) => {
              const tunnel = forwards.find((item) => item.targetId === target.id && item.state === 'ready')
              const ready = target.pods.filter((pod) => pod.ready).length
              const unhealthy = target.pods.some((pod) => pod.phase === 'Failed' || pod.phase === 'Unknown')
              return (
                <tr key={target.id}>
                  <td><strong className="kubernetes-service-name">{target.service}</strong><span className="kubernetes-secondary">{target.namespace}</span></td>
                  <td><span title={databaseNames[target.database]} className={`kubernetes-kind ${target.database !== 'unknown' ? 'is-database' : ''}`}>{databaseNames[target.database]}</span></td>
                  <td><code>{target.port}</code><span className="kubernetes-secondary">{target.portName || 'TCP'}</span></td>
                  <td>
                    {target.pods.length ? (
                      <div className="kubernetes-pods">
                        <span><span className={`kubernetes-health ${unhealthy ? 'is-error' : ready === target.pods.length ? 'is-ready' : 'is-pending'}`} />{ready}/{target.pods.length} 就绪</span>
                        <div className="kubernetes-observe-actions">{(['metrics', 'logs'] as const).map((tab) => <button key={tab} className="kubernetes-text-button" aria-label={`${target.service} ${tab === 'metrics' ? '监控' : '日志'}`} onClick={(event) => {
                          inspectorTrigger.current = event.currentTarget
                          setSelectedPod({ target, pod: (target.pods.find((pod) => pod.ready) ?? target.pods[0]).name, tab })
                        }}>{tab === 'metrics' ? '监控' : '日志'}</button>)}</div>
                      </div>
                    ) : <span className="kubernetes-muted">无关联 Pod</span>}
                  </td>
                  <td>{tunnel ? (
                    <div className="kubernetes-row-connection"><code>{tunnel.host}:{tunnel.port}</code><button className="btn btn-sm" disabled={busy} onClick={() => void act(() => closeForward(tunnel.id))}>断开</button></div>
                  ) : (
                    <button className="btn btn-sm kubernetes-connect" disabled={busy || !target.forwardable} title={target.forwardable ? `转发 ${target.service}:${target.port}` : '没有可转发的运行中 Pod'} onClick={() => void act(async () => {
                      await window.ssh.kubernetes.forward(target.id)
                      setForwards(await window.ssh.kubernetes.forwards())
                    })}>建立转发</button>
                  )}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visibleTargets.length && <div className="kubernetes-empty" role="status">
          <h3>{busy ? '正在读取集群资源' : !config ? '连接你的 Kubernetes 集群' : !searched ? '选择范围，查看服务' : targets.length ? '没有匹配的服务' : '此范围内暂无服务'}</h3>
          <p>{!config ? '导入 kubeconfig 后，即可查看服务与 Pod 状态。' : targets.length ? '尝试其他关键词，或切换到全部服务。' : '填写有权限的命名空间；留空将查询整个集群。'}</p>
        </div>}
      </div>

      <footer className="kubernetes-footnote"><span>{visibleTargets.length} 个服务端口</span><span>MySQL 服务可在 MySQL 管理器中连接</span></footer>
      {forwards.length > 0 && <aside className="kubernetes-tunnels" aria-label="连接通道">
        <h3>连接通道 <span>{forwards.length}</span></h3>
        {forwards.map((tunnel) => {
          const target = targets.find((item) => item.id === tunnel.targetId)
          return <div className="kubernetes-tunnel" key={tunnel.id}>
            <span className={`kubernetes-health ${tunnel.state === 'ready' ? 'is-ready' : 'is-pending'}`} />
            <strong>{target?.service ?? '集群服务'}</strong><code>{tunnel.host}:{tunnel.port}</code>
            <span className="kubernetes-muted">{tunnel.state === 'ready' ? '转发中' : tunnel.message}</span>
            <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => closeForward(tunnel.id))}>{tunnel.state === 'ready' ? '关闭通道' : '移除'}</button>
          </div>
        })}
      </aside>}
    </section>
  )
}
