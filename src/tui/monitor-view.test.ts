import { expect, it } from 'vitest'
import { networkRates, metricTrend } from './monitor-view'
import type { SystemMetricsSnapshot } from '../shared/types'

it('keeps terminal trend bounded and clamps its percent scale', () => {
  expect(metricTrend([0, 100, -10, 120])).toBe('▁█▁█')
  expect(metricTrend(Array.from({ length: 100 }, () => 50))).toHaveLength(30)
})

it('uses elapsed sample time for network rates and handles resets/new interfaces', () => {
  const before = { sampledAt: 1000, network: [{ interface: 'eth0', rxBytes: 100, txBytes: 500 }] } as SystemMetricsSnapshot
  const after = { sampledAt: 3000, network: [{ interface: 'eth0', rxBytes: 500, txBytes: 20 }, { interface: 'new', rxBytes: 10, txBytes: 20 }] } as SystemMetricsSnapshot
  expect(networkRates(before, after)[0]).toContain('RX 200 B/s · TX 0 B/s')
  expect(networkRates(before, after)[1]).toContain('等待速率样本')
  expect(networkRates(undefined, after)[0]).toContain('等待速率样本')
})
