import { afterEach, describe, expect, it, vi } from 'vitest'

const { clients } = vi.hoisted(() => ({ clients: [] as Array<{ emit: (name: string, ...args: unknown[]) => boolean; end: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> }))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    end = vi.fn(() => this.emit('close'))
    connect = vi.fn()
    shell = vi.fn()
    constructor() { super(); clients.push(this) }
  }
  return { Client }
})

import { createCore } from './index'
import { getClient, disconnectAll, testConnect, connect } from './ssh'
import { CoreEventHub } from './host'

const profile = { id: 'fixture', name: 'demo', host: '127.0.0.1', port: 22, username: 'demo', authType: 'password' as const, password: 'fixture' }
afterEach(() => { disconnectAll(); clients.length = 0 })

describe('core host ownership and cleanup', () => {
  it('rejects foreign sessions and closes only sessions owned by the disposed host', () => {
    const first = createCore()
    const second = createCore()
    const a = first.ssh.connect(profile).sessionId
    const b = second.ssh.connect(profile).sessionId
    expect(() => second.ssh.disconnect(a)).toThrow('不属于')
    first.dispose()
    expect(getClient(a)).toBeUndefined()
    expect(getClient(b)).toBeDefined()
    expect(() => first.ssh.connect(profile)).toThrow('释放')
    second.dispose()
    expect(getClient(b)).toBeUndefined()
  })

  it('releases sessions on synchronous private key read failures', () => {
    const host = new CoreEventHub()
    expect(() => connect({ ...profile, authType: 'key', keyPath: '/missing-myssh-test-fixture/key.pem' }, host)).toThrow()
    expect(clients[0].end).toHaveBeenCalledOnce()
    host.dispose()
    expect(clients[0].end).toHaveBeenCalledOnce()
  })

  it('cancels connection probes when the host is released', async () => {
    const host = new CoreEventHub()
    const pending = testConnect(profile, host)
    host.dispose()
    expect(await pending).toEqual({ ok: false, message: '宿主已经释放' })
    expect(clients[0].end).toHaveBeenCalledOnce()
  })

  it('preserves connection errors instead of replacing them with disconnected status', () => {
    const core = createCore()
    const statuses: string[] = []
    core.events.on('ssh:status', (event) => statuses.push(event.status))
    core.ssh.connect(profile)
    clients[0].emit('error', new Error('authentication failed'))
    expect(statuses).toEqual(['connecting', 'error'])
    core.dispose()
  })

  it('notifies the host on transport closure', () => {
    const core = createCore()
    const statuses: string[] = []
    core.events.on('ssh:status', (event) => statuses.push(event.status))
    const { sessionId } = core.ssh.connect(profile)
    clients[0].emit('close')
    expect(statuses).toEqual(['connecting', 'disconnected'])
    expect(getClient(sessionId)).toBeUndefined()
    core.dispose()
  })
})
