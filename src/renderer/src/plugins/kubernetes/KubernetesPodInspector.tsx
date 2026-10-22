import { useCallback, useEffect, useRef, useState } from 'react'
import type { KubernetesTarget, KubernetesPodMetrics, KubernetesLogs } from '@shared/kubernetes'

interface Props { target: KubernetesTarget; initialPod: string; initialTab: 'metrics' | 'logs'; active: boolean; onClose(): void }

export default function KubernetesPodInspector({ target, initialPod, initialTab, active, onClose }: Props): React.JSX.Element {
  const [pod, setPod] = useState(initialPod)
  const [tab, setTab] = useState<'metrics' | 'logs'>(initialTab)
  const [container, setContainer] = useState(target.pods.find((item) => item.name === initialPod)?.containers[0] ?? '')
  const [tailLines, setTailLines] = useState(300)
  const [sinceSeconds, setSinceSeconds] = useState(3600)
  const [previous, setPrevious] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [metrics, setMetrics] = useState<KubernetesPodMetrics | null>(null)
  const [logs, setLogs] = useState<KubernetesLogs | null>(null)
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  const containers = target.pods.find((item) => item.name === pod)?.containers ?? []

  useEffect(() => {
    dialogRef.current?.showModal()
    return () => { request.current++ }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const current = ++request.current
    setBusy(true); setError('')
    try {
      if (tab === 'metrics') {
        const result = await window.ssh.kubernetes.metrics(target.id, pod)
        if (request.current === current) setMetrics(result)
      } else {
        const result = await window.ssh.kubernetes.logs(target.id, pod, container, { tailLines, sinceSeconds, previous })
        if (request.current === current) setLogs(result)
      }
    } catch (error) {
      if (request.current === current) {
        setMetrics(null); setLogs(null); setAutoRefresh(false)
        setError(error instanceof Error ? error.message : '查询失败')
      }
    } finally { if (request.current === current) setBusy(false) }
  }, [tab, target.id, pod, container, tailLines, sinceSeconds, previous])

  useEffect(() => {
    request.current++
    setMetrics(null); setLogs(null); setError(''); setBusy(false)
    if (active && (tab === 'metrics' || container)) void refresh()
    return () => { request.current++ }
  }, [refresh, active, container, tab])

  useEffect(() => {
    if (!autoRefresh || !active) return
    const timer = setInterval(() => {
      if (!busy && document.visibilityState === 'visible') void refresh()
    }, 10000)
    return () => clearInterval(timer)
  }, [autoRefresh, active, busy, refresh])

  const visibleLog = logs?.text.split('\n').filter((line) => !keyword || line.toLowerCase().includes(keyword.toLowerCase())).join('\n') ?? ''
  return <dialog ref={dialogRef} className="kubernetes-inspector" aria-label="Pod 监控与日志" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header><div><span className="kubernetes-inspector-eyebrow">POD 详情 · {target.namespace}</span><h3>{target.service}</h3></div><button className="btn btn-sm" onClick={onClose} autoFocus>关闭详情</button></header>
    <div className="kubernetes-inspector-workspace">
      <aside className="kubernetes-pod-navigation" aria-label="选择 Pod"><h4>Pods <span>{target.pods.length}</span></h4>{target.pods.map((item) => <button key={item.name} aria-pressed={pod === item.name} onClick={() => {
        setPod(item.name); setContainer(item.containers[0] ?? '')
      }}><strong>{item.name}</strong><span><i className={`kubernetes-health ${item.ready ? 'is-ready' : item.phase === 'Failed' ? 'is-error' : 'is-pending'}`} />{item.phase} · {item.ready ? '就绪' : '未就绪'}</span></button>)}</aside>
      <div className="kubernetes-inspector-content">
        <div className="kubernetes-selected-pod"><span>当前 Pod</span><strong>{pod}</strong></div>
    <div className="kubernetes-inspector-controls">
      <div className="kubernetes-filters" aria-label="详情内容"><button aria-pressed={tab === 'metrics'} onClick={() => setTab('metrics')}>资源监控</button><button aria-pressed={tab === 'logs'} onClick={() => setTab('logs')}>容器日志</button></div>
    </div>
    {tab === 'logs' && <div className="kubernetes-log-controls">
      <label>容器<select className="kubernetes-input" value={container} onChange={(event) => setContainer(event.target.value)}>{containers.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>时间范围<select className="kubernetes-input" value={sinceSeconds} onChange={(event) => setSinceSeconds(Number(event.target.value))}><option value={300}>最近 5 分钟</option><option value={3600}>最近 1 小时</option><option value={86400}>最近 24 小时</option></select></label>
      <label>行数<select className="kubernetes-input" value={tailLines} onChange={(event) => setTailLines(Number(event.target.value))}>{[100, 300, 1000].map((value) => <option key={value} value={value}>最近 {value} 行</option>)}</select></label>
      <label className="kubernetes-checkbox"><input type="checkbox" checked={previous} onChange={(event) => setPrevious(event.target.checked)} />上一次容器实例</label>
    </div>}
    <div className="kubernetes-inspector-actions">
      <button className="btn btn-primary btn-sm" disabled={busy || !active || (tab === 'logs' && !container)} onClick={() => void refresh()}>{busy ? '加载中…' : '刷新'}</button>
      <label className="kubernetes-checkbox"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />每 10 秒刷新</label>
      {tab === 'logs' && <input type="search" aria-label="筛选日志" className="kubernetes-input" placeholder="筛选已加载日志" value={keyword} onChange={(event) => setKeyword(event.target.value)} />}
    </div>
    {busy && <p className="kubernetes-muted" role="status">正在加载{tab === 'metrics' ? '资源用量' : '容器日志'}…</p>}
    {error && <div><p className="kubernetes-error" role="alert">{error}</p><p className="kubernetes-muted">{tab === 'metrics' ? '需要 Metrics Server 和 metrics.k8s.io 的 Pod 读取权限。' : '需要 pods/log 读取权限；上一次实例仅在容器重启后可用。'}</p></div>}
    {tab === 'metrics' ? metrics ? <>
      <div className="kubernetes-metric-summary"><div><span>CPU 用量</span><strong>{metrics.containers.reduce((sum, item) => sum + item.cpuMillicores, 0).toFixed(1)} <small>mCPU</small></strong></div><div><span>内存用量</span><strong>{(metrics.containers.reduce((sum, item) => sum + item.memoryBytes, 0) / 1048576).toFixed(1)} <small>MiB</small></strong></div><div><span>采样时间</span><strong>{new Date(metrics.timestamp).toLocaleTimeString()}</strong><span>采样窗口 {metrics.window}</span></div></div>
      <div className="kubernetes-metric-containers">{metrics.containers.map((item) => <div key={item.name}><strong>{item.name}</strong><code>{item.cpuMillicores.toFixed(1)} mCPU</code><code>{(item.memoryBytes / 1048576).toFixed(1)} MiB</code></div>)}</div>
    </> : !error && !busy && <p className="kubernetes-muted">暂无资源用量。可刷新重试。</p> : logs ? <>
      <pre className="kubernetes-log-output" aria-label="容器日志内容">{visibleLog || (logs.text ? '没有匹配的日志' : '该时间范围内暂无日志')}</pre>
      <p className="kubernetes-muted">最多 256 KiB；{logs.possiblyTruncated ? '已达到大小上限，可缩小时间范围继续查询。' : '仅展示本次查询快照。'}</p>
    </> : !error && !busy && <p className="kubernetes-muted">选择容器与时间范围后查询日志。仅在本机显示，不保存到磁盘。</p>}
    </div></div>
  </dialog>
}
