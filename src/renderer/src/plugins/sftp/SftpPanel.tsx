import { useCallback, useEffect, useRef, useState } from 'react'
import type { Profile, SftpEntry } from '@shared/types'
import FileViewer from './FileViewer'

interface Props {
  sessionId: string
  profile: Profile
}

interface TransferItem {
  id: string
  name: string
  type: 'download' | 'upload'
  done: number
  total: number
  speed: number
  status: 'running' | 'done' | 'error'
  error?: string
}

interface ViewerTarget {
  name: string
  path: string
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function parentOf(dir: string): string {
  if (dir === '/' || !dir) return '/'
  const idx = dir.lastIndexOf('/')
  return idx <= 0 ? '/' : dir.slice(0, idx)
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatSpeed(bps: number): string {
  return `${formatSize(bps)}/s`
}

function formatTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** OSC 7 目录需要 shell 启动后才到达,短时间轮询等待,取不到再回退 home */
async function waitForCwd(sessionId: string, timeoutMs = 2500): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cwd = await window.ssh.getCwd(sessionId).catch(() => null)
    if (cwd) return cwd
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

export default function SftpPanel({ sessionId }: Props): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const transfersRef = useRef<TransferItem[]>([])
  const cwdRef = useRef('')

  useEffect(() => {
    cwdRef.current = cwd
  }, [cwd])

  const loadDir = useCallback(
    async (dir: string) => {
      setLoading(true)
      setError(null)
      try {
        const list = await window.ssh.sftpList(sessionId, dir)
        setEntries(list)
        setCwd(dir)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [sessionId]
  )

  useEffect(() => {
    let disposed = false
    const offProgress = window.ssh.onSftpProgress((evt) => {
      setTransfers((list) =>
        list.map((t) =>
          t.id === evt.transferId
            ? { ...t, done: evt.done, total: evt.total, speed: evt.speed }
            : t
        )
      )
    })
    const offDone = window.ssh.onSftpDone((evt) => {
      setTransfers((list) =>
        list.map((t) =>
          t.id === evt.transferId
            ? { ...t, status: evt.error ? 'error' : 'done', error: evt.error }
            : t
        )
      )
      // 上传完成且成功后,自动刷新当前目录,让新文件立即可见
      const item = transfersRef.current.find((t) => t.id === evt.transferId)
      if (item?.type === 'upload' && !evt.error && cwdRef.current) {
        void loadDir(cwdRef.current)
      }
    })
    void (async () => {
      try {
        const cwd = (await window.ssh.getCwd(sessionId).catch(() => null)) ?? (await waitForCwd(sessionId))
        const dir = cwd ?? (await window.ssh.sftpHome(sessionId))
        if (!disposed) await loadDir(dir)
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      disposed = true
      offProgress()
      offDone()
    }
  }, [sessionId, loadDir])

  const trackTransfer = useCallback((item: TransferItem) => {
    transfersRef.current = [...transfersRef.current, item]
    setTransfers(transfersRef.current)
  }, [])

  const downloadRemote = async (remotePath: string, name: string): Promise<void> => {
    const { canceled, filePath } = await window.ssh.pickSaveFile(name)
    if (canceled || !filePath) return
    try {
      const { transferId } = await window.ssh.sftpDownload(sessionId, remotePath, filePath)
      trackTransfer({ id: transferId, name, type: 'download', done: 0, total: 0, speed: 0, status: 'running' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startDownload = async (entry: SftpEntry): Promise<void> => {
    if (entry.type !== 'file') return
    await downloadRemote(joinPath(cwd, entry.name), entry.name)
  }

  const openViewer = (entry: SftpEntry): void => {
    if (entry.type !== 'file') return
    setViewer({ name: entry.name, path: joinPath(cwd, entry.name) })
  }

  const startUpload = async (): Promise<void> => {
    const { canceled, filePaths } = await window.ssh.pickLocalFiles()
    if (canceled || filePaths.length === 0) return
    for (const local of filePaths) {
      const name = baseName(local)
      try {
        const { transferId } = await window.ssh.sftpUpload(sessionId, local, joinPath(cwd, name))
        trackTransfer({ id: transferId, name, type: 'upload', done: 0, total: 0, speed: 0, status: 'running' })
      } catch (err) {
        setError(`${name} 上传失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  const createDir = async (): Promise<void> => {
    const name = window.prompt('新目录名称', '')
    if (!name) return
    try {
      await window.ssh.sftpMkdir(sessionId, joinPath(cwd, name))
      await loadDir(cwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeEntry = async (entry: SftpEntry): Promise<void> => {
    const tip = entry.type === 'dir' ? `确认删除目录 ${entry.name}(含全部内容)?` : `确认删除 ${entry.name}?`
    if (!window.confirm(tip)) return
    try {
      await window.ssh.sftpDelete(sessionId, joinPath(cwd, entry.name), entry.type === 'dir')
      await loadDir(cwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="sftp-panel">
      <div className="sftp-toolbar">
        <button className="btn btn-sm" onClick={() => void loadDir(parentOf(cwd))} disabled={cwd === '/'}>
          ← 上级
        </button>
        <span className="sftp-path" title={cwd}>
          {cwd}
        </span>
        <button className="btn btn-sm" onClick={() => void loadDir(cwd)} title="刷新">
          ↻
        </button>
        <button className="btn btn-sm" onClick={() => void createDir()}>
          新建目录
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void startUpload()}>
          ↑ 上传
        </button>
      </div>

      {error && <div className="sftp-error">{error}</div>}

      <div className="sftp-list">
        {loading ? (
          <div className="sftp-hint">加载中…</div>
        ) : sorted.length === 0 ? (
          <div className="sftp-hint">空目录</div>
        ) : (
          <table className="sftp-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr
                  key={e.name}
                  onDoubleClick={() =>
                    e.type === 'dir' ? void loadDir(joinPath(cwd, e.name)) : openViewer(e)
                  }
                >
                  <td>
                    <span className={`sftp-name sftp-${e.type}`}>
                      {e.type === 'dir' ? '📁' : e.type === 'link' ? '🔗' : '📄'} {e.name}
                    </span>
                  </td>
                  <td>{e.type === 'dir' ? '—' : formatSize(e.size)}</td>
                  <td>{formatTime(e.mtime)}</td>
                  <td className="sftp-actions">
                    {e.type === 'dir' ? (
                      <button className="btn btn-xs" onClick={() => void loadDir(joinPath(cwd, e.name))}>
                        打开
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-xs" onClick={() => openViewer(e)}>
                          预览
                        </button>
                        <button className="btn btn-xs" onClick={() => void startDownload(e)}>
                          下载
                        </button>
                      </>
                    )}
                    <button className="btn btn-xs btn-danger" onClick={() => void removeEntry(e)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="sftp-transfers">
          <div className="sftp-transfers-head">
            <span>传输任务</span>
            <button
              className="btn btn-xs"
              onClick={() => {
                transfersRef.current = []
                setTransfers([])
              }}
            >
              清空
            </button>
          </div>
          {transfers.map((t) => {
            const pct = t.total > 0 ? Math.min(100, (t.done / t.total) * 100) : 0
            return (
              <div className="transfer-item" key={t.id}>
                <div className="transfer-info">
                  <span className="transfer-name">
                    {t.type === 'download' ? '↓' : '↑'} {t.name}
                  </span>
                  <span className="transfer-meta">
                    {t.status === 'running'
                      ? `${formatSize(t.done)} / ${t.total > 0 ? formatSize(t.total) : '…'}${t.speed ? ` · ${formatSpeed(t.speed)}` : ''}`
                      : t.status === 'done'
                        ? '完成'
                        : `失败: ${t.error ?? '未知错误'}`}
                  </span>
                </div>
                <div className="transfer-bar">
                  <div className={`transfer-bar-inner transfer-${t.status}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewer && (
        <FileViewer
          sessionId={sessionId}
          remotePath={viewer.path}
          name={viewer.name}
          onClose={() => setViewer(null)}
          onDownload={(remotePath, name) => void downloadRemote(remotePath, name)}
          onSaved={() => void loadDir(cwd)}
        />
      )}
    </div>
  )
}
