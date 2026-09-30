import { generateKeyPairSync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Server } from 'ssh2'
import { SS_EXPECTED, SS_OUTPUT } from '../../tests/fixtures/netlist-sample'
import { scanServices } from './service-scan'
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

/**
 * 起一个本地 ssh2 server。
 *
 * `respond` 决定 exec 请求返回什么：给定时返回固定内容（用来模拟一台远端 Linux），
 * 不给时把命令真的交给本机 /bin/sh 跑（用来验证脚本本身能被 POSIX shell 执行）。
 */
function createFixtureServer(respond?: (command: string) => { stdout: string; exitCode: number }) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  })

  const receivedCommands: string[] = []

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
            receivedCommands.push(info.command)

            if (respond) {
              const { stdout, exitCode } = respond(info.command)
              stream.write(stdout)
              stream.exit(exitCode)
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

  return { server, receivedCommands }
}

describe('端口发现端到端（本地 ssh2 夹具）', () => {
  it('把固定内省脚本真的发给远端，并对结果做分级结论', async () => {
    const { server, receivedCommands } = createFixtureServer()
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
      const result = await scanServices(sessionId)

      // 脚本必须原样送达，且是那一条固定脚本
      expect(receivedCommands).toHaveLength(1)
      expect(receivedCommands[0]).toContain('MYSSH_NETLIST_V1')
      expect(receivedCommands[0]).toContain('ss -H -tlnp')

      if (process.platform === 'linux') {
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.snapshot.counts.sockets).toBeGreaterThan(0)
          // 收敛链每一级都不该比上一级多
          expect(result.snapshot.counts.services).toBeLessThanOrEqual(result.snapshot.counts.sockets)
          expect(result.snapshot.counts.applications).toBeLessThanOrEqual(result.snapshot.counts.services)
        }
      } else {
        // macOS/Windows 上没有 ss 也读不到 /proc/net/tcp，必须如实报不支持，
        // 不能返回一张空清单让人以为这台机器什么都没监听。
        expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
      }
    } finally {
      if (sessionId) ssh.disconnect(sessionId)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30_000)

  it('远端是一台装了 ss 的 Linux 时，整条收敛链能从 SSH 通道另一头走通', async () => {
    // 固定返回一份合成 Linux 输出 —— 不依赖本机平台，任何机器上都能跑
    const { server } = createFixtureServer(() => ({ stdout: SS_OUTPUT, exitCode: 0 }))
    const port = await listen(server)
    const webContents = createWebContents()
    let sessionId: string | undefined

    try {
      sessionId = ssh.connect(
        {
          id: 'linux-fixture',
          name: 'linux fixture',
          host: '127.0.0.1',
          port,
          username: 'fixture',
          authType: 'password',
          password: 'fixture'
        },
        webContents as never
      ).sessionId
      await ssh.whenReady(sessionId)
      const result = await scanServices(sessionId)

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.snapshot.counts).toEqual({
        sockets: SS_EXPECTED.sockets,
        services: SS_EXPECTED.services,
        systemSockets: SS_EXPECTED.systemSockets,
        applications: SS_EXPECTED.applications,
        // 这份夹具没有 [nginxconf] 段（老格式输出），域名数就该是 0
        domains: 0
      })
      expect(result.snapshot.applications.map((a) => a.displayName)).toEqual([...SS_EXPECTED.apps])
      // 应用里必须带得动各自的服务，界面才可能「点一下就走」
      expect(result.snapshot.applications[0].services).toHaveLength(4)
      expect(result.snapshot.os?.prettyName).toBe('Ubuntu 24.04.4 LTS')
    } finally {
      if (sessionId) ssh.disconnect(sessionId)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30_000)
})
