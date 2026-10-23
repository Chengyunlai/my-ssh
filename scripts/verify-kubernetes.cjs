// Real Electron preload/IPC and renderer against a local Kubernetes API fixture.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-kube-desktop-'))
app.setPath('userData', temporary)
app.setPath('sessionData', temporary)
const resources = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/core/fixtures/kubernetes-resources.json'), 'utf8'))
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (process.env.MYSSH_KUBE_DEBUG) console.log('fixture request', url.pathname)
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname.includes('/namespaces/forbidden/')) {
    response.writeHead(403)
    response.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', reason: 'Forbidden', message: 'Forbidden', code: 403 }))
    return
  }
  if (url.pathname.startsWith('/apis/metrics.k8s.io/')) {
    response.end(JSON.stringify({ metadata: { name: url.pathname.split('/').at(-1) }, timestamp: '2026-10-22T05:00:00Z', window: '30s', containers: [{ name: 'container-1', usage: { cpu: '12000000n', memory: '32Mi' } }] }))
    return
  }
  if (url.pathname.endsWith('/log')) {
    response.end('2026-10-22T05:00:00Z fixture log ready\n<script>window.__unsafe = true</script>\n')
    return
  }
  if (/\/pods\/[^/]+$/.test(url.pathname)) {
    const item = resources.items.find((item) => item.kind === 'Pod' && item.metadata.name === url.pathname.split('/').at(-1))
    response.end(JSON.stringify({ apiVersion: 'v1', ...item }))
    return
  }
  let value
  if (url.pathname === '/api') value = { kind: 'APIVersions', versions: ['v1'] }
  else if (url.pathname === '/apis') value = { kind: 'APIGroupList', apiVersion: 'v1', groups: [] }
  else if (url.pathname === '/api/v1') value = { kind: 'APIResourceList', groupVersion: 'v1', resources: ['services', 'pods'].map((name) => ({ name, singularName: name.slice(0, -1), namespaced: true, kind: name === 'services' ? 'Service' : 'Pod', verbs: ['get', 'list'] })) }
  else if (/\/(services|pods)$/.test(url.pathname)) {
    const kind = url.pathname.endsWith('services') ? 'Service' : 'Pod'
    value = { apiVersion: 'v1', kind: `${kind}List`, items: resources.items.filter((item) => item.kind === kind).map((item) => ({ apiVersion: 'v1', ...item })) }
  } else { response.writeHead(404); response.end('{}'); return }
  response.end(JSON.stringify(value))
})
const configPath = path.join(temporary, 'config.json')
let importPath = configPath
dialog.showOpenDialog = async (options) => {
  assert.equal(options.defaultPath, path.join(os.homedir(), '.kube'))
  assert.ok(options.properties.includes('showHiddenFiles'))
  return { canceled: false, filePaths: [importPath] }
}
app.on('browser-window-created', (_event, window) => {
  window.setSkipTaskbar(true)
  window.on('show', () => window.hide())
})
require('../out/main/index.js')
app.whenReady().then(async () => {
  app.dock?.hide()
  let exitCode = 0
  const timer = setTimeout(() => { console.error('Kubernetes desktop verification timed out'); app.exit(1) }, 60000)
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(configPath, JSON.stringify({ apiVersion: 'v1', kind: 'Config', clusters: [{ name: 'fixture', cluster: { server: `http://127.0.0.1:${server.address().port}` } }], users: [], contexts: [{ name: 'fixture', context: { cluster: 'fixture' } }], 'current-context': 'fixture' }), { mode: 0o600 })
    const window = BrowserWindow.getAllWindows()[0]
    if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
    const evaluate = (code) => window.webContents.executeJavaScript(code)
    const waitFor = async (code) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(code)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      console.error(await evaluate("document.querySelector('.kubernetes-panel')?.innerText"))
      throw new Error('Renderer condition timed out')
    }
    await waitFor("Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Kubernetes'))")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Kubernetes').click()")
    await waitFor("Boolean(document.querySelector('.kubernetes-panel'))")
    await evaluate("[...document.querySelectorAll('.kubernetes-panel button')].find(button => button.textContent === '导入 kubeconfig').click()")
    await waitFor("document.querySelector('.kubernetes-context')?.value === 'fixture'")
    await evaluate("[...document.querySelectorAll('.kubernetes-panel button')].find(button => button.textContent === '查看服务').click()")
    await waitFor("document.querySelectorAll('.kubernetes-panel tbody tr').length === 15")
    const targets = await evaluate('window.ssh.kubernetes.targets()')
    assert.equal(targets.length, 15)
    assert.ok(targets.some((target) => target.database === 'postgresql'))
    assert.ok(targets.some((target) => target.database === 'redis'))
    const config = await evaluate('window.ssh.kubernetes.importConfig()')
    const forbidden = await evaluate(`window.ssh.kubernetes.discover(${JSON.stringify(config.id)}, 'fixture', 'forbidden').then(() => 'unexpected-success', error => error.message)`)
    assert.match(forbidden, /权限不足/)
    const otherWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } })
    await otherWindow.loadFile(path.join(__dirname, '../out/renderer/index.html'))
    const ownership = await otherWindow.webContents.executeJavaScript(`window.ssh.kubernetes.discover(${JSON.stringify(config.id)}, 'fixture', '').then(() => 'unexpected-success', error => error.message)`)
    assert.match(ownership, /重新导入/)
    otherWindow.destroy()
    if (process.argv[2]) {
      const screenshot = await window.webContents.capturePage()
      fs.writeFileSync(path.resolve(process.argv[2]), screenshot.toPNG())
    }
    console.log('Design QA: database filter')
    await evaluate("[...document.querySelectorAll('.kubernetes-filters button')].find(button => button.textContent.startsWith('数据库')).click()")
    await waitFor("document.querySelectorAll('.kubernetes-panel tbody tr').length === 2")
    await evaluate(`(() => {
      const input = document.querySelector('.kubernetes-search')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no-match-for-design-check')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await waitFor("document.querySelectorAll('.kubernetes-panel tbody tr').length === 0")
    assert.match(await evaluate("document.querySelector('.kubernetes-empty').textContent"), /没有匹配/)
    await evaluate(`(() => {
      const input = document.querySelector('.kubernetes-search')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await waitFor("document.querySelectorAll('.kubernetes-panel tbody tr').length === 2")
    await evaluate("document.querySelector('.kubernetes-observe-actions button').click()")
    await waitFor("Boolean(document.querySelector('.kubernetes-inspector'))")
    await waitFor("Boolean(document.querySelector('.kubernetes-metric-summary'))")
    assert.match(await evaluate("document.querySelector('.kubernetes-metric-summary').textContent"), /12.0/)
    await evaluate("[...document.querySelectorAll('.kubernetes-inspector button')].find(button => button.textContent === '容器日志').click()")
    await waitFor("Boolean(document.querySelector('.kubernetes-log-controls'))")
    await waitFor("Boolean(document.querySelector('.kubernetes-log-output'))")
    assert.match(await evaluate("document.querySelector('.kubernetes-log-output').textContent"), /fixture log ready/)
    assert.equal(await evaluate('window.__unsafe'), undefined)
    if (process.argv[2]) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const observation = await window.webContents.capturePage()
      fs.writeFileSync(path.resolve(process.argv[2].replace(/\.png$/, '-pod-logs.png')), observation.toPNG())
    }
    await evaluate("[...document.querySelectorAll('.kubernetes-inspector button')].find(button => button.textContent === '关闭详情').click()")
    await waitFor("!document.querySelector('.kubernetes-inspector')")
    await waitFor("document.activeElement?.textContent === '监控'")
    await evaluate("document.querySelectorAll('.kubernetes-observe-actions button')[1].click()")
    await waitFor("Boolean(document.querySelector('.kubernetes-log-output'))")
    assert.equal(await evaluate("document.querySelector('.kubernetes-inspector').open"), true)
    await evaluate("document.querySelector('.kubernetes-inspector').dispatchEvent(new Event('cancel', { cancelable: true }))")
    await waitFor("!document.querySelector('.kubernetes-inspector')")
    await waitFor("document.activeElement?.textContent === '日志'")
    window.setSize(860, 760)
    await waitFor('window.innerWidth <= 860')
    await evaluate("document.querySelectorAll('.kubernetes-observe-actions button')[1].click()")
    await waitFor("Boolean(document.querySelector('.kubernetes-log-output')) && !document.querySelector('.kubernetes-inspector [role=status]')")
    assert.equal(await evaluate("(() => { const el = document.querySelector('.kubernetes-inspector'); return el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth })()"), true)
    if (process.argv[2]) {
      window.webContents.setBackgroundThrottling(false)
      window.removeAllListeners('show')
      window.showInactive()
      await new Promise(resolve => setTimeout(resolve, 250))
      const detail = await window.webContents.capturePage()
      fs.writeFileSync(path.resolve(process.argv[2].replace(/\.png$/, '-detail-narrow.png')), detail.toPNG())
    }
    await evaluate("document.querySelector('.kubernetes-inspector').dispatchEvent(new Event('cancel', { cancelable: true }))")
    await waitFor("!document.querySelector('.kubernetes-inspector')")
    console.log('Pod metrics and container logs verified, untrusted text remained inert')
    console.log('Design QA: search and pod disclosure passed')
    window.webContents.setBackgroundThrottling(false)
    window.setSize(860, 760)
    await waitFor('window.innerWidth <= 860')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
    assert.equal(await evaluate(`(() => { const badge = document.querySelector('.kubernetes-kind'); return badge.getBoundingClientRect().right <= badge.parentElement.getBoundingClientRect().right })()`), true)
    if (process.argv[2]) {
      window.removeAllListeners('show')
      window.showInactive()
      const narrow = await window.webContents.capturePage()
      fs.writeFileSync(path.resolve(process.argv[2].replace(/\.png$/, '-narrow.png')), narrow.toPNG())
    }
    const encryptedFile = path.join(temporary, 'kubernetes-configs.enc')
    assert.ok(fs.existsSync(encryptedFile))
    assert.equal(fs.readFileSync(encryptedFile).includes(Buffer.from('127.0.0.1')), false)
    await evaluate(`window.ssh.kubernetes.rememberSelection(${JSON.stringify(config.id)}, 'fixture', 'remembered-scope')`)
    const secondSource = path.join(temporary, 'second-config.json')
    fs.copyFileSync(configPath, secondSource)
    fs.unlinkSync(configPath)
    const reopened = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } })
    await reopened.loadFile(path.join(__dirname, '../out/renderer/index.html'))
    window.destroy()
    const evaluateReopened = (code) => reopened.webContents.executeJavaScript(code)
    const waitReopened = async (code) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluateReopened(code)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Remembered configuration UI timed out')
    }
    await waitReopened("Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Kubernetes'))")
    await evaluateReopened("[...document.querySelectorAll('button')].find(button => button.textContent === 'Kubernetes').click()")
    await waitReopened("document.querySelector('.kubernetes-context')?.value === 'fixture' && document.querySelector('input[placeholder=\"全部命名空间\"]')?.value === 'remembered-scope'")
    const restoredState = await evaluateReopened('window.ssh.kubernetes.remembered()')
    assert.equal(restoredState.configs.length, 1)
    assert.equal(restoredState.selectedId, config.id)
    assert.ok(restoredState.configs.every((entry) => !('json' in entry) && !('snapshot' in entry)))
    importPath = secondSource
    await evaluateReopened("[...document.querySelectorAll('button')].find(button => button.textContent === '导入 kubeconfig').click()")
    await waitReopened("document.querySelector('select[aria-label=\"已保存配置\"]')?.options.length === 2")
    await evaluateReopened(`(() => {
      const select = document.querySelector('select[aria-label="已保存配置"]')
      select.value = ${JSON.stringify(config.id)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitReopened("document.querySelector('input[placeholder=\"全部命名空间\"]')?.value === 'remembered-scope'")
    await evaluateReopened("[...document.querySelectorAll('button')].find(button => button.textContent === '移除当前配置').click()")
    await waitReopened("Boolean(document.querySelector('.kubernetes-cleanup-confirm'))")
    await evaluateReopened("[...document.querySelectorAll('.kubernetes-cleanup-confirm button')].find(button => button.textContent === '确认移除').click()")
    await waitReopened("document.querySelector('select[aria-label=\"已保存配置\"]')?.options.length === 1 && !document.querySelector('.kubernetes-cleanup-confirm')")
    assert.equal((await evaluateReopened('window.ssh.kubernetes.remembered()')).configs.length, 1)
    await evaluateReopened("[...document.querySelectorAll('button')].find(button => button.textContent === '清空记录').click()")
    await waitReopened("Boolean(document.querySelector('.kubernetes-cleanup-confirm'))")
    await evaluateReopened("[...document.querySelectorAll('.kubernetes-cleanup-confirm button')].find(button => button.textContent === '确认清空').click()")
    await waitReopened("!document.querySelector('.kubernetes-cleanup-confirm') && document.querySelector('select[aria-label=\"已保存配置\"]')?.value === ''")
    assert.deepEqual(await evaluateReopened('window.ssh.kubernetes.remembered()'), { configs: [], selectedId: null })
    assert.equal(fs.existsSync(encryptedFile), false)
    assert.equal(fs.existsSync(secondSource), true)
    console.log('REMEMBERED_CONFIG_OK: encrypted content restored in new window without source file; selection, multiple configs, remove and clear verified')
    reopened.destroy()
    console.log('KUBERNETES_DESKTOP_OK: import dialog, real kubectl, preload/IPC, renderer resource table, RBAC error, window ownership')
  } catch (error) { console.error(error); exitCode = 1 }
  finally { clearTimeout(timer); server.close(); fs.rmSync(temporary, { recursive: true, force: true }); app.exit(exitCode) }
})
