import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Client, type ClientChannel } from 'ssh2'
import type { Profile, SessionStatus } from '@shared/types'
import type { WebContents } from 'electron'
import { logError } from './logger'

interface Session {
  client: Client
  sessionId: string
  streams: Map<string, ClientChannel>
  /** 同一 SSH 连接内 shell 计数,用于生成可读名称(终端 1 / 终端 2 …) */
  shellSeq: number
  /** 每个 shell 独立的 cwd */
  cwds: Map<string, string>
  ready: boolean
}

const sessions = new Map<string, Session>()

const OSC7_RE = /\x1b\]7;file:\/\/[^\x07]*\x07/g

const INJECT_SCRIPT =
  'if [ -n "$BASH_VERSION" ]; then __myssh_cwd(){ printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-}" "$PWD"; }; ' +
  'case ";$PROMPT_COMMAND;" in *";__myssh_cwd;"*) ;; *) PROMPT_COMMAND="__myssh_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}";; esac; ' +
  'elif [ -n "$ZSH_VERSION" ]; then __myssh_cwd(){ printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-}" "$PWD"; }; ' +
  'precmd_functions+=(__myssh_cwd); fi; __myssh_cwd'

/**
 * 隐藏注入脚本在终端里的回显:找到脚本文本后,连同所在整行一起删除。
 * 在脚本出现前,持有未完成的末尾行,避免提示符残留。
 */
class StreamCleaner {
  private target: string
  private sawTarget = false
  private tail = ''

  constructor(target: string) {
    this.target = target
  }

  push(chunk: string): string {
    if (!this.target) return chunk
    const data = this.tail + chunk
    this.tail = ''

    let cursor = 0
    let out = ''

    while (true) {
      const idx = data.indexOf(this.target, cursor)
      if (idx === -1) break
      const before = data.slice(cursor, idx)
      if (!this.sawTarget) {
        // 第一次命中:连同目标行行首(提示符)一起丢弃
        const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1
        out += before.slice(0, lineStart)
      } else {
        out += before
      }
      const after = data.slice(idx + this.target.length)
      const nl = after.match(/^\r?\n/)
      cursor = idx + this.target.length + (nl ? nl[0].length : 0)
      this.sawTarget = true
    }

    const tail = data.slice(cursor)
    if (!this.sawTarget) {
      const lastNl = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r'))
      if (lastNl >= 0) {
        this.tail = tail.slice(lastNl + 1)
        out += tail.slice(0, lastNl + 1)
      } else {
        this.tail = tail
      }
    } else {
      const maxKeep = Math.min(this.target.length - 1, tail.length)
      let overlap = 0
      for (let k = 1; k <= maxKeep; k++) {
        if (this.target.startsWith(tail.slice(tail.length - k))) overlap = k
      }
      if (overlap > 0) {
        this.tail = tail.slice(tail.length - overlap)
        out += tail.slice(0, tail.length - overlap)
      } else {
        out += tail
      }
    }
    return out
  }

  deactivate(): string {
    this.target = ''
    const t = this.tail
    this.tail = ''
    return t
  }
}

/** 返回指定 shell 当前解析到的目录;尚未收到 OSC 7 时返回 null */
export function getCwd(sessionId: string, shellId = 'main'): string | null {
  return sessions.get(sessionId)?.cwds.get(shellId) ?? null
}

/** 等待 SSH 会话完全就绪(handshake 完成),避免在 ready 前打开通道 */
export function whenReady(sessionId: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const session = sessions.get(sessionId)
    if (!session) {
      reject(new Error('SSH 会话不存在,请先连接'))
      return
    }
    if (session.ready) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      session.client.off('ready', onReady)
      session.client.off('close', onClose)
      reject(new Error('SSH 连接超时'))
    }, timeoutMs)
    const onReady = (): void => {
      clearTimeout(timer)
      session.client.off('close', onClose)
      resolve()
    }
    const onClose = (): void => {
      clearTimeout(timer)
      session.client.off('ready', onReady)
      reject(new Error('SSH 连接已关闭'))
    }
    session.client.once('ready', onReady)
    session.client.once('close', onClose)
  })
}

let closedHook: ((sessionId: string) => void) | undefined

export function setOnSessionClosed(cb: (sessionId: string) => void): void {
  closedHook = cb
}

export function getClient(sessionId: string): Client | undefined {
  return sessions.get(sessionId)?.client
}

function cleanup(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    for (const stream of session.streams.values()) stream.end()
    session.client.end()
    sessions.delete(sessionId)
    closedHook?.(sessionId)
  }
}

export function disconnectAll(): void {
  for (const id of [...sessions.keys()]) cleanup(id)
}

/**
 * 为已有 SSH 会话开一个新的 shell 通道,返回 shellId。
 * 每个 shell 拥有独立的 xterm 实例、输出流和 cwd。
 */
export function openShell(
  sessionId: string,
  webContents: WebContents,
  cols = 80,
  rows = 24
): { shellId: string } | undefined {
  const session = sessions.get(sessionId)
  if (!session || !session.ready) return undefined
  const shellId = randomUUID()
  session.shellSeq++
  setupShell(session, shellId, webContents, cols, rows, session.shellSeq)
  return { shellId }
}

/**
 * 关闭指定 shell。若已是最后一个 shell,则断开整个 SSH 会话。
 * 返回 false 表示 shellId 无效。
 */
export function closeShell(sessionId: string, shellId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  const stream = session.streams.get(shellId)
  if (!stream) return false
  if (session.streams.size <= 1) {
    cleanup(sessionId)
    return true
  }
  removeShell(session, shellId)
  return true
}

/** 从 session 中摘除单个 shell,不影响 SSH 连接 */
function removeShell(session: Session, shellId: string): void {
  const stream = session.streams.get(shellId)
  if (!stream) return
  stream.end()
  session.streams.delete(shellId)
  session.cwds.delete(shellId)
}

/**
 * 单遍扫描:剔除 OSC 7 序列并解析最新 cwd。
 * 旧实现 matchAll + replace 对全文扫两遍,大流量下每 chunk 多付一倍正则成本。
 */
function stripOsc7(text: string): { out: string; cwd: string | undefined } {
  let cwd: string | undefined
  let lastEnd = 0
  let out = ''
  let m: RegExpExecArray | null
  OSC7_RE.lastIndex = 0
  while ((m = OSC7_RE.exec(text)) !== null) {
    out += text.slice(lastEnd, m.index)
    lastEnd = m.index + m[0].length
    const payload = m[0].slice(4, -1)
    const pm = /^file:\/\/[^/]*(.*)$/.exec(payload)
    if (pm) {
      try {
        cwd = decodeURIComponent(pm[1])
      } catch {
        cwd = pm[1]
      }
    }
  }
  if (lastEnd === 0) return { out: text, cwd: undefined }
  out += text.slice(lastEnd)
  return { out, cwd }
}

/**
 * 每 shell 输出聚合器:自适应批量化 IPC。
 * 首条立即发送(打字回显零新增延迟);紧随其后的 chunk 合并进 8ms 窗口,
 * 大流量时把每秒数百次 IPC 压到 ~125 次,显著降低结构化克隆与派发开销。
 */
class OutputBatcher {
  private buf: string[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly send: (data: string) => void
  ) {}

  push(text: string): void {
    this.buf.push(text)
    if (this.timer) return
    // 首条:立即发,同时开窗合并后续
    this.flush()
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 8)
  }

  flush(): void {
    if (this.buf.length === 0) return
    const data = this.buf.length === 1 ? this.buf[0] : this.buf.join('')
    this.buf.length = 0
    this.send(data)
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}

/** 为 stream 绑定输出处理、注入脚本、cwd 解析和关闭处理 */
function setupShell(
  session: Session,
  shellId: string,
  webContents: WebContents,
  cols: number,
  rows: number,
  shellSeq: number
): void {
  const sessionId = session.sessionId
  session.shellSeq = shellSeq

  session.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
    if (err) {
      webContents.send('ssh:shell-status', { sessionId, shellId, status: 'error', message: err.message })
      return
    }
    session.streams.set(shellId, stream)

    webContents.send('ssh:shell-status', { sessionId, shellId, status: 'connected', name: `终端 ${shellSeq}` })

    const batcher = new OutputBatcher((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send('ssh:output', { sessionId, shellId, data })
      }
    })
    const cleaner = new StreamCleaner(INJECT_SCRIPT)
    let oscPending = ''
    stream.on('data', (data: Buffer) => {
      let text = cleaner.push(data.toString('utf-8'))
      if (text) {
        text = oscPending + text
        oscPending = ''
        const { out, cwd } = stripOsc7(text)
        if (cwd) session.cwds.set(shellId, cwd)
        let forward = out
        const lastOsc = forward.lastIndexOf('\x1b]')
        if (lastOsc !== -1 && !forward.slice(lastOsc).includes('\x07')) {
          oscPending = forward.slice(lastOsc)
          forward = forward.slice(0, lastOsc)
        }
        if (forward) batcher.push(forward)
      }
    })
    const flushTimer = setTimeout(() => {
      const extra = cleaner.deactivate()
      if (extra) batcher.push(extra)
    }, 2500)
    stream.on('close', () => clearTimeout(flushTimer))
    stream.write(`${INJECT_SCRIPT}\r`)

    stream.on('close', () => {
      batcher.dispose()
      if (!sessions.has(sessionId)) return
      removeShell(session, shellId)
      webContents.send('ssh:shell-status', { sessionId, shellId, status: 'closed' })
      // 所有 shell 都关闭 = 会话结束
      if (session.streams.size === 0) {
        send(webContents, { sessionId, status: 'disconnected' })
        cleanup(sessionId)
      }
    })
    stream.on('error', (e: Error) => webContents.send('ssh:shell-status', { sessionId, shellId, status: 'error', message: e.message }))
  })
}

function send(webContents: WebContents, status: SessionStatus): void {
  if (!webContents.isDestroyed()) {
    webContents.send('ssh:status', status)
  }
}

export function connect(profile: Profile, webContents: WebContents): { sessionId: string } {
  const sessionId = randomUUID()
  const client = new Client()
  const session: Session = { client, sessionId, streams: new Map(), shellSeq: 0, cwds: new Map(), ready: false }
  sessions.set(sessionId, session)

  // 连接阶段进度:TCP -> 握手 -> 认证 -> 建立会话
  const sendProgress = (percent: number): void => {
    if (!webContents.isDestroyed()) webContents.send('ssh:progress', { sessionId, percent })
  }

  send(webContents, { sessionId, status: 'connecting' })
  sendProgress(8)

  client.on('connect', () => sendProgress(30))
  client.on('handshake', () => sendProgress(60))

  client.on('ready', () => {
    session.ready = true
    sendProgress(85)
    setupShell(session, 'main', webContents, 80, 24, 1)
    sendProgress(100)
    send(webContents, { sessionId, status: 'connected' })
  })

  client.on('error', (err) => {
    logError(
      'ssh',
      `连接失败 ${profile.username}@${profile.host}:${profile.port}`,
      err.message
    )
    send(webContents, { sessionId, status: 'error', message: err.message })
    cleanup(sessionId)
  })
  client.on('close', () => cleanup(sessionId))

  const options: Record<string, unknown> = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 10_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3
  }

  if (profile.authType === 'password') {
    options.password = profile.password
  } else {
    options.privateKey = fs.readFileSync(profile.keyPath ?? '')
    if (profile.passphrase) options.passphrase = profile.passphrase
  }

  client.connect(options)
  return { sessionId }
}

export interface TestConnectionResult {
  ok: boolean
  /** 失败时的错误信息(便于复制后提 issue) */
  message?: string
}

/** 仅测试连接与认证:成功即断开,不创建会话 */
export function testConnect(profile: Profile, webContents: WebContents): Promise<TestConnectionResult> {
  return new Promise((resolve) => {
    const client = new Client()
    const sendProgress = (percent: number): void => {
      if (!webContents.isDestroyed()) webContents.send('ssh:progress', { percent })
    }
    const done = (result: TestConnectionResult): void => {
      client.end()
      resolve(result)
    }
    const timer = setTimeout(() => {
      logError('ssh', `测试连接超时 ${profile.username}@${profile.host}:${profile.port}`)
      done({ ok: false, message: '连接超时(15 秒)' })
    }, 15_000)
    sendProgress(10)
    client.on('connect', () => sendProgress(35))
    client.on('handshake', () => sendProgress(65))
    client.on('ready', () => {
      clearTimeout(timer)
      sendProgress(100)
      done({ ok: true })
    })
    client.on('error', (err) => {
      clearTimeout(timer)
      logError(
        'ssh',
        `测试连接失败 ${profile.username}@${profile.host}:${profile.port}`,
        err.message
      )
      done({ ok: false, message: err.message })
    })

    const options: Record<string, unknown> = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: 10_000
    }
    if (profile.authType === 'password') {
      options.password = profile.password
    } else {
      try {
        options.privateKey = fs.readFileSync(profile.keyPath ?? '')
      } catch (err) {
        clearTimeout(timer)
        done({ ok: false, message: `无法读取私钥文件: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      if (profile.passphrase) options.passphrase = profile.passphrase
    }
    client.connect(options)
  })
}

export function sendData(sessionId: string, shellId: string, data: string): void {
  sessions.get(sessionId)?.streams.get(shellId)?.write(data)
}

export function resize(sessionId: string, shellId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.streams.get(shellId)?.setWindow(rows, cols, 0, 0)
}

export function disconnect(sessionId: string): void {
  cleanup(sessionId)
}
