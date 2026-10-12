import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Profile } from '../core'

interface Envelope {
  version: 1
  salt: string
  iv: string
  tag: string
  data: string
}

export function dataDirectory(): string {
  if (process.env.MYSSH_TUI_HOME) return path.resolve(process.env.MYSSH_TUI_HOME)
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'myssh-tui')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'myssh-tui')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'myssh-tui')
}

/** 独立于桌面 safeStorage 文件；主密码只保留在内存，损坏 / 错误口令不会重置数据。 */
export class EncryptedVault<T = Profile> {
  private readonly key: Buffer
  private readonly salt: Buffer

  constructor(private readonly filename: string, password: string, private readonly context = 'myssh-tui-vault-v1') {
    if (Array.from(password).length < 8) throw new Error('主密码至少需要 8 个字符')
    const existing = this.envelope()
    this.salt = existing ? this.decode(existing.salt, 16) : randomBytes(16)
    this.key = scryptSync(password, this.salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
    try { this.read() }
    catch (error) { this.key.fill(0); throw error }
  }

  private decode(value: string, size?: number): Buffer {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('凭据文件格式无效')
    const bytes = Buffer.from(value, 'base64')
    if (size !== undefined && bytes.length !== size) throw new Error('凭据文件格式无效')
    return bytes
  }

  private envelope(): Envelope | undefined {
    let source: string
    try { source = fs.readFileSync(this.filename, 'utf8') }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
    const value = JSON.parse(source) as Envelope
    if (!value || value.version !== 1) throw new Error('凭据文件版本无效')
    return value
  }

  read(): T[] {
    const value = this.envelope()
    if (!value) return []
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, this.decode(value.iv, 12))
      decipher.setAAD(Buffer.from(this.context))
      decipher.setAuthTag(this.decode(value.tag, 16))
      const json = Buffer.concat([decipher.update(this.decode(value.data)), decipher.final()]).toString('utf8')
      const profiles = JSON.parse(json) as T[]
      if (!Array.isArray(profiles)) throw new Error('配置列表无效')
      return profiles
    } catch {
      throw new Error('无法解锁凭据：主密码错误或凭据文件已损坏')
    }
  }

  write(profiles: T[]): void {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(this.context))
    const data = Buffer.concat([cipher.update(JSON.stringify(profiles), 'utf8'), cipher.final()])
    const value: Envelope = {
      version: 1, salt: this.salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
    }
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = `${this.filename}.${randomBytes(8).toString('hex')}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.filename)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }

  dispose(): void { this.key.fill(0) }
}
