import { TerminalUI } from './ui'
import { TerminalPluginMarket, OFFICIAL_REGISTRY } from './plugin-market'
import type { TuiContribution } from '../shared/tui-plugin'

const labels = { commands: '命令手册', monitor: '服务器监控', mysql: 'MySQL 工作台', wsl: 'WSL 终端' }

export class TerminalPluginsUI {
  constructor(private readonly ui: TerminalUI, private readonly market: TerminalPluginMarket, private readonly run: (contribution: TuiContribution) => Promise<void>) {}

  async show(): Promise<void> {
    while (true) {
      const plugins = this.market.list()
      const id = await this.ui.menu('终端插件', [
        ...plugins.map((plugin) => ({ label: `${plugin.enabled ? '[启用]' : '[停用]'} ${plugin.name} · ${plugin.version}`, value: plugin.id })),
        ...this.market.errors.map((item) => ({ label: `[损坏] ${item.id} · ${item.error}`, value: item.id })),
        { label: '+ 插件市场', value: '+' }
      ])
      if (!id) return
      if (id === '+') { await this.browse(); continue }
      const plugin = plugins.find((plugin) => plugin.id === id)
      if (!plugin) {
        if (await this.ui.confirm('删除损坏的插件文件，以便重新安装？')) this.market.remove(id)
        continue
      }
      const action = await this.ui.menu(plugin.name, [
        ...(plugin.enabled && !this.market.support(plugin) ? plugin.descriptor.contributions.map((item, index) => ({ label: '打开 · ' + labels[item.kind], value: String(index) })) : []),
        { label: plugin.enabled ? '停用插件' : '启用插件', value: 'toggle' }, { label: '检查更新 / 重新安装', value: 'update' }, { label: '卸载插件', value: 'remove' }
      ], this.market.support(plugin) || plugin.description)
      if (action === 'toggle') this.market.setEnabled(id, !plugin.enabled)
      if (action === 'update') await this.ui.busy('更新终端插件', this.market.install(plugin.registry, id))
      if (action === 'remove' && await this.ui.confirm(`卸载 ${plugin.name}？连接配置与数据库 vault 会保留。`)) this.market.remove(id)
      if (action && /^\d+$/.test(action)) await this.run(plugin.descriptor.contributions[Number(action)])
    }
  }

  private async browse(): Promise<void> {
    const source = await this.ui.input('插件市场地址', OFFICIAL_REGISTRY)
    const entries = await this.ui.busy('读取插件市场', this.market.registry(source))
    const id = await this.ui.menu('插件市场', entries.map((entry) => ({ label: `${entry.official ? '[官方] ' : ''}${entry.name} · ${entry.version} · ${this.market.support(entry) || '支持终端'}`, value: entry.id })))
    if (!id) return
    const entry = entries.find((entry) => entry.id === id)!
    const unsupported = this.market.support(entry)
    if (unsupported) { await this.ui.view(entry.name, unsupported); return }
    await this.ui.view(entry.name, entry.description + '\n来源：' + source)
    if (await this.ui.confirm(`安装 ${entry.name}？安装后默认停用。`)) await this.ui.busy('安装终端插件', this.market.install(source, id))
  }
}
