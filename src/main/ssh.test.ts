import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeClient } = vi.hoisted(() => {
  class Emitter {
    private readonly listeners = new Map<string, Array<(...args: never[]) => void>>()

    on(event: string, listener: (...args: never[]) => void): this {
      const handlers = this.listeners.get(event) ?? []
      handlers.push(listener)
      this.listeners.set(event, handlers)
      return this
    }

    once(event: string, listener: (...args: never[]) => void): this {
      const wrapped = (...args: never[]): void => {
        this.off(event, wrapped)
        listener(...args)
      }
      return this.on(event, wrapped)
    }

    off(event: string, listener: (...args: never[]) => void): this {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((item) => item !== listener))
      return this
    }

    emit(event: string, ...args: never[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }

  class FakeStream extends Emitter {
    readonly stderr = new Emitter()
    readonly end = vi.fn()
    readonly destroy = vi.fn()
    readonly close = vi.fn()
    readonly setWindow = vi.fn()

    write = vi.fn()
  }

  class FakeClient extends Emitter {
    static instances: FakeClient[] = []
    readonly streams: FakeStream[] = []

    constructor() {
      super()
      FakeClient.instances.push(this)
    }

    connect = vi.fn()
    end = vi.fn()

    shell = vi.fn((_options: unknown, callback: (error: undefined, stream: FakeStream) => void) => {
      const stream = new FakeStream()
      this.streams.push(stream)
      callback(undefined, stream)
    })
  }

  return { FakeClient }
})

vi.mock('ssh2', () => ({ Client: FakeClient }))

import { closeShell, connect, openShell } from './ssh'

const PROFILE = {
  id: 'profile-1',
  name: '测试服务器',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password' as const,
  password: 'secret'
}

function makeWebContents(): { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean; once: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    isDestroyed: () => false,
    once: vi.fn()
  }
}

describe('SSH 多终端关闭', () => {
  beforeEach(() => {
    FakeClient.instances.length = 0
  })

  it('关闭多个终端中的一个时立即通知 renderer 移除对应标签', () => {
    const webContents = makeWebContents()
    const { sessionId } = connect(PROFILE, webContents as never)
    const client = FakeClient.instances[0]
    client.emit('ready')

    const second = openShell(sessionId, webContents as never)
    expect(second).toBeDefined()

    webContents.send.mockClear()
    expect(closeShell(sessionId, second!.shellId)).toBe(true)

    expect(webContents.send).toHaveBeenCalledWith('ssh:shell-status', {
      sessionId,
      shellId: second!.shellId,
      status: 'closed'
    })
    expect(webContents.send).toHaveBeenCalledTimes(1)

    // channel.close() 后底层仍可能异步发出 close;不能重复添加/移除状态。
    client.streams[1].emit('close')
    expect(webContents.send).toHaveBeenCalledTimes(1)
  })
})
