import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { getSnapshot, METRICS_COMMAND } from './monitor'

const OUTPUT = [
  'MYSSH_METRICS_V1',
  '[stat]',
  'cpu 10 0 10 80 0 0 0 0 0 0',
  '[loadavg]',
  '1 2 3 1/1 1',
  '[meminfo]',
  'MemTotal: 100 kB',
  'MemAvailable: 50 kB',
  'SwapTotal: 20 kB',
  'SwapFree: 10 kB',
  '[netdev]',
  'eth0: 1 0 0 0 0 0 0 0 2 0 0 0 0 0 0 0',
  '[df]',
  'Filesystem 1024-blocks Used Available Capacity Mounted on',
  '/dev/root 100 10 90 10% /',
  '[uptime]',
  '10 0',
  'END'
].join('\n')

describe('monitor host API', () => {
  beforeEach(() => {
    execCommand.mockReset()
    vi.useRealTimers()
  })

  it('uses a fixed command and returns structured snapshots', async () => {
    execCommand.mockResolvedValue({ stdout: OUTPUT, stderr: '', exitCode: 0 })

    const result = await getSnapshot('session-monitor-test')

    expect(result.ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith(
      'session-monitor-test',
      METRICS_COMMAND,
      { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 }
    )
    expect(METRICS_COMMAND).not.toContain('session-monitor-test')
  })

  it('rate limits repeated requests and maps timeout errors', async () => {
    execCommand.mockResolvedValue({ stdout: OUTPUT, stderr: '', exitCode: 0 })
    await getSnapshot('session-rate-test')
    const limited = await getSnapshot('session-rate-test')
    expect(limited).toMatchObject({ ok: false, error: { code: 'rate-limited' } })

    execCommand.mockRejectedValue({ code: 'timeout', message: 'timed out' })
    const timedOut = await getSnapshot('session-timeout-test')
    expect(timedOut).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  it('returns an explicit unsupported result for non-Linux hosts', async () => {
    execCommand.mockResolvedValue({
      stdout: 'MYSSH_METRICS_UNSUPPORTED\n',
      stderr: '',
      exitCode: 78
    })

    const result = await getSnapshot('session-unsupported-test')

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
  })

  it('maps output-limit errors and clears state when a session closes', async () => {
    execCommand.mockRejectedValueOnce({ code: 'output-limit', message: 'too much output' })
    const limited = await getSnapshot('session-output-limit-test')
    expect(limited).toMatchObject({ ok: false, error: { code: 'output-limit' } })

    execCommand.mockResolvedValue({ stdout: OUTPUT, stderr: '', exitCode: 0 })
    await getSnapshot('session-lifecycle-test')
    getCloseCallback()?.('session-lifecycle-test')
    await getSnapshot('session-lifecycle-test')
    expect(execCommand).toHaveBeenCalledTimes(3)
  })
})
