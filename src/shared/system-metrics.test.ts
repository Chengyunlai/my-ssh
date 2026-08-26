import { describe, expect, it } from 'vitest'
import { parseSystemMetrics, updateCpuSample } from './system-metrics'

const SAMPLE = [
  'MYSSH_METRICS_V1',
  '[stat]',
  'cpu  100 20 30 400 50 10 5 0 0 0',
  '[loadavg]',
  '0.10 0.20 0.30 1/100 123',
  '[meminfo]',
  'MemTotal:       102400 kB',
  'MemAvailable:    62400 kB',
  'SwapTotal:       20480 kB',
  'SwapFree:        10240 kB',
  '[netdev]',
  'Inter-| Receive                                                | Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '  eth0: 1000 1 0 0 0 0 0 0 2000 2 0 0 0 0 0 0',
  '  lo: 300 1 0 0 0 0 0 0 400 1 0 0 0 0 0 0',
  '[df]',
  'Filesystem 1024-blocks Used Available Capacity Mounted on',
  '/dev/sda1 100000 40000 60000 40% /',
  '/dev/sdb1 200000 100000 100000 50% /data\\040files',
  '[uptime]',
  '12345.67 100.00',
  'END'
].join('\n')

describe('system metrics parser', () => {
  it('parses the fixed Linux collector output and normalizes units', () => {
    const result = parseSystemMetrics(SAMPLE, 1_700_000_000_000)

    expect(result.platform).toBe('linux')
    expect(result.cpu.load1).toBe(0.1)
    expect(result.memory.totalBytes).toBe(102400 * 1024)
    expect(result.memory.usedBytes).toBe(40000 * 1024)
    expect(result.network).toEqual([
      { interface: 'eth0', rxBytes: 1000, txBytes: 2000 },
      { interface: 'lo', rxBytes: 300, txBytes: 400 }
    ])
    expect(result.disks[1]).toMatchObject({ mountPoint: '/data files', usagePercent: 50 })
    expect(result.uptimeSeconds).toBe(12345.67)
  })

  it('returns insufficient data for the first CPU sample and computes a later delta', () => {
    const first = updateCpuSample(undefined, { total: 600, idle: 450 })
    expect(first.usagePercent).toBeNull()
    expect(first.sampleStatus).toBe('insufficient-data')
    const second = updateCpuSample(first.next, { total: 800, idle: 550 })
    expect(second.usagePercent).toBe(50)
    expect(second.sampleStatus).toBe('ready')
  })

  it('rejects missing or malformed collector sections', () => {
    expect(() => parseSystemMetrics('MYSSH_METRICS_V1\nEND\n', Date.now())).toThrow()
    expect(() =>
      parseSystemMetrics(SAMPLE.replace('MemTotal:       102400 kB', 'MemTotal: nope'), Date.now())
    ).toThrow()
  })
})
