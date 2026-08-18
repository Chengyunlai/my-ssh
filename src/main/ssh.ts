import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Client, type ClientChannel } from 'ssh2'
import type { Profile, SessionStatus } from '@shared/types'
import type { WebContents } from 'electron'

interface Session {
  client: Client
  sessionId: string
  stream?: ClientChannel
  cwd?: string
  ready: boolean
}

const sessions = new Map<string, Session>()

const OSC7_RE = /\x1b\]7;file:\/\/[^\x07]*\x07/g

const INJECT_SCRIPT =
  'if [ -n "$BASH_VERSION" ]; then __myssh_cwd(){ printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-}" "$PWD"; }; ' +
  'case ";$PROMPT_COMMAND;" in *";__myssh_cwd;"*) ;; *) PROMPT_COMMAND="__myssh_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}";; esac; ' +
  'elif [ -n "$ZSH_VERSION" ]; then __myssh_cwd(){ printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-}" "$PWD"; }; ' +
  'precmd_functions+=(__myssh_cwd); fi; __myssh_cwd'

/** 从输出流中解析 OSC 7 目录序列(file://host/path) */
function extractCwd(text: string): string | undefined {
  let last: string | undefined
  for (const m of text.matchAll(OSC7_RE)) last = m[0]
  if (!last) return undefined
  const payload = last.slice(4, -1)
  const m = /^file:\/\/[^/]*(.*)$/.exec(payload)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

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

/** 返回已解析到的终端当前目录;尚未收到 OSC 7 时返回 null(属正常竞态,不抛错) */
export function getCwd(sessionId: string): string | null {
  return sessions.get(sessionId)?.cwd ?? null
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
    session.stream?.end()
    session.client.end()
    sessions.delete(sessionId)
    closedHook?.(sessionId)
  }
}

export function disconnectAll(): void {
  for (const id of [...sessions.keys()]) cleanup(id)
}

export function connect(profile: Profile, webContents: WebContents): { sessionId: string } {
  const sessionId = randomUUID()
  const client = new Client()
  sessions.set(sessionId, { client, sessionId, ready: false })

  const send = (status: Omit<SessionStatus, 'sessionId'>): void => {
    if (!webContents.isDestroyed()) {
      webContents.send('ssh:status', { sessionId, ...status } satisfies SessionStatus)
    }
  }

  send({ status: 'connecting' })

  client.on('ready', () => {
    const session = sessions.get(sessionId)
    if (session) session.ready = true
    client.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        send({ status: 'error', message: err.message })
        cleanup(sessionId)
        return
      }
      const session = sessions.get(sessionId)
      if (session) session.stream = stream

      send({ status: 'connected' })

      const cleaner = new StreamCleaner(INJECT_SCRIPT)
      let oscPending = ''
      stream.on('data', (data: Buffer) => {
        let text = cleaner.push(data.toString('utf-8'))
        if (text) {
          text = oscPending + text
          oscPending = ''
          const cwd = extractCwd(text)
          if (cwd) sessions.get(sessionId)!.cwd = cwd
          let forward = text.replace(OSC7_RE, '')
          const lastOsc = forward.lastIndexOf('\x1b]')
          if (lastOsc !== -1 && !forward.slice(lastOsc).includes('\x07')) {
            oscPending = forward.slice(lastOsc)
            forward = forward.slice(0, lastOsc)
          }
          if (forward && !webContents.isDestroyed()) {
            webContents.send('ssh:output', sessionId, forward)
          }
        }
      })
      const flushTimer = setTimeout(() => {
        const extra = cleaner.deactivate()
        if (extra && !webContents.isDestroyed()) {
          webContents.send('ssh:output', sessionId, extra)
        }
      }, 2500)
      stream.on('close', () => clearTimeout(flushTimer))
      stream.write(`${INJECT_SCRIPT}\r`)

      stream.on('close', () => {
        send({ status: 'disconnected' })
        cleanup(sessionId)
      })
      stream.on('error', (e: Error) => send({ status: 'error', message: e.message }))
    })
  })

  client.on('error', (err) => {
    send({ status: 'error', message: err.message })
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

export function sendData(sessionId: string, data: string): void {
  sessions.get(sessionId)?.stream?.write(data)
}

export function resize(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.stream?.setWindow(rows, cols, 0, 0)
}

export function disconnect(sessionId: string): void {
  cleanup(sessionId)
}
