import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Profile, SftpEntry } from '@shared/types'
import {
  ArrowBackIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  LinkIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon
} from '../../components/icons'
import FileViewer from './FileViewer'
import PromptDialog from '../../components/PromptDialog'

interface Props {
  sessionId: string
  profile: Profile
  /** 是否为当前可见标签;从其他标签切回时主动刷新一次,避免终端操作后列表过期 */
  active?: boolean
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

interface PromptState {
  title: string
  placeholder?: string
  onSubmit: (name: string) => void
}

interface MenuItem {
  label: string
  icon: ReactNode
  danger?: boolean
  onClick: () => void
}

type MenuState =
  | { x: number; y: number; kind: 'entry'; entry: SftpEntry }
  | { x: number; y: number; kind: 'blank' }
  | null

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

export default function SftpPanel({ sessionId, active }: Props): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const [dragOver, setDragOver] = useState(false)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const transfersRef = useRef<TransferItem[]>([])
  const cwdRef = useRef('')
  const activeRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragTimerRef = useRef(0)

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

  // 切换进入文件面板:立即刷新一次;面板保持挂载,只有 active 变化能感知切回
  useEffect(() => {
    if (active) {
      if (activeRef.current && cwdRef.current) {
        void loadDir(cwdRef.current)
      }
      activeRef.current = true
    } else {
      activeRef.current = false
    }
  }, [active, loadDir])

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

  const uploadLocalPath = useCallback(
    (localPath: string): void => {
      const name = baseName(localPath)
      void (async () => {
        try {
          const { transferId } = await window.ssh.sftpUpload(
            sessionId,
            localPath,
            joinPath(cwdRef.current, name)
          )
          trackTransfer({
            id: transferId,
            name,
            type: 'upload',
            done: 0,
            total: 0,
            speed: 0,
            status: 'running'
          })
        } catch (err) {
          setError(`${name} 上传失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      })()
    },
    [sessionId, trackTransfer]
  )

  const startUpload = async (): Promise<void> => {
    const { canceled, filePaths } = await window.ssh.pickLocalFiles()
    if (canceled || filePaths.length === 0) return
    for (const local of filePaths) uploadLocalPath(local)
  }

  const createDir = async (name: string): Promise<void> => {
    try {
      await window.ssh.sftpMkdir(sessionId, joinPath(cwd, name))
      await loadDir(cwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const createFile = async (name: string): Promise<void> => {
    const remote = joinPath(cwd, name)
    try {
      const exists = await window.ssh.sftpStat(sessionId, remote)
      if (exists) {
        setError(`「${name}」已存在,请换一个名字`)
        return
      }
      await window.ssh.sftpWrite(sessionId, remote, '')
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

  const closeMenu = useCallback((): void => setMenu(null), [])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onBlur = (): void => setMenu(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [menu])

  // 菜单贴边时翻转,避免超出视口
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let { x, y } = menu
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad)
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [menu])

  const buildMenuItems = (): MenuItem[] => {
    if (!menu) return []
    if (menu.kind === 'entry') {
      const entry = menu.entry
      if (entry.type === 'dir') {
        return [
          {
            label: '打开',
            icon: <FolderIcon size={14} />,
            onClick: () => void loadDir(joinPath(cwd, entry.name))
          },
          { label: '删除', icon: <TrashIcon size={14} />, danger: true, onClick: () => void removeEntry(entry) }
        ]
      }
      return [
        { label: '预览', icon: <FileIcon size={14} />, onClick: () => openViewer(entry) },
        { label: '下载', icon: <DownloadIcon size={14} />, onClick: () => void startDownload(entry) },
        { label: '删除', icon: <TrashIcon size={14} />, danger: true, onClick: () => void removeEntry(entry) }
      ]
    }
    return [
      {
        label: '新建文件',
        icon: <FileIcon size={14} />,
        onClick: () =>
          setPrompt({
            title: '新建文件',
            placeholder: '文件名,例如 readme.md',
            onSubmit: (name) => void createFile(name)
          })
      },
      {
        label: '新建文件夹',
        icon: <FolderIcon size={14} />,
        onClick: () =>
          setPrompt({
            title: '新建文件夹',
            placeholder: '文件夹名称',
            onSubmit: (name) => void createDir(name)
          })
      }
    ]
  }

  const hasDraggedFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')

  // 高亮用定时续期:dragover 持续刷新,离开面板后短暂超时自动消失;
  // 拖过内部子元素触发的 dragleave 不会让高亮闪烁或卡住
  const scheduleDragClear = (): void => {
    window.clearTimeout(dragTimerRef.current)
    dragTimerRef.current = window.setTimeout(() => setDragOver(false), 150)
  }

  const handleDragOver = (e: React.DragEvent): void => {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    setDragOver(true)
    scheduleDragClear()
  }

  const handleDragLeave = (): void => scheduleDragClear()

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    window.clearTimeout(dragTimerRef.current)
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => {
        try {
          const p = window.ssh.getPathForFile(f)
          if (p) return p
        } catch {
          // Electron 版本差异时回退到旧属性
        }
        return (f as File & { path?: string }).path ?? ''
      })
      .filter((p): p is string => Boolean(p))
    const dirs = paths.filter((p) => /[/\\]$/.test(p))
    const files = paths.filter((p) => !/[/\\]$/.test(p))
    if (dirs.length > 0) setError('暂不支持拖入文件夹,请拖入文件')
    if (files.length === 0 && dirs.length === 0) setError('无法获取拖入文件的路径')
    files.forEach(uploadLocalPath)
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div
      className={`sftp-panel${dragOver ? ' dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="sftp-toolbar">
        <button className="btn btn-sm" onClick={() => void loadDir(parentOf(cwd))} disabled={cwd === '/'}>
          <ArrowBackIcon size={14} /> 上级
        </button>
        <span className="sftp-path" title={cwd}>
          {cwd}
        </span>
        <button className="btn btn-sm" onClick={() => void loadDir(cwd)} title="刷新">
          <RefreshIcon size={14} />
        </button>
        <button
          className="btn btn-sm"
          onClick={() =>
            setPrompt({
              title: '新建文件夹',
              placeholder: '文件夹名称',
              onSubmit: (name) => void createDir(name)
            })
          }
        >
          新建目录
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void startUpload()}>
          <UploadIcon size={14} /> 上传
        </button>
      </div>

      {error && <div className="sftp-error">{error}</div>}

      <div
        className="sftp-list"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, kind: 'blank' })
        }}
      >
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
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr
                  key={e.name}
                  onContextMenu={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    setMenu({ x: ev.clientX, y: ev.clientY, kind: 'entry', entry: e })
                  }}
                  onDoubleClick={() =>
                    e.type === 'dir' ? void loadDir(joinPath(cwd, e.name)) : openViewer(e)
                  }
                >
                  <td>
                    <span className={`sftp-name sftp-${e.type}`}>
                      <span className="sftp-type-icon">
                        {e.type === 'dir' ? <FolderIcon size={14} /> : e.type === 'link' ? <LinkIcon size={14} /> : <FileIcon size={14} />}
                      </span>
                      {e.name}
                    </span>
                  </td>
                  <td>{e.type === 'dir' ? '—' : formatSize(e.size)}</td>
                  <td>{formatTime(e.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {dragOver && (
          <div className="sftp-drop-hint">
            <UploadIcon size={16} /> 松开上传到 {cwd || '当前目录'}
          </div>
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
                    {t.type === 'download' ? <DownloadIcon size={12} /> : <UploadIcon size={12} />} {t.name}
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

      {menu && (
        <div ref={menuRef} className="sftp-menu" style={{ left: menu.x, top: menu.y }}>
          {buildMenuItems().map((item) => (
            <button
              key={item.label}
              className={`sftp-menu-item${item.danger ? ' danger' : ''}`}
              onClick={() => {
                closeMenu()
                item.onClick()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}

      {prompt && (
        <PromptDialog
          title={prompt.title}
          placeholder={prompt.placeholder}
          onSubmit={(name) => {
            setPrompt(null)
            prompt.onSubmit(name)
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  )
}
