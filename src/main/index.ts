import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as market from './market'
import * as logger from './logger'
import * as profiles from './profiles'
import * as sftp from './sftp'
import * as ssh from './ssh'
import * as storage from './storage'
import * as updater from './updater'
import type { Profile, UpdateState } from '@shared/types'
import type { IpcResult } from '@shared/types'

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
// 统一应用名:dev 下 app.name 默认取 package.json 的 name,这里显式兜底
// (macOS Dock/菜单栏显示名由 dev 启动脚本里的 Electron 副本 Info.plist 控制,见 scripts/dev.mjs)。
app.setName('my-ssh')
// 打包图标已配好(见 electron-builder.yml);这里让 dev 运行的窗口/Dock 也显示我们的 logo。
// 运行时图标用白圆角磁贴版(dock.setIcon 直出图片不会套 macOS 圆角遮罩,必须是圆角图)。
// Dock 用 256px 硬边磁贴(缩放毛边最小);窗口用 1024 磁贴。
// build/ 目录不会打进安装包(files: out/**),包内直接走系统应用图标(icns 全出血由系统遮罩)。
const appIconPath = path.join(__dirname, '../../build/icon-tile.png')
const dockIconPath = path.join(__dirname, '../../build/icon-tile-dock.png')
const hasAppIcon = existsSync(appIconPath)
const hasDockIcon = existsSync(dockIconPath)

// 默认 Electron 菜单(File / Edit / View / Window / Help)是典型的"Electron 味"。
// 只保留系统级角色菜单:应用菜单(macOS)、编辑(复制/粘贴/全选)、窗口。
function installAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as Electron.MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

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
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'MySSH',
    backgroundColor: '#161616',
    ...(hasAppIcon ? { icon: appIconPath } : {}),
    // 原生窗口框架:macOS 用隐藏式标题栏 + 红绿灯;Windows / Linux 用系统窗口按钮覆盖层
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#161616',
            symbolColor: '#fafafa',
            height: 44
          }
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

installAppMenu()

// 主进程未捕获异常/未处理 Promise 拒绝:记录到日志,便于排查
process.on('uncaughtException', (err) => {
  logger.logError(
    'main',
    'uncaughtException',
    err instanceof Error ? (err.stack ?? err.message) : String(err)
  )
})
process.on('unhandledRejection', (reason) => {
  logger.logError(
    'main',
    'unhandledRejection',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  )
})

function registerIpc(): void {
  // 应用更新状态推送:渲染进程订阅后,主进程把 updater 状态转发到对应窗口
  const updateWindows = new Set<Electron.WebContents>()
  let updateForwarder: (() => void) | null = null
  const forwardUpdate = (s: UpdateState): void => {
    for (const wc of updateWindows) {
      if (!wc.isDestroyed()) wc.send('app:update-state', s)
    }
  }
  ipcMain.on('app:update-subscribe', (e) => {
    updateWindows.add(e.sender)
    e.sender.once('destroyed', () => updateWindows.delete(e.sender))
    if (!updateForwarder) updateForwarder = updater.onUpdateState(forwardUpdate)
  })
  ipcMain.on('app:update-unsubscribe', (e) => {
    updateWindows.delete(e.sender)
    if (updateWindows.size === 0 && updateForwarder) {
      updateForwarder()
      updateForwarder = null
    }
  })
  ipcMain.handle('app:update-check', () => updater.checkForUpdate())
  ipcMain.handle('app:update-download', () => updater.downloadUpdate())
  ipcMain.on('app:update-install', () => updater.installUpdate())

  // 高失败率操作用结构化结果返回,不 reject:
  // Electron 会对每个 reject 的 ipcMain.handle 打印错误日志,
  // 而会话切换/重连时的竞态失败是预期情况,不该刷屏。
  const safeHandle = <T>(channel: string, fn: () => T | Promise<T>): Promise<IpcResult<T>> =>
    Promise.resolve(fn()).then(
      (value) => ({ ok: true, value }),
      (err) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.logError('ipc', `${channel} 失败`, message)
        return { ok: false, error: message }
      }
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
  ipcMain.handle('ssh:test', (e, profile: Profile) => ssh.testConnect(profile, e.sender))
  ipcMain.on('ssh:data', (_e, sessionId: string, shellId: string, data: string) => ssh.sendData(sessionId, shellId, data))
  ipcMain.on('ssh:resize', (_e, sessionId: string, shellId: string, cols: number, rows: number) =>
    ssh.resize(sessionId, shellId, cols, rows)
  )
  ipcMain.on('ssh:disconnect', (_e, sessionId: string) => ssh.disconnect(sessionId))
  ipcMain.handle('ssh:open-shell', (e, sessionId: string) => ssh.openShell(sessionId, e.sender))
  ipcMain.handle('ssh:close-shell', (_e, sessionId: string, shellId: string) => ssh.closeShell(sessionId, shellId))
  ipcMain.handle('ssh:cwd', (_e, sessionId: string) => ssh.getCwd(sessionId))
  ipcMain.on('clipboard:copy', (_e, text: string) => clipboard.writeText(text))

  ipcMain.handle('app:info', () => storage.appInfo())
  ipcMain.handle('storage:scan', (_e, pluginIds: string[]) => storage.scan(pluginIds))
  ipcMain.handle('storage:clean-cache', () => storage.cleanCache())
  ipcMain.handle('storage:clean-plugin', (_e, pluginId: string) => storage.cleanPlugin(pluginId))

  ipcMain.on('log:error', (_e, tag: string, message: string, detail?: string) =>
    logger.logError(tag, message, detail)
  )
  ipcMain.handle('log:read', () => logger.readLog())
  ipcMain.handle('log:clear', () => logger.clearLog())

  ipcMain.handle('market:fetch-registry', (_e, url: string) =>
    safeHandle('market:fetch-registry', () => market.fetchRegistry(url))
  )
  ipcMain.handle('market:list-installed', () =>
    safeHandle('market:list-installed', () => market.listInstalled())
  )
  ipcMain.handle('market:install', (_e, url: string, pluginId: string) =>
    safeHandle('market:install', () => market.install(url, pluginId))
  )

  ipcMain.handle('sftp:home', (_e, sessionId: string) =>
    safeHandle('sftp:home', () => sftp.home(sessionId))
  )
  ipcMain.handle('sftp:list', (_e, sessionId: string, dir: string) =>
    safeHandle('sftp:list', () => sftp.list(sessionId, dir))
  )
  ipcMain.handle('sftp:mkdir', (_e, sessionId: string, dir: string) =>
    safeHandle('sftp:mkdir', () => sftp.mkdir(sessionId, dir))
  )
  ipcMain.handle('sftp:read', (e, sessionId: string, remotePath: string) =>
    safeHandle('sftp:read', () => sftp.read(sessionId, remotePath, e.sender))
  )
  ipcMain.handle('sftp:write', (_e, sessionId: string, remotePath: string, content: string) =>
    safeHandle('sftp:write', () => sftp.write(sessionId, remotePath, content))
  )
  ipcMain.handle('sftp:stat', (_e, sessionId: string, remotePath: string) =>
    safeHandle('sftp:stat', () => sftp.stat(sessionId, remotePath))
  )
  ipcMain.handle('sftp:delete', (_e, sessionId: string, target: string, isDir: boolean) =>
    safeHandle('sftp:delete', () => sftp.remove(sessionId, target, isDir))
  )
  ipcMain.handle('sftp:download', (e, sessionId: string, remote: string, local: string) =>
    safeHandle('sftp:download', () => sftp.download(sessionId, remote, local, e.sender))
  )
  ipcMain.handle('sftp:upload', (e, sessionId: string, local: string, remote: string) =>
    safeHandle('sftp:upload', () => sftp.upload(sessionId, local, remote, e.sender))
  )
}

app.whenReady().then(() => {
  logger.initLogger(app.getPath('userData'))
  if (isMac && hasDockIcon) app.dock?.setIcon(dockIconPath)
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

  // 启动时静默检查更新(仅打包版本);发现新版本后由设置页「关于」提示
  if (updater.isUpdateSupported()) void updater.checkForUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ssh.disconnectAll()
  app.quit()
})

app.on('before-quit', () => ssh.disconnectAll())
