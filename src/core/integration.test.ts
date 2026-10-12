import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { createCore, type MySshCore } from './index'
import { startFixture } from '../../examples/stage-01-core-tui/core/server.mjs'

function nextShell(core: MySshCore, action: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('shell timeout')) }, 5000)
    const unsubscribe = core.events.on('ssh:shell-status', (status) => {
      if (status.status === 'connected') { clearTimeout(timer); unsubscribe(); resolve(status.shellId) }
    })
    action()
  })
}

function transfer(core: MySshCore, action: () => { transferId: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('transfer timeout')) }, 5000)
    const unsubscribe = core.events.on('sftp:done', (status) => {
      if (status.transferId !== id) return
      clearTimeout(timer); unsubscribe()
      if (status.error) reject(new Error(status.error))
      else resolve()
    })
    const id = action().transferId
  })
}

describe('public core against local SSH/SFTP fixture', () => {
  it('runs shell, multi-shell, file CRUD, transfers, monitor and services through the public API', async () => {
    const fixture = await startFixture()
    const core = createCore()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-core-e2e-'))
    let sessionId = ''
    try {
      let output = ''
      const received = new Promise<void>((resolve) => core.events.on('ssh:output', (event) => {
        output += event.data
        if (output.includes('CORE_OK 你好')) resolve()
      }))
      const sendImmediately = core.events.on('ssh:shell-status', (status) => {
        if (status.status === 'connected') core.ssh.sendData(sessionId, status.shellId, 'hello\r')
      })
      const main = await nextShell(core, () => { sessionId = core.ssh.connect(fixture.profile).sessionId })
      await core.ssh.whenReady(sessionId)
      await received
      sendImmediately()
      expect(output).not.toContain('�')
      const second = await nextShell(core, () => { core.ssh.openShell(sessionId, 100, 30) })
      expect(second).not.toBe(main)
      expect(core.ssh.closeShell(sessionId, second)).toBe(true)
      expect(await core.sftp.home(sessionId)).toBe('/home/demo')
      expect(await core.sftp.list(sessionId, '/home/demo')).toEqual([expect.objectContaining({ name: 'hello.txt', type: 'file' })])
      expect(await core.sftp.read(sessionId, '/home/demo/hello.txt')).toMatchObject({ kind: 'text', content: 'Hello SFTP\n', truncated: false })
      await core.sftp.write(sessionId, '/home/demo/hello.txt', 'Updated\n')
      expect((await core.sftp.read(sessionId, '/home/demo/hello.txt')).content).toBe('Updated\n')
      await core.sftp.mkdir(sessionId, '/home/demo/uploads')
      const local = path.join(directory, 'upload.txt')
      fs.writeFileSync(local, 'upload payload')
      await transfer(core, () => core.sftp.upload(sessionId, local, '/home/demo/uploads/file.txt'))
      expect(fixture.files.get('/home/demo/uploads/file.txt')?.toString()).toBe('upload payload')
      expect(fixture.metadata.get('/home/demo/uploads/file.txt')?.mode).toBe(process.platform === 'win32' ? 0o644 : fs.statSync(local).mode & 0o777)
      fixture.metadata.set('/home/demo/uploads/file.txt', { mode: 0o100640, uid: 1000, gid: 1000 })
      fs.writeFileSync(local, 'updated payload')
      await transfer(core, () => core.sftp.upload(sessionId, local, '/home/demo/uploads/file.txt'))
      expect(fixture.metadata.get('/home/demo/uploads/file.txt')).toMatchObject({ mode: 0o640, uid: 1000, gid: 1000 })
      const downloaded = path.join(directory, 'download.txt')
      fs.writeFileSync(downloaded, 'previous local file')
      await transfer(core, () => core.sftp.download(sessionId, '/home/demo/uploads/file.txt', downloaded))
      expect(fs.readFileSync(downloaded, 'utf8')).toBe('updated payload')
      expect(fs.readdirSync(directory).some((name) => name.endsWith('.part'))).toBe(false)
      await core.sftp.remove(sessionId, '/home/demo/uploads', true)
      expect(await core.sftp.stat(sessionId, '/home/demo/uploads/file.txt')).toBe(false)
      const metrics = await core.monitor.getSnapshot(sessionId)
      expect(metrics).toMatchObject({ ok: true, snapshot: { platform: 'linux', uptimeSeconds: 3600 } })
      const services = await core.services.scan(sessionId)
      expect(services).toMatchObject({ ok: true, snapshot: { services: [expect.objectContaining({ port: 3000 })] } })
      core.ssh.disconnect(sessionId)
      expect(() => core.sftp.list(sessionId, '/home/demo')).toThrow('会话不存在')
    } finally {
      core.dispose()
      fs.rmSync(directory, { recursive: true, force: true })
      await fixture.close()
    }
  }, 20000)

  it('reports rejected authentication without creating a usable session', async () => {
    const fixture = await startFixture()
    const core = createCore()
    try {
      const result = await core.ssh.testConnect({ ...fixture.profile, password: 'incorrect-fixture-password' })
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/authentication/i)
    } finally { core.dispose(); await fixture.close() }
  })
})
