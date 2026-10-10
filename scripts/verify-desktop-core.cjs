const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-desktop-verify-'))
app.setPath('userData', temporary)
app.setPath('sessionData', temporary)
app.on('browser-window-created', (_event, window) => {
  window.setSkipTaskbar(true)
  window.on('show', () => window.hide())
})
require('../out/main/index.js')

app.whenReady().then(async () => {
  app.dock?.hide()
  let fixture
  let exitCode = 0
  const timer = setTimeout(() => { console.error('Desktop verification timed out'); app.exit(1) }, 20000)
  try {
    const { startFixture } = await import(pathToFileURL(path.join(__dirname, '../examples/stage-01-core-tui/core/server.mjs')).href)
    fixture = await startFixture()
    const window = BrowserWindow.getAllWindows()[0]
    assert.ok(window)
    if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
    const result = await window.webContents.executeJavaScript(`(async () => {
      const profile = ${JSON.stringify(fixture.profile)}
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Desktop Shell timeout')), 10000)
        const unsubscribe = window.ssh.onShellStatus(status => {
          if (status.status === 'connected') { clearTimeout(timer); unsubscribe(); resolve(status) }
        })
      })
      const { sessionId } = await window.ssh.connect(profile)
      const shell = await ready
      const preview = await window.ssh.sftpRead(sessionId, '/home/demo/hello.txt')
      const monitor = await window.ssh.monitor.getSnapshot(sessionId)
      const services = await window.ssh.serviceScan.run(sessionId)
      const secondReady = new Promise(resolve => {
        const unsubscribe = window.ssh.onShellStatus(status => {
          if (status.status === 'connected' && status.shellId !== 'main') { unsubscribe(); resolve(status.shellId) }
        })
      })
      await window.ssh.openShell(sessionId)
      const secondId = await secondReady
      const secondClosed = await window.ssh.closeShell(sessionId, secondId)
      window.ssh.disconnect(sessionId)
      return { shell: shell.shellId, content: preview.content, monitor: monitor.ok, services: services.ok, secondClosed }
    })()`)
    assert.equal(result.shell, 'main')
    assert.equal(result.content, 'Hello SFTP\n')
    assert.equal(result.secondClosed, true)
    assert.equal(result.monitor, true)
    assert.equal(result.services, true)
    console.log('Desktop verified through actual preload/IPC: SSH, multi-shell, SFTP, monitor and service discovery.')
    window.destroy()
  } catch (error) { console.error(error); exitCode = 1 }
  finally {
    clearTimeout(timer)
    if (fixture) await fixture.close()
    fs.rmSync(temporary, { recursive: true, force: true })
    app.exit(exitCode)
  }
})
