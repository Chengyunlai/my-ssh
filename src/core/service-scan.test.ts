import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROC_HEADER, PROC_ROWS, SS_EXPECTED, SS_OUTPUT } from '../../tests/fixtures/netlist-sample'

const { execCommand, addOnSessionClosed, getCloseCallback } = vi.hoisted(() => {
  let closeCallback: ((sessionId: string) => void) | undefined
  return {
    execCommand: vi.fn(),
    addOnSessionClosed: vi.fn((callback: (sessionId: string) => void) => {
      closeCallback = callback
      return () => {}
    }),
    getCloseCallback: () => closeCallback
  }
})

vi.mock('./ssh', () => ({ execCommand, addOnSessionClosed }))

import { clearSession, scanServices, SERVICE_SCAN_COMMAND } from './service-scan'

const SESSION = 'session-1'

function ok(stdout: string, exitCode: number | null = 0) {
  return { stdout, stderr: '', exitCode }
}

class FakeExecError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

beforeEach(() => {
  execCommand.mockReset()
  clearSession(SESSION)
})

describe('service-scan host API', () => {
  it('跑的是固定脚本，不接受任何用户输入', () => {
    // 脚本里不能有单引号：它要作为单个参数交给 SSH 下发
    expect(SERVICE_SCAN_COMMAND).not.toContain("'")
    expect(SERVICE_SCAN_COMMAND).toContain('MYSSH_NETLIST_V1')
    // 不分配 PTY、不落盘、不改远端状态
    expect(SERVICE_SCAN_COMMAND).toContain('ss -H -tlnp')
  })

  it('把监听记录收成服务与应用，并给出每一级的数量', async () => {
    execCommand.mockResolvedValue(ok(SS_OUTPUT))
    const result = await scanServices(SESSION)

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
    expect(result.snapshot.os?.prettyName).toBe('Ubuntu 24.04.4 LTS')
    expect(result.snapshot.elevated).toBe(true)
    expect(result.snapshot.warnings).toEqual([])
  })

  it('容器的多个宿主端口在结果里是一个应用', async () => {
    execCommand.mockResolvedValue(ok(SS_OUTPUT))
    const result = await scanServices(SESSION)
    if (!result.ok) throw new Error('expected ok')

    const panel = result.snapshot.applications.find((a) => a.id === 'container:panel')
    expect(panel?.ports).toEqual([8443, 8080, 30001, 30002])
    expect(panel?.kind).toBe('container')
  })

  it('远端报告不支持时归类为 unsupported，而不是空清单', async () => {
    execCommand.mockResolvedValue(ok('MYSSH_NETLIST_UNSUPPORTED\n', 78))
    const result = await scanServices(SESSION)
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })

  it('非 POSIX shell 报错（stdout 为空、退出码非 0）也归为不支持', async () => {
    execCommand.mockResolvedValue(ok('', 1))
    const result = await scanServices(SESSION)
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })

  it('退出码非 0 但有输出时按远端错误处理，并带上 stderr', async () => {
    execCommand.mockResolvedValue({ stdout: 'MYSSH_NETLIST_V1\n', stderr: 'boom', exitCode: 2 })
    const result = await scanServices(SESSION)
    expect(result).toMatchObject({ ok: false, error: { code: 'remote-error' } })
    if (!result.ok) expect(result.error.message).toBe('boom')
  })

  it('输出里带不支持标记时也拒绝解析成空清单', async () => {
    // 哨兵出现在 stdout 里但退出码是 0（比如远端 shell 包装了一层）
    execCommand.mockResolvedValue(ok('MYSSH_NETLIST_UNSUPPORTED\nEND\n', 0))
    const result = await scanServices(SESSION)
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })

  it('退化到 /proc 时仍给出端口，并把降级写进 warnings', async () => {
    execCommand.mockResolvedValue(ok([...PROC_HEADER, ...PROC_ROWS, 'END'].join('\n')))
    const result = await scanServices(SESSION)
    if (!result.ok) throw new Error('expected ok')

    // 关键：读不出来 ≠ 远端什么都没监听
    expect(result.snapshot.counts.services).toBe(2)
    expect(result.snapshot.warnings.some((w) => w.includes('退化到 /proc'))).toBe(true)
  })

  it('一端口没提权时提示可提权重扫，而不是当成没有服务', async () => {
    const noPrivilege = SS_OUTPUT.replace('sudo=1', 'sudo=0')
      .split('\n')
      .map((line) => line.replace(/\s+users:\(.*\)$/, ''))
      .join('\n')
    execCommand.mockResolvedValue(ok(noPrivilege))
    const result = await scanServices(SESSION)
    if (!result.ok) throw new Error('expected ok')

    expect(result.snapshot.elevated).toBe(false)
    expect(result.snapshot.counts.sockets).toBeGreaterThan(0)
    expect(result.snapshot.warnings.some((w) => w.includes('未取得 root 权限'))).toBe(true)
  })

  it('把 exec 层的错误码逐条映射出来', async () => {
    const cases = [
      ['session-not-found', 'session-not-found'],
      ['not-ready', 'not-ready'],
      ['timeout', 'timeout'],
      ['output-limit', 'output-limit'],
      ['remote-error', 'remote-error']
    ] as const
    for (const [execCode, expected] of cases) {
      clearSession(SESSION)
      execCommand.mockRejectedValueOnce(new FakeExecError(execCode, 'x'))
      const result = await scanServices(SESSION)
      expect(result, execCode).toMatchObject({ ok: false, error: { code: expected } })
    }
  })

  it('会话不存在时清掉本地状态', async () => {
    execCommand.mockRejectedValue(new FakeExecError('session-not-found', 'gone'))
    await scanServices(SESSION)
    // 清掉之后不该再被最小重扫间隔挡住
    execCommand.mockResolvedValue(ok(SS_OUTPUT))
    const again = await scanServices(SESSION)
    expect(again.ok).toBe(true)
  })

  it('最小重扫间隔内重复请求被限流，并告知还要等多久', async () => {
    execCommand.mockResolvedValue(ok(SS_OUTPUT))
    await scanServices(SESSION)
    const second = await scanServices(SESSION)
    expect(second).toMatchObject({ ok: false, error: { code: 'rate-limited' } })
    if (!second.ok) {
      expect(second.error.retryAfterMs).toBeGreaterThan(0)
      expect(second.error.retryAfterMs).toBeLessThanOrEqual(3_000)
    }
  })

  it('并发请求返回 busy，不会真的发两次命令', async () => {
    let release: (() => void) | undefined
    execCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(SS_OUTPUT))
        })
    )
    const first = scanServices(SESSION)
    const second = await scanServices(SESSION)
    expect(second).toMatchObject({ ok: false, error: { code: 'busy' } })
    release?.()
    expect((await first).ok).toBe(true)
    expect(execCommand).toHaveBeenCalledTimes(1)
  })

  it('会话关闭后清掉限流状态', async () => {
    execCommand.mockResolvedValue(ok(SS_OUTPUT))
    await scanServices(SESSION)
    getCloseCallback()?.(SESSION)
    const afterClose = await scanServices(SESSION)
    // 状态被清掉 => 不再被间隔挡住（是否会话还存在是 ssh 层的事）
    expect(execCommand).toHaveBeenCalledTimes(2)
    expect(afterClose.ok).toBe(true)
  })
})
