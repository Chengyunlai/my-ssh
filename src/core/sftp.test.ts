import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { getClient, whenReady } = vi.hoisted(() => ({
  getClient: vi.fn(),
  whenReady: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh', () => ({ getClient, whenReady, addOnSessionClosed: () => () => {} }))

import { closeSftp, read, download, upload } from './sftp'

interface FakeStream extends EventEmitter {
  destroy: ReturnType<typeof vi.fn>
}

interface FakeSftp {
  stat: ReturnType<typeof vi.fn>
  createReadStream: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  fastGet: ReturnType<typeof vi.fn>
  fastPut: ReturnType<typeof vi.fn>
  ext_openssh_rename: ReturnType<typeof vi.fn>
  rename: ReturnType<typeof vi.fn>
  unlink: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setstat: ReturnType<typeof vi.fn>
}

function createWebContents(): { isDisposed: () => boolean; send: ReturnType<typeof vi.fn> } {
  return { isDisposed: () => false, send: vi.fn() }
}

function setupSftp(): FakeSftp {
  const sftp: FakeSftp = {
    stat: vi.fn((_path: string, callback: (error: Error) => void) => callback(Object.assign(new Error('not found'), { code: 2 }))),
    createReadStream: vi.fn(),
    open: vi.fn((_path: string, _flags: string, _mode: number, callback: (err: null, handle: Buffer) => void) => callback(null, Buffer.from('handle'))),
    close: vi.fn((_handle: Buffer, callback: () => void) => callback()),
    setstat: vi.fn((_path: string, _attrs: unknown, callback: () => void) => callback()),
    end: vi.fn(), fastGet: vi.fn(), fastPut: vi.fn(), ext_openssh_rename: vi.fn(), rename: vi.fn(), unlink: vi.fn((_p: string, callback: () => void) => callback())
  }
  getClient.mockReturnValue({
    sftp: (callback: (err: Error | undefined, value?: FakeSftp) => void) => callback(undefined, sftp)
  })
  return sftp
}

const uploadDirectories: string[] = []
function localUpload(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-upload-test-'))
  uploadDirectories.push(directory)
  const filename = path.join(directory, 'file.txt')
  fs.writeFileSync(filename, 'fixture upload', { mode: 0o640 })
  return filename
}

afterEach(() => {
  for (const directory of uploadDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
  closeSftp('fresh-cache-test')
  closeSftp('transfer-test')
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


describe('staged SFTP transfers', () => {
  it('keeps existing download targets on failure and commits successful downloads', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-transfer-'))
    const target = path.join(directory, 'existing.txt')
    const sftp = setupSftp()
    const host = createWebContents()
    try {
      fs.writeFileSync(target, 'original')
      const originalMode = fs.statSync(target).mode & 0o777
      sftp.fastGet.mockImplementation((_remote: string, temporary: string, _opts: unknown, done: (err?: Error) => void) => {
        if (process.platform !== 'win32') expect(fs.statSync(temporary).mode & 0o777).toBe(0o600)
        fs.writeFileSync(temporary, 'partial')
        done(new Error('fixture transfer failure'))
      })
      const failed = download('transfer-test', '/file.txt', target, host as never)
      await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith('sftp:done', { transferId: failed.transferId, error: 'fixture transfer failure' }))
      expect(fs.readFileSync(target, 'utf8')).toBe('original')
      expect(fs.readdirSync(directory)).toEqual(['existing.txt'])
      sftp.fastGet.mockImplementation((_remote: string, temporary: string, _opts: unknown, done: () => void) => {
        fs.writeFileSync(temporary, 'complete')
        done()
      })
      const success = download('transfer-test', '/file.txt', target, host as never)
      await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith('sftp:done', { transferId: success.transferId, error: undefined }))
      expect(fs.readFileSync(target, 'utf8')).toBe('complete')
      if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(originalMode)
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects an overwrite when it cannot preserve the original remote metadata', async () => {
    const sftp = setupSftp()
    const host = createWebContents()
    sftp.stat.mockImplementation((_path: string, done: (err: null, attrs: { mode: number; uid: number; gid: number }) => void) => done(null, { mode: 0o100640, uid: 1000, gid: 1000 }))
    sftp.fastPut.mockImplementation((_local: string, _temp: string, _opts: unknown, done: () => void) => done())
    sftp.setstat.mockImplementation((_path: string, _attrs: unknown, done: (error: Error) => void) => done(new Error('permission denied')))
    const failed = upload('transfer-test', localUpload(), '/remote.txt', host as never)
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith('sftp:done', { transferId: failed.transferId, error: 'permission denied' }))
    expect(sftp.rename).not.toHaveBeenCalled()
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled()
    expect(sftp.unlink.mock.calls.every(([target]) => target !== '/remote.txt')).toBe(true)
  })

  it('does not delete remote targets on failed uploads or unsupported overwrite', async () => {
    const sftp = setupSftp()
    const host = createWebContents()
    sftp.fastPut.mockImplementation((_local: string, _temp: string, _opts: unknown, done: (err?: Error) => void) => done(new Error('upload failure')))
    const failed = upload('transfer-test', localUpload(), '/remote.txt', host as never)
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith('sftp:done', { transferId: failed.transferId, error: 'upload failure' }))
    expect(sftp.unlink.mock.calls[0][0]).not.toBe('/remote.txt')
    sftp.fastPut.mockImplementation((_local: string, _temp: string, _opts: unknown, done: () => void) => done())
    sftp.ext_openssh_rename.mockImplementation(() => { throw new Error('Server does not support this extended request') })
    sftp.rename.mockImplementation((_from: string, _to: string, done: (err?: Error) => void) => done(new Error('target exists')))
    const unsupported = upload('transfer-test', localUpload(), '/remote.txt', host as never)
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith('sftp:done', { transferId: unsupported.transferId, error: 'target exists' }))
    expect(sftp.unlink.mock.calls.every(([target]) => target !== '/remote.txt')).toBe(true)
  })
})


describe('fresh preview before writing edited text', () => {
  it('bypasses cached text even when size and mtime are unchanged', async () => {
    const sftp = setupSftp()
    let text = 'old'
    sftp.stat.mockImplementation((_path: string, done: (err: null, stat: { size: number; mtime: number }) => void) => done(null, { size: 3, mtime: 1 }))
    sftp.createReadStream.mockImplementation(() => Readable.from([Buffer.from(text)]))
    const host = createWebContents()
    expect((await read('fresh-cache-test', '/file.txt', host as never)).content).toBe('old')
    text = 'new'
    expect((await read('fresh-cache-test', '/file.txt', host as never)).content).toBe('old')
    expect((await read('fresh-cache-test', '/file.txt', host as never, { fresh: true })).content).toBe('new')
    expect(sftp.createReadStream).toHaveBeenCalledTimes(2)
  })
})
