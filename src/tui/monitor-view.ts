import type { MySshCore } from '../core'
import type { SystemMetricsSnapshot } from '../shared/types'
import type { TerminalUI } from './ui'

export function metricTrend(values: number[]): string {
  const blocks = '▁▂▃▄▅▆▇█'
  return values.slice(-30).map((value) => blocks[Math.round(Math.max(0, Math.min(100, value)) * 7 / 100)]).join('')
}

export function networkRates(previous: SystemMetricsSnapshot | undefined, current: SystemMetricsSnapshot): string[] {
  const seconds = previous ? (current.sampledAt - previous.sampledAt) / 1000 : 0
  return current.network.map((network) => {
    const old = previous?.network.find((item) => item.interface === network.interface)
    if (!old || seconds <= 0) return `${network.interface} · RX ${network.rxBytes} B / TX ${network.txBytes} B（等待速率样本）`
    return `${network.interface} · RX ${Math.round(Math.max(0, network.rxBytes - old.rxBytes) / seconds)} B/s · TX ${Math.round(Math.max(0, network.txBytes - old.txBytes) / seconds)} B/s`
  })
}

export async function showLiveMonitor(ui: TerminalUI, core: MySshCore, sessionId: string): Promise<void> {
  let previous: SystemMetricsSnapshot | undefined
  const cpu: number[] = []
  const memory: number[] = []
  let lastLines: string[] = []
  await ui.live('服务器监控 · 实时趋势', async () => {
    const result = await core.monitor.getSnapshot(sessionId)
    if (!result.ok) {
      if (result.error.code === 'rate-limited' && lastLines.length) return [...lastLines, '等待下一次采样窗口…']
      throw new Error(result.error.message)
    }
    const snapshot = result.snapshot
    cpu.push(snapshot.cpu.usagePercent || 0); memory.push(snapshot.memory.usagePercent)
    if (cpu.length > 30) cpu.shift()
    if (memory.length > 30) memory.shift()
    const lines = [
      `CPU ${snapshot.cpu.usagePercent === null ? '首次采样' : snapshot.cpu.usagePercent.toFixed(1) + '%'} · ${metricTrend(cpu)}`,
      `内存 ${snapshot.memory.usagePercent.toFixed(1)}% · ${metricTrend(memory)}`,
      `Swap ${snapshot.memory.swapUsagePercent.toFixed(1)}% · Load ${snapshot.cpu.load1} / ${snapshot.cpu.load5} / ${snapshot.cpu.load15}`,
      `运行 ${Math.floor(snapshot.uptimeSeconds / 3600)} 小时`, '',
      ...snapshot.disks.map((disk) => `${disk.mountPoint} · ${disk.usagePercent}% · ${disk.availableBytes} B 可用`), '',
      ...networkRates(previous, snapshot)
    ]
    previous = snapshot
    lastLines = lines
    return lines
  })
}
