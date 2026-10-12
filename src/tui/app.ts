import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createCore, ProfileStore, validateProfile, type MySshCore, type Profile } from '../core'
import { EncryptedVault, dataDirectory } from './vault'
import { TerminalUI, Cancelled, ExitRequested, type Choice } from './ui'
import { ShellScreens, type ShellScreen } from './shells'
import { editText } from './editor'
import { localPath } from './paths'
import { showServices } from './services'
import { showPreview } from './preview'
import { TerminalPluginMarket } from './plugin-market'
import { TerminalPluginsUI } from './plugin-ui'
import { MysqlWorkspace, type SavedMysqlProfile } from './mysql-workspace'
import { showWsl } from './wsl'
import { showLiveMonitor } from './monitor-view'
import type { TuiContribution, CommandCatalogCategory } from '../shared/tui-plugin'

interface Connection { sessionId: string; profile: Profile; error?: string; closed: boolean }

export class TuiApp {
  private readonly core: MySshCore = createCore()
  private readonly shells = new ShellScreens(this.core)
  private readonly connections = new Map<string, Connection>()
  private vault?: EncryptedVault
  private store?: ProfileStore
  private readonly market = new TerminalPluginMarket(path.join(dataDirectory(), 'plugins'), __MYSSH_VERSION__)
  private databaseVault?: EncryptedVault<SavedMysqlProfile>
  private databaseError?: string
  private databaseUI?: MysqlWorkspace
  private readonly localProcesses = new AbortController()

  constructor(private readonly ui: TerminalUI) {
    this.core.events.on('ssh:status', (status) => {
      const connection = this.connections.get(status.sessionId)
      if (!connection) return
      if (status.status === 'error') connection.error = status.message || '连接失败'
      if (status.status === 'error' || status.status === 'disconnected') connection.closed = true
    })
  }

  async run(): Promise<void> {
    await this.unlock()
    while (true) {
      try {
        const selected = await this.ui.menu('MySSH · 终端工作区', [
          { label: '服务器 · 连接与配置', value: 'profiles' },
          { label: `会话 · ${[...this.connections.values()].filter((connection) => !connection.closed).length} 个在线`, value: 'sessions' },
          { label: '插件 · 市场与工作台', value: 'plugins' },
          { label: '退出', value: 'exit' }
        ], 'SSH / SFTP / 系统监控 / 服务发现')
        if (!selected || selected === 'exit') return
        if (selected === 'profiles') await this.profiles()
        if (selected === 'sessions') await this.sessions()
        if (selected === 'plugins') await this.plugins()
      } catch (error) { await this.report(error) }
    }
  }

  private async report(error: unknown): Promise<void> {
    if (error instanceof ExitRequested) throw error
    if (error instanceof Cancelled) return
    await this.ui.view('操作失败', error instanceof Error ? error.message : String(error))
  }

  private async unlock(): Promise<void> {
    const filename = path.join(dataDirectory(), 'profiles.vault.json')
    while (true) {
      try {
        const existing = fs.existsSync(filename)
        const password = await this.ui.input(existing ? '输入主密码以解锁连接配置' : '设置主密码（至少 8 个字符）', '', true)
        if (!existing && password !== await this.ui.input('再次输入主密码', '', true)) throw new Error('两次主密码不一致')
        this.vault = new EncryptedVault(filename, password)
        this.store = new ProfileStore(this.vault)
        this.store.list()
        if (!existing) this.vault.write([])
        try {
          this.databaseVault = new EncryptedVault<SavedMysqlProfile>(path.join(dataDirectory(), 'databases.vault.json'), password, 'myssh-tui-databases-v1')
          this.databaseUI = new MysqlWorkspace(this.ui, this.databaseVault)
          this.databaseError = undefined
        } catch (error) { this.databaseError = error instanceof Error ? error.message : String(error) }
        return
      } catch (error) {
        if (error instanceof Cancelled || error instanceof ExitRequested) throw new ExitRequested()
        this.vault?.dispose()
        await this.report(error)
      }
    }
  }

  private async form(existing?: Profile): Promise<Profile> {
    const name = await this.ui.input('连接名称', existing?.name)
    const host = await this.ui.input('主机名 / IP', existing?.host)
    const port = Number(await this.ui.input('SSH 端口', String(existing?.port || 22)))
    const username = await this.ui.input('用户名', existing?.username || 'root')
    const authType = await this.ui.menu('认证方式', [
      { label: '账号密码', value: 'password' as const },
      { label: 'PEM 私钥文件', value: 'key' as const }
    ])
    if (!authType) throw new Cancelled()
    const profile: Profile = { id: existing?.id || randomUUID(), name, host, port, username, authType }
    if (authType === 'password') profile.password = await this.ui.input('SSH 密码（加密保存）', existing?.password, true)
    else {
      profile.keyPath = localPath(await this.ui.input('私钥文件路径', existing?.keyPath))
      profile.passphrase = await this.ui.input('私钥口令（可为空）', existing?.passphrase, true)
    }
    validateProfile(profile)
    return profile
  }

  private async profiles(): Promise<void> {
    while (true) {
      const choices: Choice<string>[] = this.store!.list().map((profile) => ({
        label: `${profile.name} · ${profile.username}@${profile.host}:${profile.port}`, value: profile.id
      }))
      choices.push({ label: '+ 新建连接', value: '+' })
      const id = await this.ui.menu('服务器', choices)
      if (!id) return
      try {
        if (id === '+') { this.store!.save(await this.form()); continue }
        const profile = this.store!.list().find((item) => item.id === id)!
        const action = await this.ui.menu(profile.name, [
          { label: '连接', value: 'connect' }, { label: '测试连接', value: 'test' },
          { label: '编辑配置', value: 'edit' }, { label: '删除配置', value: 'delete' }
        ])
        if (action === 'connect') await this.connect(profile)
        if (action === 'test') {
          const result = await this.ui.busy('测试连接', this.core.ssh.testConnect(profile))
          await this.ui.view(result.ok ? '连接测试成功' : '连接测试失败', result.message || '认证成功')
        }
        if (action === 'edit') this.store!.save(await this.form(profile))
        if (action === 'delete' && await this.ui.confirm(`删除连接配置「${profile.name}」？`)) this.store!.delete(id)
      } catch (error) { await this.report(error) }
    }
  }

  private async waitForShell(sessionId: string, existing?: string): Promise<ShellScreen> {
    const ready = this.shells.list(sessionId).find((screen) => existing ? screen.shellId === existing : true)
    if (ready) return ready
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('远端 Shell 创建超时')) }, 15000)
      const unsubShell = this.core.events.on('ssh:shell-status', (status) => {
        if (status.sessionId !== sessionId || existing && status.shellId !== existing) return
        if (status.status === 'connected') {
          cleanup()
          resolve(this.shells.list(sessionId).find((screen) => screen.shellId === status.shellId)!)
        } else if (status.status === 'error') { cleanup(); reject(new Error(status.message || 'Shell 创建失败')) }
      })
      const unsubStatus = this.core.events.on('ssh:status', (status) => {
        if (status.sessionId === sessionId && (status.status === 'error' || status.status === 'disconnected')) {
          cleanup(); reject(new Error(status.message || 'SSH 会话已关闭'))
        }
      })
      const cleanup = (): void => { clearTimeout(timer); unsubShell(); unsubStatus(); removeDisposal() }
      const removeDisposal = this.core.events.onDispose(() => { cleanup(); reject(new ExitRequested()) })
    })
  }

  private async connect(profile: Profile): Promise<void> {
    const { sessionId } = this.core.ssh.connect(profile)
    const connection: Connection = { sessionId, profile, closed: false }
    this.connections.set(sessionId, connection)
    try {
      const screen = await this.ui.busy(`连接 ${profile.name}`, this.waitForShell(sessionId))
      await this.shells.attach(screen)
      await this.workspace(connection)
    } catch (error) {
      if (!connection.closed) this.core.ssh.disconnect(sessionId)
      this.connections.delete(sessionId)
      throw error
    }
  }

  private async sessions(): Promise<void> {
    while (true) {
      const connections = [...this.connections.values()]
      const id = await this.ui.menu('会话', connections.map((connection) => ({
        label: `${connection.profile.name} · ${connection.closed ? connection.error || '已断开' : `${this.shells.list(connection.sessionId).length} 个终端`}`, value: connection.sessionId
      })))
      if (!id) return
      await this.workspace(this.connections.get(id)!)
    }
  }

  private async workspace(connection: Connection): Promise<void> {
    while (true) {
      if (connection.closed) {
        await this.ui.view('会话已关闭', connection.error || connection.profile.name)
        this.connections.delete(connection.sessionId)
        return
      }
      const id = connection.sessionId
      const action = await this.ui.menu(connection.profile.name, [
        { label: '终端 · 进入 / 切换 / 新建 / 关闭（Ctrl+] 返回菜单）', value: 'shells' },
        { label: 'SFTP 文件管理', value: 'files' }, { label: '系统监控', value: 'monitor' },
        { label: '服务发现', value: 'services' }, { label: '终端插件', value: 'plugins' }, { label: '断开连接', value: 'disconnect' }
      ], `${connection.profile.username}@${connection.profile.host}:${connection.profile.port}`)
      if (!action) return
      try {
        if (action === 'shells') await this.terminals(id)
        if (action === 'files') await this.files(id)
        if (action === 'monitor') await this.monitor(id)
        if (action === 'plugins') await this.plugins(connection)
        if (action === 'services') {
          const result = await this.ui.busy('发现远端服务', this.core.services.scan(id))
          if (result.ok) await showServices(this.ui, result.snapshot, connection.profile)
          else await this.ui.view('服务发现', result.error.message)
        }
        if (action === 'disconnect' && await this.ui.confirm('断开此会话及全部终端？')) {
          this.core.ssh.disconnect(id)
          this.connections.delete(id)
          return
        }
      } catch (error) { await this.report(error) }
    }
  }

  private async selectConnection(): Promise<Connection | undefined> {
    const live = [...this.connections.values()].filter((connection) => !connection.closed)
    if (!live.length) { await this.ui.view('SSH 插件', '请先连接一台 SSH 服务器。'); return }
    const id = await this.ui.menu('选择 SSH 会话', live.map((connection) => ({ label: connection.profile.name, value: connection.sessionId })))
    return id ? this.connections.get(id) : undefined
  }

  private async plugins(connection?: Connection): Promise<void> {
    const run = async (item: TuiContribution): Promise<void> => {
      if (item.kind === 'mysql') {
        if (!this.databaseUI) throw new Error(this.databaseError || '数据库 vault 尚未解锁')
        await this.databaseUI.run()
      } else if (item.kind === 'wsl') await showWsl(this.ui, this.localProcesses.signal)
      else {
        const selected = connection || await this.selectConnection()
        if (!selected) return
        if (item.kind === 'monitor') await showLiveMonitor(this.ui, this.core, selected.sessionId)
        if (item.kind === 'commands') await this.commands(selected, item.categories)
      }
    }
    await new TerminalPluginsUI(this.ui, this.market, run).show()
  }

  private async commands(connection: Connection, categories: CommandCatalogCategory[]): Promise<void> {
    const command = await this.ui.menu('命令手册 · / 搜索', categories.flatMap((category) => category.commands.map((entry) => ({
      label: `${entry.command} · ${entry.description} · ${category.name}`, value: entry
    }))))
    if (!command) return
    await this.ui.view(command.command, command.description + '\n\n' + (command.example || command.command))
    const action = await this.ui.menu('命令手册', [{ label: '返回', value: false }, { label: '发送到 SSH 终端（由你按 Enter 执行）', value: true }])
    if (action !== true) return
    const text = await this.ui.input('发送的命令（不发送 Enter）', command.example || command.command)
    const shellId = await this.ui.menu('选择终端', this.shells.list(connection.sessionId).map((screen) => ({ label: screen.name, value: screen.shellId })))
    if (!shellId) return
    this.core.ssh.sendData(connection.sessionId, shellId, text)
    await this.shells.attach(this.shells.list(connection.sessionId).find((screen) => screen.shellId === shellId)!)
  }

  private async terminals(id: string): Promise<void> {
    const action = await this.ui.menu('终端 · Ctrl+] 返回菜单', [
      ...this.shells.list(id).map((screen) => ({ label: screen.name, value: screen.shellId })),
      { label: '+ 新建终端', value: '+' }
    ])
    if (!action) return
    let screen: ShellScreen
    if (action === '+') {
      const opened = this.core.ssh.openShell(id, this.ui.width, this.ui.height)
      if (!opened) throw new Error('SSH 会话尚未就绪')
      screen = await this.ui.busy('新建终端', this.waitForShell(id, opened.shellId))
    } else screen = this.shells.list(id).find((item) => item.shellId === action)!
    const choice = await this.ui.menu(screen.name, [{ label: '进入终端', value: 'open' }, { label: '关闭终端', value: 'close' }])
    if (choice === 'open') await this.shells.attach(screen)
    if (choice === 'close' && await this.ui.confirm('关闭终端？最后一个终端关闭后会断开会话。')) this.core.ssh.closeShell(id, screen.shellId)
  }

  private async monitor(id: string): Promise<void> {
    while (true) {
      const result = await this.ui.busy('采集系统指标', this.core.monitor.getSnapshot(id))
      if (!result.ok) { await this.ui.view('系统监控', result.error.message); return }
      const snapshot = result.snapshot
      await this.ui.view('系统监控', [
        `CPU ${snapshot.cpu.usagePercent === null ? '首次采样，请刷新' : `${snapshot.cpu.usagePercent.toFixed(1)}%`}`,
        `Load ${snapshot.cpu.load1} / ${snapshot.cpu.load5} / ${snapshot.cpu.load15}`,
        `内存 ${snapshot.memory.usagePercent.toFixed(1)}% · Swap ${snapshot.memory.swapUsagePercent.toFixed(1)}%`,
        `运行 ${Math.floor(snapshot.uptimeSeconds / 3600)} 小时`, '',
        ...snapshot.disks.map((disk) => `${disk.mountPoint} · ${disk.usagePercent}% · ${disk.availableBytes} 字节可用`), '',
        ...snapshot.network.map((network) => `${network.interface} · RX ${network.rxBytes} / TX ${network.txBytes}`)
      ].join('\n'))
      if (await this.ui.menu('系统监控', [{ label: '返回', value: false }, { label: '刷新', value: true }]) !== true) return
    }
  }

  private async files(id: string): Promise<void> {
    let directory = this.core.ssh.getCwd(id) || await this.ui.busy('读取远端目录', this.core.sftp.home(id))
    while (true) {
      const entries = await this.ui.busy('读取远端目录', this.core.sftp.list(id, directory))
      const choices: Choice<{ action: string; name?: string }>[] = [
        { label: '.. 上级目录', value: { action: 'parent' } },
        { label: '跳转路径', value: { action: 'path' } },
        { label: '上传文件', value: { action: 'upload' } },
        { label: '新建目录', value: { action: 'mkdir' } }
      ]
      entries.filter((entry) => entry.name !== '.' && entry.name !== '..').sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name)).forEach((entry) => choices.push({
        label: `${entry.type === 'dir' ? '[目录]' : entry.type === 'link' ? '[链接]' : '[文件]'} ${entry.name} · ${entry.size} B`, value: { action: 'entry', name: entry.name }
      }))
      const selected = await this.ui.menu(`SFTP · ${directory}`, choices)
      if (!selected) return
      try {
        if (selected.action === 'parent') directory = path.posix.dirname(directory)
        if (selected.action === 'path') {
          const target = await this.ui.input('远端路径', directory)
          const candidate = path.posix.resolve(directory, target)
          await this.ui.busy('检查远端目录', this.core.sftp.list(id, candidate))
          directory = candidate
        }
        if (selected.action === 'mkdir') {
          const name = await this.ui.input('新目录名称')
          if (!name || name === '.' || name === '..' || name.includes('/')) throw new Error('请输入单个目录名称')
          await this.ui.busy('创建目录', this.core.sftp.mkdir(id, path.posix.join(directory, name)))
        }
        if (selected.action === 'upload') {
          const local = localPath(await this.ui.input('本地文件路径'))
          if (!fs.statSync(local).isFile()) throw new Error('请选择本地普通文件')
          const remote = path.posix.join(directory, path.basename(local))
          if (await this.core.sftp.stat(id, remote) && !await this.ui.confirm(`覆盖远端文件 ${remote}？`)) continue
          await this.transfer('上传文件', () => this.core.sftp.upload(id, local, remote))
        }
        if (selected.action === 'entry') {
          const entry = entries.find((item) => item.name === selected.name)!
          const remote = path.posix.join(directory, entry.name)
          const action = await this.ui.menu(entry.name, entry.type === 'dir' ? [
            { label: '进入目录', value: 'enter' }, { label: '删除目录（包含全部内容）', value: 'delete' }
          ] : [
            { label: '文件预览 / 文本编辑', value: 'read' }, { label: '下载文件', value: 'download' }, { label: '删除文件', value: 'delete' }
          ])
          if (action === 'enter') directory = remote
          if (action === 'delete' && await this.ui.confirm(`永久删除远端 ${remote}${entry.type === 'dir' ? ' 及全部内容' : ''}？`)) await this.ui.busy('删除远端内容', this.core.sftp.remove(id, remote, entry.type === 'dir'))
          if (action === 'download') {
            const local = localPath(await this.ui.input('保存到本地路径', path.join(process.cwd(), entry.name)))
            if (fs.existsSync(local) && !await this.ui.confirm(`覆盖本地文件 ${local}？`)) continue
            await this.transfer('下载文件', () => this.core.sftp.download(id, remote, local))
          }
          if (action === 'read') await this.preview(id, remote)
        }
      } catch (error) { await this.report(error) }
    }
  }

  private async preview(id: string, remote: string): Promise<void> {
    const result = await this.ui.busy('读取远端文件', this.core.sftp.read(id, remote))
    if (result.kind !== 'text') {
      if (result.truncated) throw new Error('文件超过预览上限，不能解析截断内容；请下载完整文件')
      if (result.kind === 'binary') { await this.ui.view('文件预览', `二进制文件（${result.size} 字节），请下载后用本地应用打开。`); return }
      const bytes = result.bytes || Buffer.from(result.dataUrl!.slice(result.dataUrl!.indexOf(',') + 1), 'base64')
      await showPreview(this.ui, bytes, remote)
      return
    }
    const content = result.content || ''
    const display = content.slice(0, 65536)
    await this.ui.view(remote, display + (content.length > display.length || result.truncated ? '\n…预览已截断' : ''))
    if (result.truncated) { await this.ui.view('只读文件', '超过 5 MiB 的文件禁止编辑，以免截断内容覆盖完整文件。'); return }
    if (await this.ui.menu('文本文件', [{ label: '返回文件列表', value: false }, { label: '用本地编辑器编辑', value: true }]) !== true) return
    const changed = await editText(this.ui, content, remote)
    if (changed !== content && await this.ui.confirm(`写回远端文件 ${remote}？`)) {
      const latest = await this.ui.busy('检查远端文件是否变化', this.core.sftp.read(id, remote, { fresh: true }))
      if (latest.kind !== 'text' || latest.truncated || latest.content !== content) throw new Error('远端文件已变化，未覆盖；请重新打开编辑')
      await this.ui.busy('保存远端文件', this.core.sftp.write(id, remote, changed))
    }
  }

  private async transfer(title: string, start: () => { transferId: string }): Promise<void> {
    let transferId = ''
    let unsubscribeDone!: () => void
    let unsubscribeProgress!: () => void
    const completed = new Promise<void>((resolve, reject) => {
      unsubscribeDone = this.core.events.on('sftp:done', (event) => {
        if (event.transferId !== transferId) return
        if (event.error) reject(new Error(event.error))
        else resolve()
      })
      unsubscribeProgress = this.core.events.on('sftp:progress', (event) => {
        if (event.transferId === transferId) this.ui.frame(title, [`${event.done} / ${event.total} 字节 · ${event.speed} B/s`], 'Ctrl+C 退出')
      })
    })
    try {
      transferId = start().transferId
      await this.ui.busy(title, completed)
      await this.ui.view(title, '传输完成')
    } finally { unsubscribeDone(); unsubscribeProgress() }
  }

  dispose(): void {
    this.market.dispose()
    this.localProcesses.abort()
    this.databaseUI?.dispose()
    this.databaseVault?.dispose()
    this.core.dispose()
    this.shells.dispose()
    this.vault?.dispose()
  }
}

declare const __MYSSH_VERSION__: string
