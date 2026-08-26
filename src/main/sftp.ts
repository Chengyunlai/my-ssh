import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Attributes, FileEntry, SFTPWrapper } from 'ssh2'
import { nativeImage, type WebContents } from 'electron'
import type { SftpEntry } from '@shared/types'
import { getClient, whenReady } from './ssh'

const channels = new Map<string, Promise<SFTPWrapper>>()
const transfers = new Set<string>()

/** 预览读取结果缓存:同一会话内按(路径 + size + mtime)命中,重复预览不再重新下载;写回时失效 */
interface PreviewCacheEntry {
  key: string
  size: number
  mtime: number
  result: SftpReadResult
}
const previewCache = new Map<string, PreviewCacheEntry>()
const PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024
let previewCacheBytes = 0

/** 在线预览/编辑的读取上限:超过则截断读取并标记 */
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
/** PDF 预览上限(二进制解析开销大,放宽到 20MB)。Office 使用更严格的专属上限。 */
const MAX_DOC_BYTES = 20 * 1024 * 1024
/** Office 解析器的复杂度更难由文件大小反映,使用更严格的读取上限。 */
const MAX_OFFICE_BYTES = 10 * 1024 * 1024
const PREVIEW_READ_TIMEOUT_MS = 15_000
const PREVIEW_OPERATION_TIMEOUT_MS = 20_000

/** 走二进制解析的文档扩展(docx / xlsx 等) */
const DOC_EXTS = new Set(['docx', 'xlsx', 'xls', 'doc'])

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif'
}

/** Chromium 不原生支持、需交给系统解码转 PNG 的图片扩展 */
const NEEDS_DECODE = new Set(['heic', 'heif', 'tiff'])

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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function cacheKey(sessionId: string, remotePath: string): string {
  return `${sessionId}\u0000${remotePath}`
}

/** 缓存条目实际占用的内存(文本按字符、二进制按字节、base64 按解码后字节) */
function resultWeight(result: SftpReadResult): number {
  if (result.kind === 'text') return result.content?.length ?? 0
  if (result.kind === 'office') return result.bytes?.byteLength ?? 0
  if (result.dataUrl) return Math.ceil((result.dataUrl.length * 3) / 4)
  return 0
}

function previewCacheGet(key: string, size: number, mtime: number): SftpReadResult | undefined {
  const entry = previewCache.get(key)
  if (!entry) return undefined
  if (entry.size !== size || entry.mtime !== mtime) {
    // 远端文件已变化:失效并回收
    previewCache.delete(key)
    previewCacheBytes -= resultWeight(entry.result)
    return undefined
  }
  // LRU:重新插入到末尾
  previewCache.delete(key)
  previewCache.set(key, entry)
  return entry.result
}

function previewCacheSet(key: string, size: number, mtime: number, result: SftpReadResult): void {
  const weight = resultWeight(result)
  if (weight > PREVIEW_CACHE_MAX_BYTES) return
  const old = previewCache.get(key)
  if (old) {
    previewCache.delete(key)
    previewCacheBytes -= resultWeight(old.result)
  }
  previewCache.set(key, { key, size, mtime, result })
  previewCacheBytes += weight
  while (previewCacheBytes > PREVIEW_CACHE_MAX_BYTES && previewCache.size > 1) {
    const oldestKey = previewCache.keys().next().value
    if (oldestKey === undefined || oldestKey === key) break
    const oldest = previewCache.get(oldestKey)
    previewCache.delete(oldestKey)
    previewCacheBytes -= resultWeight(oldest!.result)
  }
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
  kind: 'text' | 'image' | 'binary' | 'pdf' | 'office'
  /** kind = text 时的文件内容(UTF-8) */
  content?: string
  /** kind = image / pdf 时的 data URL */
  dataUrl?: string
  /** kind = office 时的原始字节(docx / xlsx / xls / doc) */
  bytes?: Uint8Array
  size: number
  truncated: boolean
}

/**
 * 读取远程文件用于预览/编辑:图片按 data URL 返回,文本按 UTF-8 返回,
 * 其余按二进制处理;超过上限只读前 5MB 并标记 truncated。
 */
export function read(
  sessionId: string,
  remotePath: string,
  webContents: WebContents
): Promise<SftpReadResult> {
  let cancelled = false
  let cancelActiveRead: (() => void) | undefined
  return withTimeout(
    getSftp(sessionId).then(
      (sftp) =>
        new Promise<SftpReadResult>((resolve, reject) => {
        if (cancelled) {
          reject(new Error('预览操作超时'))
          return
        }
        const sendProgress = (percent: number): void => {
          if (!webContents.isDestroyed()) {
            webContents.send('sftp:read-progress', { sessionId, remotePath, percent })
          }
        }
        sftp.stat(remotePath, (statErr, st) => {
          if (cancelled) return
          if (statErr) return reject(statErr)
          const size = st.size ?? 0
          const mtime = st.mtime ?? 0
          const key = cacheKey(sessionId, remotePath)
          const cached = previewCacheGet(key, size, mtime)
          if (cached) {
            sendProgress(100)
            resolve(cached)
            return
          }
          const ext = extOf(remotePath)
          const limit =
            DOC_EXTS.has(ext)
              ? MAX_OFFICE_BYTES
              : ext === 'pdf' || IMAGE_MIME[ext]
                ? MAX_DOC_BYTES
                : MAX_PREVIEW_BYTES
          const truncated = size > limit
          const readTarget = Math.max(truncated ? limit : size, 1)
          const done = (result: SftpReadResult): void => {
            previewCacheSet(key, size, mtime, result)
            resolve(result)
          }
          const readFile = (): Promise<Buffer> =>
            new Promise((res, rej) => {
              const chunks: Buffer[] = []
              let received = 0
              let lastEmit = 0
              let settled = false
              const stream = sftp.createReadStream(
                remotePath,
                truncated ? { end: limit - 1 } : {}
              )
              cancelActiveRead = () => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                stream.destroy()
                rej(new Error('预览操作超时'))
              }
              const timer = setTimeout(() => {
                if (settled) return
                settled = true
                cancelActiveRead = undefined
                stream.destroy(new Error('预览读取超时'))
                rej(new Error('预览读取超时'))
              }, PREVIEW_READ_TIMEOUT_MS)
              stream.on('data', (c: Buffer) => {
                if (settled) return
                chunks.push(c)
                received += c.length
                if (received > readTarget) {
                  settled = true
                  clearTimeout(timer)
                  cancelActiveRead = undefined
                  stream.destroy(new Error('预览内容超过大小限制'))
                  rej(new Error('预览内容超过大小限制'))
                  return
                }
                const now = Date.now()
                if (now - lastEmit >= 80 || received >= readTarget) {
                  lastEmit = now
                  sendProgress(Math.min(100, Math.round((received / readTarget) * 100)))
                }
              })
              stream.on('error', (err: Error) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                cancelActiveRead = undefined
                rej(err)
              })
              stream.on('end', () => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                cancelActiveRead = undefined
                res(Buffer.concat(chunks))
              })
            })
          readFile()
            .then((buf) => {
              if (cancelled) return
              const mime = IMAGE_MIME[ext]
              if (mime) {
                let dataUrl = `data:${mime};base64,${buf.toString('base64')}`
                if (NEEDS_DECODE.has(ext)) {
                  const img = nativeImage.createFromBuffer(buf)
                  if (!img.isEmpty() && !cancelled) {
                    dataUrl = `data:image/png;base64,${img.toPNG().toString('base64')}`
                  }
                }
                if (cancelled) return
                done({
                  kind: 'image',
                  dataUrl,
                  size,
                  truncated
                })
                return
              }
              if (ext === 'pdf') {
                if (cancelled) return
                done({
                  kind: 'pdf',
                  dataUrl: `data:application/pdf;base64,${buf.toString('base64')}`,
                  size,
                  truncated
                })
                return
              }
              if (DOC_EXTS.has(ext)) {
                if (cancelled) return
                done({
                  kind: 'office',
                  bytes: new Uint8Array(buf),
                  size,
                  truncated
                })
                return
              }
              if (buf.subarray(0, 8192).includes(0)) {
                if (cancelled) return
                done({ kind: 'binary', size, truncated })
                return
              }
              if (cancelled) return
              done({ kind: 'text', content: buf.toString('utf8'), size, truncated })
            })
            .catch(reject)
        })
        })
    ),
    PREVIEW_OPERATION_TIMEOUT_MS,
    '预览操作超时',
    () => {
      cancelled = true
      cancelActiveRead?.()
    }
  )
}

/** 将文本内容写回远程文件 */
export function write(sessionId: string, remotePath: string, content: string): Promise<void> {
  previewCache.delete(cacheKey(sessionId, remotePath))
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise<void>((resolve, reject) => {
        sftp.writeFile(remotePath, content, { encoding: 'utf8' }, (err) =>
          err ? reject(err) : resolve()
        )
      })
  )
}

/** 远程路径是否已存在(新建文件前防误覆盖) */
export function stat(sessionId: string, remotePath: string): Promise<boolean> {
  return getSftp(sessionId).then(
    (sftp) =>
      new Promise<boolean>((resolve) => {
        sftp.stat(remotePath, (err) => resolve(!err))
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
