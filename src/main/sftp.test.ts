import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { getClient, whenReady } = vi.hoisted(() => ({
  getClient: vi.fn(),
  whenReady: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))
vi.mock('./ssh', () => ({ getClient, whenReady }))

import { closeSftp, read } from './sftp'

interface FakeStream extends EventEmitter {
  destroy: ReturnType<typeof vi.fn>
}

interface FakeSftp {
  stat: ReturnType<typeof vi.fn>
  createReadStream: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

function createWebContents(): { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } {
  return { isDestroyed: () => false, send: vi.fn() }
}

function setupSftp(): FakeSftp {
  const sftp: FakeSftp = {
    stat: vi.fn(),
    createReadStream: vi.fn(),
    end: vi.fn()
  }
  getClient.mockReturnValue({
    sftp: (callback: (err: Error | undefined, value?: FakeSftp) => void) => callback(undefined, sftp)
  })
  return sftp
}

afterEach(() => {
  closeSftp('sftp-timeout-test')
  closeSftp('sftp-stream-timeout-test')
  getClient.mockReset()
  whenReady.mockReset().mockResolvedValue(undefined)
  vi.useRealTimers()
})

describe('SFTP preview timeouts', () => {
  it('rejects when remote stat does not respond before the operation timeout', async () => {
    const sftp = setupSftp()
    sftp.stat.mockImplementation(() => {})
    vi.useFakeTimers()

    const pending = read('sftp-timeout-test', '/tmp/file.txt', createWebContents() as never)
    const assertion = expect(pending).rejects.toThrow('预览操作超时')
    await vi.advanceTimersByTimeAsync(20_001)

    await assertion
  })

  it('destroys a stalled read stream when the read timeout expires', async () => {
    const sftp = setupSftp()
    sftp.stat.mockImplementation((_path: string, callback: (err: null, value: { size: number; mtime: number }) => void) =>
      callback(null, { size: 5, mtime: 1 })
    )
    const stream = new EventEmitter() as FakeStream
    stream.destroy = vi.fn()
    sftp.createReadStream.mockReturnValue(stream)
    vi.useFakeTimers()

    const pending = read('sftp-stream-timeout-test', '/tmp/file.txt', createWebContents() as never)
    const assertion = expect(pending).rejects.toThrow('预览读取超时')
    await vi.advanceTimersByTimeAsync(15_001)

    await assertion
    expect(stream.destroy).toHaveBeenCalled()
  })
})
