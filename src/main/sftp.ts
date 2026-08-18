import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Attributes, FileEntry, SFTPWrapper } from 'ssh2'
import type { WebContents } from 'electron'
import type { SftpEntry } from '@shared/types'
import { getClient, whenReady } from './ssh'

const channels = new Map<string, Promise<SFTPWrapper>>()
const transfers = new Set<string>()

/** 在线预览/编辑的读取上限:超过则截断读取并标记 */
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

function extOf(remotePath: string): string {
  const idx = remotePath.lastIndexOf('.')
  return idx === -1 ? '' : remotePath.slice(idx + 1).toLowerCase()
}

function entryType(attrs: Attributes): 'file' | 'dir' | 'link' {
  const typeBits = (attrs.mode ?? 0) & 0o170000
  if (typeBits === 0o040000) return 'dir'
  if (typeBits === 0o120000) return 'link'
  return 'file'
}

function send(webContents: WebContents, channel: string, payload: unknown): void {
  if (!webContents.isDestroyed()) webContents.send(channel, payload)
}

/**
 * 获取会话的 SFTP 通道。按 Promise 缓存,并发调用共享同一次 `client.sftp()`
 * (ssh2 每个 Client 只允许一个 SFTP 子系统);等连接 ready 后再打开,避免通道请求先于握手。
 */
function getSftp(sessionId: string): Promise<SFTPWrapper> {
  const existing = channels.get(sessionId)
  if (existing) return existing
  const client = getClient(sessionId)
  if (!client) return Promise.reject(new Error('SSH 会话不存在,请先连接'))
  let resolveOpen!: (s: SFTPWrapper) => void
  let rejectOpen!: (err: Error) => void
  const p = new Promise<SFTPWrapper>((resolve, reject) => {
    resolveOpen = resolve
    rejectOpen = reject
  })
  channels.set(sessionId, p)
  void (async () => {
    try {
      await whenReady(sessionId)
      if (channels.get(sessionId) !== p) throw new Error('SSH 会话不存在,请先连接')
      client.sftp((err, sftp) => (err ? rejectOpen(err) : resolveOpen(sftp)))
    } catch (err) {
      rejectOpen(err instanceof Error ? err : new Error(String(err)))
    }
  })()
  p.catch(() => {
    if (channels.get(sessionId) === p) channels.delete(sessionId)
  })
  return p
}

export function closeSftp(sessionId: string): void {
  const p = channels.get(sessionId)
  channels.delete(sessionId)
  if (p) void p.then((sftp) => sftp.end()).catch(() => {})
}

export function home(sessionId: string): Promise<string> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise((resolve, reject) => {
        sftp.realpath('.', (err, p) => (err ? reject(err) : resolve(p)))
      })
  )
}

export function list(sessionId: string, dir: string): Promise<SftpEntry[]> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise((resolve, reject) => {
        sftp.readdir(dir, (err, items) => {
          if (err) return reject(err)
          resolve(
            items.map((it) => ({
              name: it.filename,
              type: entryType(it.attrs),
              size: it.attrs.size,
              mtime: it.attrs.mtime * 1000
            }))
          )
        })
      })
  )
}

export interface SftpReadResult {
  kind: 'text' | 'image' | 'binary'
  /** kind = text 时的文件内容(UTF-8) */
  content?: string
  /** kind = image 时的 data URL */
  dataUrl?: string
  size: number
  truncated: boolean
}

/**
 * 读取远程文件用于预览/编辑:图片按 data URL 返回,文本按 UTF-8 返回,
 * 其余按二进制处理;超过上限只读前 5MB 并标记 truncated。
 */
export function read(sessionId: string, remotePath: string): Promise<SftpReadResult> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise<SftpReadResult>((resolve, reject) => {
        sftp.stat(remotePath, (statErr, st) => {
          if (statErr) return reject(statErr)
          const size = st.size ?? 0
          const truncated = size > MAX_PREVIEW_BYTES
          const readFile = (end: number | undefined): Promise<Buffer> =>
            new Promise((res, rej) => {
              if (end === undefined) {
                sftp.readFile(remotePath, {}, (err, buf) => (err ? rej(err) : res(buf)))
              } else {
                const chunks: Buffer[] = []
                const stream = sftp.createReadStream(remotePath, { end })
                stream.on('data', (c: Buffer) => chunks.push(c))
                stream.on('error', rej)
                stream.on('end', () => res(Buffer.concat(chunks)))
              }
            })
          readFile(truncated ? MAX_PREVIEW_BYTES - 1 : undefined)
            .then((buf) => {
              const ext = extOf(remotePath)
              const mime = IMAGE_MIME[ext]
              if (mime) {
                resolve({
                  kind: 'image',
                  dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
                  size,
                  truncated
                })
                return
              }
              if (buf.subarray(0, 8192).includes(0)) {
                resolve({ kind: 'binary', size, truncated })
                return
              }
              resolve({ kind: 'text', content: buf.toString('utf8'), size, truncated })
            })
            .catch(reject)
        })
      })
  )
}

/** 将文本内容写回远程文件 */
export function write(sessionId: string, remotePath: string, content: string): Promise<void> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise<void>((resolve, reject) => {
        sftp.writeFile(remotePath, content, { encoding: 'utf8' }, (err) =>
          err ? reject(err) : resolve()
        )
      })
  )
}

export function mkdir(sessionId: string, dir: string): Promise<void> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise((resolve, reject) => {
        sftp.mkdir(dir, (err) => (err ? reject(err) : resolve()))
      })
  )
}

export async function remove(sessionId: string, target: string, isDir: boolean): Promise<void> {
  const sftp = await getSftp(sessionId)
  if (!isDir) {
    return new Promise((resolve, reject) => {
      sftp.unlink(target, (err) => (err ? reject(err) : resolve()))
    })
  }
  const items = await new Promise<FileEntry[]>((resolve, reject) => {
    sftp.readdir(target, (err, list) => (err ? reject(err) : resolve(list)))
  })
  for (const it of items) {
    if (it.filename === '.' || it.filename === '..') continue
    await remove(sessionId, `${target}/${it.filename}`, entryType(it.attrs) === 'dir')
  }
  return new Promise((resolve, reject) => {
    sftp.rmdir(target, (err) => (err ? reject(err) : resolve()))
  })
}

export function download(
  sessionId: string,
  remotePath: string,
  localPath: string,
  webContents: WebContents
): { transferId: string } {
  const transferId = randomUUID()
  transfers.add(transferId)
  getSftp(sessionId)
    .then((sftp) => {
      fs.mkdirSync(path.dirname(localPath), { recursive: true })
      const startedAt = Date.now()
      sftp.fastGet(
        remotePath,
        localPath,
        {
          concurrency: 16,
          chunkSize: 32768,
          step: (total: number, _chunk: number, totalSize: number) => {
            const speed = total / Math.max(1, (Date.now() - startedAt) / 1000)
            send(webContents, 'sftp:progress', {
              transferId,
              done: total,
              total: totalSize,
              speed: Math.round(speed)
            })
          }
        },
        (err) => {
          transfers.delete(transferId)
          if (err) fs.unlink(localPath, () => {})
          send(webContents, 'sftp:done', { transferId, error: err?.message })
        }
      )
    })
    .catch((err) => {
      transfers.delete(transferId)
      send(webContents, 'sftp:done', { transferId, error: err.message })
    })
  return { transferId }
}

export function upload(
  sessionId: string,
  localPath: string,
  remotePath: string,
  webContents: WebContents
): { transferId: string } {
  const transferId = randomUUID()
  transfers.add(transferId)
  getSftp(sessionId)
    .then((sftp) => {
      const startedAt = Date.now()
      sftp.fastPut(
        localPath,
        remotePath,
        {
          concurrency: 16,
          chunkSize: 32768,
          step: (total: number, _chunk: number, totalSize: number) => {
            const speed = total / Math.max(1, (Date.now() - startedAt) / 1000)
            send(webContents, 'sftp:progress', {
              transferId,
              done: total,
              total: totalSize,
              speed: Math.round(speed)
            })
          }
        },
        (err) => {
          transfers.delete(transferId)
          if (err) sftp.unlink(remotePath, () => {})
          send(webContents, 'sftp:done', { transferId, error: err?.message })
        }
      )
    })
    .catch((err) => {
      transfers.delete(transferId)
      send(webContents, 'sftp:done', { transferId, error: err.message })
    })
  return { transferId }
}
