import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isMac = process.platform === 'darwin'

/**
 * macOS:dev 直接跑 node_modules 的 Electron.app 时,Dock/菜单栏显示名是 bundle 的
 * CFBundleDisplayName("Electron")。这里复制一份并改名 my-ssh,再用
 * ELECTRON_EXEC_PATH 让 electron-vite 用这份 bundle 启动,使 Dock 悬停提示显示 my-ssh。
 */
function prepareMacBundle() {
  const dist = join(root, '.dev', 'dist')
  const appDir = join(dist, 'Electron.app')
  const srcApp = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
  if (!existsSync(srcApp)) throw new Error('缺少 node_modules/electron/dist/Electron.app,请先 npm install')
  const srcPlist = join(srcApp, 'Contents', 'Info.plist')
  const dstPlist = join(appDir, 'Contents', 'Info.plist')
  const upToDate = existsSync(dstPlist) && statSync(dstPlist).mtimeMs >= statSync(srcPlist).mtimeMs
  if (!upToDate) {
    console.log('[dev] 准备 my-ssh 开发用 Electron 副本(约 300MB,仅首次或升级后执行)…')
    execFileSync('rm', ['-rf', appDir])
    mkdirSync(dist, { recursive: true })
    execFileSync('ditto', [srcApp, appDir])
    for (const [k, v] of [
      ['CFBundleDisplayName', 'my-ssh'],
      ['CFBundleName', 'my-ssh'],
      ['CFBundleIdentifier', 'com.myssh.app']
    ]) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${k} ${v}`, dstPlist])
    }
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir])
  }
  return dist
}

const env = { ...process.env }
if (isMac) env.ELECTRON_EXEC_PATH = join(prepareMacBundle(), 'Electron.app', 'Contents', 'MacOS', 'Electron')

const bin = join(root, 'node_modules', '.bin', 'electron-vite')
const child = spawn(bin, ['dev'], { stdio: 'inherit', env, cwd: root })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
