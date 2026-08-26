import type {
  SystemMetricsErrorCode,
  SystemMetricsResult,
  SystemMetricsSnapshot
} from '@shared/types'
import { parseSystemMetrics } from '../shared/system-metrics'
import {
  addOnSessionClosed,
  execCommand,
  type ExecCommandError,
  type ExecCommandResult
} from './ssh'

const SAMPLE_INTERVAL_MS = 1_500
const SAMPLE_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 256 * 1024

/** 固定、无用户输入的 Linux 指标采集脚本;不分配 PTY,不暴露给 renderer。 */
export const METRICS_COMMAND = [
  'LC_ALL=C; if [ ! -r /proc/stat ] || [ ! -r /proc/loadavg ] || [ ! -r /proc/meminfo ] || [ ! -r /proc/net/dev ] || [ ! -r /proc/uptime ] || ! command -v df >/dev/null 2>&1; then printf "MYSSH_METRICS_UNSUPPORTED\\n"; exit 78; fi',
  'printf "MYSSH_METRICS_V1\\n"',
  'printf "[stat]\\n"; cat /proc/stat',
  'printf "[loadavg]\\n"; cat /proc/loadavg',
  'printf "[meminfo]\\n"; cat /proc/meminfo',
  'printf "[netdev]\\n"; cat /proc/net/dev',
  'printf "[df]\\n"; df -P -k 2>/dev/null',
  'printf "[uptime]\\n"; cat /proc/uptime',
  'printf "END\\n"'
].join('; ')

interface SessionMetricState {
  lastRequestedAt: number
  inFlight: boolean
  previousCpu?: { total: number; idle: number }
}

const states = new Map<string, SessionMetricState>()
const removeCloseHook = addOnSessionClosed((sessionId) => states.delete(sessionId))

function error(code: SystemMetricsErrorCode, message: string, retryAfterMs?: number): SystemMetricsResult {
  return { ok: false, error: { code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } }
}

function mapExecError(err: unknown): SystemMetricsResult {
  const execError = err as Partial<ExecCommandError> & { code?: string }
  switch (execError.code) {
    case 'session-not-found':
      return error('session-not-found', execError.message ?? 'SSH 会话不存在,请先连接')
    case 'not-ready':
      return error('not-ready', execError.message ?? 'SSH 会话尚未就绪')
    case 'timeout':
      return error('timeout', execError.message ?? '远程指标采集超时')
    case 'output-limit':
      return error('output-limit', execError.message ?? '远程指标采集输出超过大小限制')
    default:
      return error('remote-error', execError.message ?? '远程指标采集失败')
  }
}

function parseResult(state: SessionMetricState, result: ExecCommandResult): SystemMetricsResult {
  if (result.stdout.includes('MYSSH_METRICS_UNSUPPORTED')) {
    return error('unsupported', '远端不是受支持的 Linux 主机或缺少 /proc、df 能力')
  }
  if (result.exitCode !== null && result.exitCode !== 0) {
    // Windows 默认 shell 可能无法执行 POSIX 固定脚本,此时没有结构化 stdout;
    // 将其归类为“不支持”而不是把 shell 语法错误展示成采集故障。
    if (result.stdout.trim() === '') {
      return error('unsupported', '远端不是受支持的 Linux 主机或缺少 /proc、df 能力')
    }
    return error('remote-error', result.stderr.trim() || `远程采集命令退出码 ${result.exitCode}`)
  }
  try {
    const parsed = parseSystemMetrics(result.stdout, Date.now(), state.previousCpu)
    state.previousCpu = parsed.cpuCounters
    const { cpuCounters: _cpuCounters, ...snapshot } = parsed
    return { ok: true, snapshot: snapshot as SystemMetricsSnapshot }
  } catch (err) {
    return error('parse-error', err instanceof Error ? err.message : '远程指标解析失败')
  }
}

export async function getSnapshot(sessionId: string): Promise<SystemMetricsResult> {
  const now = Date.now()
  const state = states.get(sessionId) ?? { lastRequestedAt: 0, inFlight: false }
  states.set(sessionId, state)
  if (state.inFlight) return error('busy', '已有指标采集正在进行')
  const elapsed = now - state.lastRequestedAt
  if (state.lastRequestedAt > 0 && elapsed < SAMPLE_INTERVAL_MS) {
    return error('rate-limited', '采样请求过于频繁', SAMPLE_INTERVAL_MS - elapsed)
  }
  state.lastRequestedAt = now
  state.inFlight = true
  try {
    const result = await execCommand(sessionId, METRICS_COMMAND, {
      timeoutMs: SAMPLE_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    })
    return parseResult(state, result)
  } catch (err) {
    const mapped = mapExecError(err)
    if (!mapped.ok && mapped.error.code === 'session-not-found') states.delete(sessionId)
    return mapped
  } finally {
    state.inFlight = false
  }
}

export function clearSession(sessionId: string): void {
  states.delete(sessionId)
}

export function dispose(): void {
  removeCloseHook()
  states.clear()
}
