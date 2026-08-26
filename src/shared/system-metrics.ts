import type { SystemMetricsSnapshot } from './types'

export interface CpuCounters {
  total: number
  idle: number
}

export interface CpuSampleResult {
  usagePercent: number | null
  sampleStatus: 'ready' | 'insufficient-data'
  next: CpuCounters
}

const BYTES_PER_KIB = 1024

function section(raw: string, name: string): string {
  const marker = `[${name}]`
  const start = raw.indexOf(`${marker}\n`)
  if (start === -1) throw new Error(`指标采集输出缺少 ${name} 段`)
  const bodyStart = start + marker.length + 1
  const next = raw.indexOf('\n[', bodyStart)
  const end = next === -1 ? raw.indexOf('\nEND', bodyStart) : next
  if (end === -1) throw new Error(`指标采集输出缺少 ${name} 段结束标记`)
  return raw.slice(bodyStart, end).trim()
}

function number(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} 不是有效数字`)
  return parsed
}

function nonNegative(value: number, label: string): number {
  if (value < 0) throw new Error(`${label} 不能为负数`)
  return value
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function parseCpu(raw: string): CpuCounters {
  const line = raw.split('\n').find((item) => /^cpu\s/.test(item.trim()))
  if (!line) throw new Error('指标采集输出缺少 CPU 数据')
  const values = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => nonNegative(number(value, 'CPU 计数'), 'CPU 计数'))
  if (values.length < 4) throw new Error('CPU 计数不完整')
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    idle: values[3] + (values[4] ?? 0)
  }
}

export function updateCpuSample(previous: CpuCounters | undefined, current: CpuCounters): CpuSampleResult {
  if (!previous || current.total <= previous.total || current.idle < previous.idle) {
    return { usagePercent: null, sampleStatus: 'insufficient-data', next: current }
  }
  const totalDelta = current.total - previous.total
  const idleDelta = current.idle - previous.idle
  const usage = totalDelta === 0 ? 0 : (1 - idleDelta / totalDelta) * 100
  return {
    usagePercent: percent(usage),
    sampleStatus: 'ready',
    next: current
  }
}

function parseLoadAverage(raw: string): [number, number, number] {
  const values = raw.split(/\s+/).slice(0, 3).map((value) => number(value, 'load average'))
  if (values.length !== 3) throw new Error('load average 数据不完整')
  return values as [number, number, number]
}

function parseMemory(raw: string): SystemMetricsSnapshot['memory'] {
  const values = new Map<string, number>()
  for (const line of raw.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s+kB$/.exec(line.trim())
    if (match) values.set(match[1], Number(match[2]) * BYTES_PER_KIB)
  }
  const total = values.get('MemTotal')
  const available = values.get('MemAvailable') ?? values.get('MemFree')
  const swapTotal = values.get('SwapTotal')
  const swapFree = values.get('SwapFree')
  if (total === undefined || available === undefined || swapTotal === undefined || swapFree === undefined) {
    throw new Error('内存数据不完整')
  }
  const used = nonNegative(total - available, '内存已用量')
  const swapUsed = nonNegative(swapTotal - swapFree, 'Swap 已用量')
  return {
    totalBytes: total,
    usedBytes: used,
    availableBytes: available,
    usagePercent: total === 0 ? 0 : percent((used / total) * 100),
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapUsed,
    swapUsagePercent: swapTotal === 0 ? 0 : percent((swapUsed / swapTotal) * 100)
  }
}

function parseNetwork(raw: string): SystemMetricsSnapshot['network'] {
  const result: SystemMetricsSnapshot['network'] = []
  for (const line of raw.split('\n')) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const fields = match[2].trim().split(/\s+/)
    if (fields.length < 9) continue
    const rxBytes = nonNegative(number(fields[0], '网络接收字节'), '网络接收字节')
    const txBytes = nonNegative(number(fields[8], '网络发送字节'), '网络发送字节')
    result.push({ interface: match[1].trim(), rxBytes, txBytes })
  }
  if (result.length === 0) throw new Error('网络数据不完整')
  return result
}

function unescapeMountPoint(value: string): string {
  return value.replaceAll('\\040', ' ').replaceAll('\\011', '\t').replaceAll('\\134', '\\')
}

function parseDisks(raw: string): SystemMetricsSnapshot['disks'] {
  const result: SystemMetricsSnapshot['disks'] = []
  for (const line of raw.split('\n').slice(1)) {
    const match = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line.trim())
    if (!match) continue
    const total = Number(match[2]) * BYTES_PER_KIB
    const used = Number(match[3]) * BYTES_PER_KIB
    const available = Number(match[4]) * BYTES_PER_KIB
    if (![total, used, available].every(Number.isSafeInteger) || total < 0 || used < 0 || available < 0) {
      continue
    }
    result.push({
      mountPoint: unescapeMountPoint(match[6]),
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      usagePercent: percent(Number(match[5]))
    })
  }
  if (result.length === 0) throw new Error('磁盘数据不完整')
  return result
}

function parseUptime(raw: string): number {
  const value = number(raw.split(/\s+/)[0], '运行时间')
  return nonNegative(value, '运行时间')
}

export function parseSystemMetrics(
  raw: string,
  sampledAt: number,
  previousCpu?: CpuCounters
): SystemMetricsSnapshot & { cpuCounters: CpuCounters } {
  if (!raw.startsWith('MYSSH_METRICS_V1\n') || !raw.trimEnd().endsWith('END')) {
    throw new Error('指标采集输出不完整')
  }
  const cpuCounters = parseCpu(section(raw, 'stat'))
  const cpu = updateCpuSample(previousCpu, cpuCounters)
  const [load1, load5, load15] = parseLoadAverage(section(raw, 'loadavg'))
  return {
    sampledAt,
    platform: 'linux',
    cpu: { usagePercent: cpu.usagePercent, sampleStatus: cpu.sampleStatus, load1, load5, load15 },
    memory: parseMemory(section(raw, 'meminfo')),
    disks: parseDisks(section(raw, 'df')),
    network: parseNetwork(section(raw, 'netdev')),
    uptimeSeconds: parseUptime(section(raw, 'uptime')),
    cpuCounters
  }
}
