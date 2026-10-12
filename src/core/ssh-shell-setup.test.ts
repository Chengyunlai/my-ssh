import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const { clients, stream } = vi.hoisted(() => ({ clients: [] as EventEmitter[], stream: { value: undefined as unknown as EventEmitter & { write: ReturnType<typeof vi.fn> } } }))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    constructor() { super(); clients.push(this) }
    connect = vi.fn()
    end = vi.fn()
    shell = vi.fn((_options, callback) => callback(null, stream.value))
  }
  return { Client }
})
import { createCore } from './index'
import { disconnectAll } from './ssh'
afterEach(() => { disconnectAll(); clients.length = 0; vi.useRealTimers() })

it('stops startup echo filtering on first user input so a fullscreen app is not held for 2.5 seconds', async () => {
  vi.useFakeTimers()
  stream.value = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), setWindow: vi.fn() })
  const core = createCore()
  const received: string[] = []
  core.events.on('ssh:output', ({ data }) => received.push(data))
  const { sessionId } = core.ssh.connect({ id: 'fixture', name: 'fixture', host: '127.0.0.1', port: 22, username: 'demo', authType: 'password', password: 'fixture' })
  clients[0].emit('ready')
  stream.value.emit('data', Buffer.from('shell-prompt$ '))
  core.ssh.sendData(sessionId, 'main', 'vim\r')
  const frame = '\x1b[?1049h\x1b[H欢迎使用 Vim'
  stream.value.emit('data', Buffer.from(frame))
  await vi.advanceTimersByTimeAsync(100)
  expect(received.join('')).toBe('shell-prompt$ ' + frame)
  core.dispose()
})
