import { app } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateState, UpdateStatus } from '@shared/types'
import { logError } from './logger'

let state: UpdateState = { status: 'disabled', currentVersion: app.getVersion() }
const listeners = new Set<(s: UpdateState) => void>()

export function onUpdateState(cb: (s: UpdateState) => void): () => void {
  listeners.add(cb)
  cb(state)
  return () => listeners.delete(cb)
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}

function notesText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map((n) => n.note).join('\n')
  return undefined
}

/** 更新源优先级:MYSSH_UPDATE_URL(自定义静态服务器)> electron-builder 的 GitHub Releases 配置 */
function feedUrl(): string | undefined {
  return process.env.MYSSH_UPDATE_URL?.trim() || undefined
}

function configure(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  const url = feedUrl()
  if (url) autoUpdater.setFeedURL({ provider: 'generic', url })
}

function wireEvents(): void {
  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      version: info.version,
      releaseNotes: notesText(info.releaseNotes),
      releaseDate: info.releaseDate
    })
  })
  autoUpdater.on('update-not-available', () => {
    setState({ status: 'current' })
  })
  autoUpdater.on('download-progress', (p) => {
    setState({
      status: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
      speed: p.bytesPerSecond
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    logError('updater', '更新失败', err.message)
    setState({ status: 'error', error: err.message })
  })
}

export function isUpdateSupported(): boolean {
  return app.isPackaged
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!isUpdateSupported()) {
    setState({ status: 'disabled', error: '开发模式不检查更新,请使用打包版本' })
    return state
  }
  configure()
  wireEvents()
  setState({ status: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logError('updater', '检查更新失败', message)
    setState({ status: 'error', error: message })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status === 'downloaded') return state
  setState({ status: 'downloading', percent: 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logError('updater', '下载更新失败', message)
    setState({ status: 'error', error: message })
  }
  return state
}

/** 下载完成后安装并重启(静默安装,安装成功后自动拉起) */
export function installUpdate(): void {
  if (state.status !== 'downloaded') return
  autoUpdater.quitAndInstall(false, true)
}
