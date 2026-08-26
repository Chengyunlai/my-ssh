import { generateKeyPairSync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Server } from 'ssh2'
import { getSnapshot } from './monitor'
import * as ssh from './ssh'

const execFileAsync = promisify(execFile)

interface TestWebContents {
  isDestroyed(): boolean
  send: ReturnType<typeof vi.fn>
  once(event: string, callback: () => void): TestWebContents
}

function createWebContents(): TestWebContents {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
    once: () => createWebContents()
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试 SSH server 未分配端口')
  return address.port
}

describe('local SSH metrics end-to-end', () => {
  it('connects to a local ssh2 fixture and verifies the platform-specific result', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
    })
    const server = new Server({ hostKeys: [privateKey] }, (client) => {
      client
        .on('authentication', (ctx) => {
          if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'fixture') ctx.accept()
          else ctx.reject()
        })
        .on('ready', () => {
          client.on('session', (accept) => {
            const session = accept()
            session.on('shell', (acceptShell) => {
              const stream = acceptShell()
              stream.on('data', () => {})
            })
            session.on('exec', (acceptExec, _rejectExec, info) => {
              const stream = acceptExec()
              if (process.platform === 'win32') {
                stream.write('MYSSH_METRICS_UNSUPPORTED\n')
                stream.exit(78)
                stream.end()
                return
              }
              void execFileAsync('/bin/sh', ['-c', info.command], { maxBuffer: 1024 * 1024 })
                .then(({ stdout, stderr }) => {
                  if (stderr) stream.stderr.write(stderr)
                  if (stdout) stream.write(stdout)
                  stream.exit(0)
                  stream.end()
                })
                .catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }) => {
                  if (err.stderr) stream.stderr.write(err.stderr)
                  if (err.stdout) stream.write(err.stdout)
                  stream.exit(typeof err.code === 'number' ? err.code : 1)
                  stream.end()
                })
            })
          })
        })
    })
    const port = await listen(server)
    const webContents = createWebContents()
    let sessionId: string | undefined

    try {
      sessionId = ssh.connect(
        {
          id: 'local-fixture',
          name: 'local fixture',
          host: '127.0.0.1',
          port,
          username: 'fixture',
          authType: 'password',
          password: 'fixture'
        },
        webContents as never
      ).sessionId
      await ssh.whenReady(sessionId)
      const first = await getSnapshot(sessionId)

      if (process.platform === 'linux') {
        expect(first.ok).toBe(true)
      } else {
        expect(first).toMatchObject({ ok: false, error: { code: 'unsupported' } })
      }
      if (first.ok) {
        expect(first.snapshot.platform).toBe('linux')
        expect(first.snapshot.uptimeSeconds).toBeGreaterThan(0)
        expect(first.snapshot.memory.totalBytes).toBeGreaterThan(0)
        expect(first.snapshot.disks.length).toBeGreaterThan(0)
        expect(first.snapshot.network.length).toBeGreaterThan(0)
      }
    } finally {
      if (sessionId) ssh.disconnect(sessionId)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
