import { describe, expect, it, vi } from 'vitest'
import { readServerMonitorFixture } from './server-monitor'

describe('server-monitor external plugin fixture', () => {
  it('receives a structured snapshot through the host API', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        sampledAt: 1,
        platform: 'linux',
        cpu: { usagePercent: null, load1: 0, load5: 0, load15: 0, sampleStatus: 'insufficient-data' },
        memory: {
          totalBytes: 100,
          usedBytes: 50,
          availableBytes: 50,
          usagePercent: 50,
          swapTotalBytes: 0,
          swapUsedBytes: 0,
          swapUsagePercent: 0
        },
        disks: [],
        network: [],
        uptimeSeconds: 1
      }
    } as const)

    const result = await readServerMonitorFixture({ monitor: { getSnapshot } }, 'session-1')

    expect(result.ok).toBe(true)
    expect(getSnapshot).toHaveBeenCalledWith('session-1')
  })
})
