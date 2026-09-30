import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatScannedAt, type EntranceEndpoint } from '@shared/entrance'
import type { Profile, ServiceScanError, ServiceScanSnapshot } from '@shared/types'
import ServicesView from './ServicesView'

interface Props {
  sessionId: string
  profile: Profile
  /** 是否为当前可见标签；首次可见时才扫，避免切标签的瞬间做 SSH 往返 */
  active?: boolean
}

/**
 * 服务入口面板。
 *
 * 这一层只做三件事：拿数据、存 UI 状态、把结果交给展示层。
 * 所有「怎么收敛、给什么地址、点哪个按钮」的判断都在 shared/entrance.ts 里，
 * 那里可以用断言锁住；展示层可以用静态渲染锁住。这里是唯一没法单测的部分，
 * 所以刻意写得薄。
 *
 * 明确不做的事也刻意写在界面上：不探测连通性、不猜未知协议、不替用户静默改隧道端口。
 */
export default function ServicesPanel({ sessionId, profile, active }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ServiceScanSnapshot | null>(null)
  const [error, setError] = useState<ServiceScanError | null>(null)
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  /** 每个应用当前选中的端口：一个容器对外开 5 个口，卡片不该变成 5 张 */
  const [selectedPorts, setSelectedPorts] = useState<Record<string, number>>({})
  const requestedRef = useRef(false)

  const run = useCallback(async (): Promise<void> => {
    setScanning(true)
    setError(null)
    try {
      const result = await window.ssh.serviceScan.run(sessionId)
      if (result.ok) {
        setSnapshot(result.snapshot)
        setSelectedPorts({})
      } else {
        setError(result.error)
        // 失败时不保留上一份快照：留着会让人以为看到的是当前状态
        setSnapshot(null)
      }
    } catch (err) {
      setError({ code: 'remote-error', message: err instanceof Error ? err.message : '端口发现失败' })
      setSnapshot(null)
    } finally {
      setScanning(false)
      setTick(Date.now())
    }
  }, [sessionId])

  useEffect(() => {
    if (!active || requestedRef.current) return
    requestedRef.current = true
    void run()
  }, [active, run])

  // 相对时间要自己走：不然「刚刚」会一直停在刚打开的那一刻
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const endpoint: EntranceEndpoint = useMemo(
    () => ({
      host: profile.host,
      sshPort: profile.port,
      username: profile.username,
      keyPath: profile.authType === 'key' ? profile.keyPath : undefined
    }),
    [profile]
  )

  const copy = useCallback((text: string, what: string): void => {
    window.ssh.copyText(text)
    setToast(`已复制${what}`)
  }, [])

  const open = useCallback(async (url: string): Promise<void> => {
    const ok = await window.ssh.openExternal(url)
    setToast(ok ? `已交给系统浏览器：${url}` : '这个地址不能交给浏览器打开')
  }, [])

  return (
    <ServicesView
      snapshot={snapshot}
      error={error}
      scanning={scanning}
      scannedLabel={snapshot ? formatScannedAt(snapshot.scannedAt, tick) : ''}
      endpoint={endpoint}
      selectedPorts={selectedPorts}
      toast={toast}
      onRescan={() => void run()}
      onSelectPort={(appId, port) => setSelectedPorts((m) => ({ ...m, [appId]: port }))}
      onCopy={copy}
      onOpen={(url) => void open(url)}
    />
  )
}
