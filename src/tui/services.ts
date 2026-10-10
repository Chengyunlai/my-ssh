import { buildApplicationViews, buildOverview, scanBoundaries, type EntranceView } from '../shared/entrance'
import type { Profile, ServiceScanSnapshot } from '../shared/types'
import type { TerminalUI } from './ui'
import { openBrowser } from './external'

function describeEntrance(entrance: EntranceView): string {
  return [
    `${entrance.service.port}/${entrance.service.protocol} · ${entrance.address}`,
    entrance.protocolReason,
    ...(entrance.needsTunnel ? ['需要先建立本地隧道'] : []),
    ...(entrance.tunnelCommand ? [`隧道命令：${entrance.tunnelCommand}`] : []),
    ...(entrance.sshCommand ? [`SSH 命令：${entrance.sshCommand}`] : []),
    ...(entrance.schemeChoices.length ? ['协议未知，可选地址：', ...entrance.schemeChoices] : []),
    ...(entrance.directAddress ? [`备选直连：${entrance.directAddress}`] : []),
    ...(entrance.localPortConflicts.length ? [`本地端口冲突：${entrance.localPortConflicts.join('、')}`] : [])
  ].join('\n')
}

export async function showServices(ui: TerminalUI, snapshot: ServiceScanSnapshot, profile: Profile): Promise<void> {
  const applications = buildApplicationViews(snapshot, {
    host: profile.host, sshPort: profile.port, username: profile.username,
    keyPath: profile.authType === 'key' ? profile.keyPath : undefined
  })
  while (true) {
    const choice = await ui.menu('服务发现', [
      ...applications.map((app, index) => ({ label: `${app.title} · ${app.kindLabel} · ${app.primary.address}`, value: String(index) })),
      { label: '系统后台套接字、外部上游与扫描说明', value: 'details' }
    ], buildOverview(snapshot.counts).chainText)
    if (!choice) return
    if (choice === 'details') {
      await ui.view('扫描说明', [
        snapshot.os?.prettyName || '未知系统', ...scanBoundaries(snapshot), '',
        ...snapshot.services.filter((service) => service.systemSocket).map((service) => `${service.port}/${service.protocol} · ${service.systemSocketReason || service.displayName}`), '',
        ...snapshot.proxy.external.map((route) => `${route.host}${route.match} → ${route.upstream}\n${route.reason}`),
        ...snapshot.warnings, ...snapshot.proxy.warnings
      ].join('\n'))
    } else {
      const app = applications[Number(choice)]
      await ui.view(app.title, [app.detail, '', ...app.entrances.map(describeEntrance)].join('\n\n'))
      const links = app.entrances.flatMap((entrance) => entrance.openUrl ? [entrance.openUrl] : entrance.schemeChoices)
      if (links.length) {
        const chosen = await ui.menu('打开服务地址', [
          { label: '返回应用列表', value: '' },
          ...links.map((url) => ({ label: `在浏览器打开 ${url}`, value: url }))
        ], '仅显示地址不会建立隧道；需要隧道时请先执行上方命令')
        if (chosen) await ui.busy('打开浏览器', openBrowser(chosen))
      }
    }
  }
}
