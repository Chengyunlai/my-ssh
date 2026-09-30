import type { ServiceScanErrorCode, ServiceScanResult } from '@shared/types'
import { buildScanSnapshot } from '../shared/entrance'
import { NETLIST_MAX_OUTPUT_BYTES, NETLIST_MIN_RESCAN_MS, NETLIST_TIMEOUT_MS, NETLIST_COMMAND } from '../shared/netlist'
import {
  addOnSessionClosed,
  execCommand,
  type ExecCommandError,
  type ExecCommandResult
} from './ssh'

/**
 * 固定、无用户输入的监听端口采集脚本;不分配 PTY,不暴露给 renderer。
 * 定义在 shared 层是为了让解析规则与采集脚本同源 —— 改了脚本必须同步改解析器。
 */
export const SERVICE_SCAN_COMMAND = NETLIST_COMMAND

interface SessionScanState {
  lastRequestedAt: number
  inFlight: boolean
}

const states = new Map<string, SessionScanState>()
const removeCloseHook = addOnSessionClosed((sessionId) => states.delete(sessionId))

function error(code: ServiceScanErrorCode, message: string, retryAfterMs?: number): ServiceScanResult {
  return { ok: false, error: { code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } }
}

function mapExecError(err: unknown): ServiceScanResult {
  const execError = err as Partial<ExecCommandError> & { code?: string }
  switch (execError.code) {
    case 'session-not-found':
      return error('session-not-found', execError.message ?? 'SSH 会话不存在,请先连接')
    case 'not-ready':
      return error('not-ready', execError.message ?? 'SSH 会话尚未就绪')
    case 'timeout':
      return error('timeout', execError.message ?? '远程端口扫描超时')
    case 'output-limit':
      return error('output-limit', execError.message ?? '远程端口清单超过大小限制')
    default:
      return error('remote-error', execError.message ?? '远程端口扫描失败')
  }
}

/**
 * nodeId 只影响服务 id 的前缀,不参与解析。
 * 这里用 sessionId —— 它在本进程内唯一,且不做任何远端标识推断。
 */
function parseResult(sessionId: string, result: ExecCommandResult): ServiceScanResult {
  if (result.stdout.includes('MYSSH_NETLIST_UNSUPPORTED')) {
    return error('unsupported', '远端既没有 ss 也读不到 /proc/net/tcp,无法发现端口')
  }
  if (result.exitCode !== null && result.exitCode !== 0) {
    // Windows 默认 shell 可能无法执行 POSIX 固定脚本,此时没有结构化 stdout;
    // 将其归类为“不支持”而不是把 shell 语法错误展示成扫描故障。
    if (result.stdout.trim() === '') {
      return error('unsupported', '远端不是受支持的 Linux 主机')
    }
    return error('remote-error', result.stderr.trim() || `远程扫描命令退出码 ${result.exitCode}`)
  }

  try {
    const now = Date.now()
    // 解析与归约全在 shared 层的纯函数里：测试跑的就是这里跑的那一份
    const snapshot = buildScanSnapshot(result.stdout, { nodeId: sessionId, now })
    if (!snapshot) {
      return error('unsupported', '远端既没有 ss 也读不到 /proc/net/tcp,无法发现端口')
    }
    return { ok: true, snapshot }
  } catch (err) {
    return error('parse-error', err instanceof Error ? err.message : '远程端口清单解析失败')
  }
}

export async function scanServices(sessionId: string): Promise<ServiceScanResult> {
  const now = Date.now()
  const state = states.get(sessionId) ?? { lastRequestedAt: 0, inFlight: false }
  states.set(sessionId, state)
  if (state.inFlight) return error('busy', '已有端口扫描正在进行')
  const elapsed = now - state.lastRequestedAt
  if (state.lastRequestedAt > 0 && elapsed < NETLIST_MIN_RESCAN_MS) {
    return error('rate-limited', '扫描请求过于频繁', NETLIST_MIN_RESCAN_MS - elapsed)
  }
  state.lastRequestedAt = now
  state.inFlight = true
  try {
    const result = await execCommand(sessionId, SERVICE_SCAN_COMMAND, {
      timeoutMs: NETLIST_TIMEOUT_MS,
      maxOutputBytes: NETLIST_MAX_OUTPUT_BYTES
    })
    return parseResult(sessionId, result)
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
