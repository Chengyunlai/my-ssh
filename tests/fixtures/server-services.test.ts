import { describe, expect, it, vi } from 'vitest'
import type { ServiceScanSnapshot } from '../../src/shared/types'
import { readServerServicesFixture } from './server-services'

const snapshot: ServiceScanSnapshot = {
  scannedAt: 1,
  os: { id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04.4 LTS' },
  elevated: true,
  counts: { sockets: 16, services: 12, systemSockets: 4, applications: 4 },
  services: [
    {
      id: 'session-1:tcp:8080',
      nodeId: 'session-1',
      port: 8080,
      protocol: 'tcp',
      bindAddr: '127.0.0.1',
      bindScope: 'loopback',
      process: { name: 'docker-proxy', pid: 2101 },
      container: { name: 'panel', image: 'portainer/portainer-ce:2.19.4', internalPort: 80, hostPort: 8080 },
      evidence: [{ source: 'process', value: 'docker-proxy (pid 2101)', confidence: 'certain', observedAt: 1 }],
      displayName: 'Portainer',
      category: 'panel',
      confidence: 'high',
      systemSocket: false
    }
  ],
  applications: [
    {
      id: 'container:panel',
      kind: 'container',
      displayName: 'Portainer',
      detail: '容器 panel · portainer/portainer-ce:2.19.4',
      services: [],
      ports: [8080],
      primaryId: 'session-1:tcp:8080'
    }
  ],
  warnings: []
}

describe('server-services external plugin fixture', () => {
  it('receives the scan result through the host API', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, snapshot } as const)

    const result = await readServerServicesFixture({ serviceScan: { run } }, 'session-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      // 三级收敛的数量都要能读到 —— 只给最后一层，插件没法做自己的展示
      expect(result.snapshot.counts).toEqual({ sockets: 16, services: 12, systemSockets: 4, applications: 4 })
      expect(result.snapshot.applications[0].primaryId).toBe(result.snapshot.services[0].id)
    }
    expect(run).toHaveBeenCalledWith('session-1')
  })
})
