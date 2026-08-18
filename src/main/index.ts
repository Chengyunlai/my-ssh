import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as market from './market'
import * as profiles from './profiles'
import * as sftp from './sftp'
import * as ssh from './ssh'
import * as storage from './storage'
import type { Profile } from '@shared/types'
import type { IpcResult } from '@shared/types'

const isDev = !app.isPackaged

// 外部插件通过自定义协议 myssh-plugin://<id>/<version>/entry.js 加载
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'myssh-plugin',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    title: 'MySSH',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  // 高失败率操作用结构化结果返回,不 reject:
  // Electron 会对每个 reject 的 ipcMain.handle 打印错误日志,
  // 而会话切换/重连时的竞态失败是预期情况,不该刷屏。
  const safeHandle = <T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> =>
    Promise.resolve(fn()).then(
      (value) => ({ ok: true, value }),
      (err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )

  ipcMain.handle('profiles:list', () => profiles.listProfiles())
  ipcMain.handle('profiles:save', (_e, profile: Profile) => profiles.saveProfile(profile))
  ipcMain.handle('profiles:delete', (_e, id: string) => profiles.deleteProfile(id))

  ipcMain.handle('dialog:pickKey', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PEM 私钥文件',
      properties: ['openFile'],
      filters: [{ name: 'PEM 私钥', extensions: ['pem', 'key'] }]
    })
    return { canceled: result.canceled, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('dialog:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择保存目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return { canceled: result.canceled, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName })
    return { canceled: result.canceled, filePath: result.filePath }
  })

  ipcMain.handle('ssh:connect', (e, profile: Profile) => ssh.connect(profile, e.sender))
  ipcMain.on('ssh:data', (_e, sessionId: string, data: string) => ssh.sendData(sessionId, data))
  ipcMain.on('ssh:resize', (_e, sessionId: string, cols: number, rows: number) =>
    ssh.resize(sessionId, cols, rows)
  )
  ipcMain.on('ssh:disconnect', (_e, sessionId: string) => ssh.disconnect(sessionId))
  ipcMain.handle('ssh:cwd', (_e, sessionId: string) => ssh.getCwd(sessionId))
  ipcMain.on('clipboard:copy', (_e, text: string) => clipboard.writeText(text))

  ipcMain.handle('app:info', () => storage.appInfo())
  ipcMain.handle('storage:scan', (_e, pluginIds: string[]) => storage.scan(pluginIds))
  ipcMain.handle('storage:clean-cache', () => storage.cleanCache())
  ipcMain.handle('storage:clean-plugin', (_e, pluginId: string) => storage.cleanPlugin(pluginId))

  ipcMain.handle('market:fetch-registry', (_e, url: string) =>
    safeHandle(() => market.fetchRegistry(url))
  )
  ipcMain.handle('market:list-installed', () => safeHandle(() => market.listInstalled()))
  ipcMain.handle('market:install', (_e, url: string, pluginId: string) =>
    safeHandle(() => market.install(url, pluginId))
  )

  ipcMain.handle('sftp:home', (_e, sessionId: string) => safeHandle(() => sftp.home(sessionId)))
  ipcMain.handle('sftp:list', (_e, sessionId: string, dir: string) =>
    safeHandle(() => sftp.list(sessionId, dir))
  )
  ipcMain.handle('sftp:mkdir', (_e, sessionId: string, dir: string) =>
    safeHandle(() => sftp.mkdir(sessionId, dir))
  )
  ipcMain.handle('sftp:read', (_e, sessionId: string, remotePath: string) =>
    safeHandle(() => sftp.read(sessionId, remotePath))
  )
  ipcMain.handle('sftp:write', (_e, sessionId: string, remotePath: string, content: string) =>
    safeHandle(() => sftp.write(sessionId, remotePath, content))
  )
  ipcMain.handle('sftp:delete', (_e, sessionId: string, target: string, isDir: boolean) =>
    safeHandle(() => sftp.remove(sessionId, target, isDir))
  )
  ipcMain.handle('sftp:download', (e, sessionId: string, remote: string, local: string) =>
    safeHandle(() => sftp.download(sessionId, remote, local, e.sender))
  )
  ipcMain.handle('sftp:upload', (e, sessionId: string, local: string, remote: string) =>
    safeHandle(() => sftp.upload(sessionId, local, remote, e.sender))
  )
}

app.whenReady().then(() => {
  protocol.handle('myssh-plugin', (req) => {
    const url = new URL(req.url)
    const seg = url.pathname.split('/').filter(Boolean)
    if (url.hostname && seg.length >= 2) {
      const [version, ...rest] = seg
      const root = path.join(app.getPath('userData'), 'plugins', url.hostname, version)
      const filePath = path.resolve(root, rest.join('/'))
      if (filePath === root || filePath.startsWith(root + path.sep)) {
        try {
          const data = readFileSync(filePath)
          return new Response(data, {
            headers: {
              'content-type': filePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
              'access-control-allow-origin': '*'
            }
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      }
    }
    return new Response('forbidden', { status: 403 })
  })
  ssh.setOnSessionClosed((sessionId) => sftp.closeSftp(sessionId))
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ssh.disconnectAll()
  app.quit()
})

app.on('before-quit', () => ssh.disconnectAll())
