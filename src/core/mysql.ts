import mysql, { type Connection, type FieldPacket } from 'mysql2'

export interface MysqlProfile {
  id: string; name: string; host: string; port: number; user: string; password: string; database?: string; tls?: boolean
}
export interface MysqlQueryResult { columns: string[]; rows: Array<Array<string | null>>; affectedRows?: number; limited: boolean }

export function validateMysqlProfile(profile: MysqlProfile): void {
  if (!profile.id || !profile.name?.trim() || !profile.host?.trim() || !profile.user?.trim()) throw new Error('数据库连接名称、主机和用户名不能为空')
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error('数据库端口必须在 1–65535 之间')
  if (profile.host.length > 255 || profile.user.length > 256 || profile.password.length > 4096) throw new Error('数据库配置字段过长')
}

export function mysqlIdentifier(name: string): string {
  if (!name || name.includes('\0') || name.length > 128) throw new Error('数据库或表名无效')
  return mysql.escapeId(name, true)
}

export class MysqlSession {
  private closed = false
  private pending?: (error: Error) => void
  private constructor(private readonly connection: Connection) {
    connection.on('error', (error) => { this.pending?.(error); this.close() })
  }

  static async connect(profile: MysqlProfile, signal?: AbortSignal): Promise<MysqlSession> {
    validateMysqlProfile(profile)
    const connection = mysql.createConnection({ host: profile.host, port: profile.port, user: profile.user, password: profile.password,
      database: profile.database || undefined, connectTimeout: 10000, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true,
      rowsAsArray: true, dateStrings: true, charset: 'utf8mb4', ...(profile.tls ? { ssl: { rejectUnauthorized: true, verifyIdentity: true } } : {}) })
    const session = new MysqlSession(connection)
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          session.pending = undefined
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(new Error('数据库连接超时')), 15000)
        const abort = (): void => finish(new Error('数据库连接已取消'))
        session.pending = finish
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) { abort(); return }
        connection.connect((error) => finish(error || undefined))
      })
      return session
    } catch (error) { session.close(); throw error }
  }

  get isClosed(): boolean { return this.closed }

  query(sql: string): Promise<MysqlQueryResult> {
    if (this.closed) return Promise.reject(new Error('数据库连接已关闭，请重新连接'))
    if (this.pending) return Promise.reject(new Error('上一个查询尚未结束'))
    if (!sql.trim() || Buffer.byteLength(sql) > 65536) return Promise.reject(new Error('SQL 不能为空且最多 64 KiB'))
    return new Promise((resolve, reject) => {
      const result: MysqlQueryResult = { columns: [], rows: [], limited: false }
      let bytes = 0
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.pending = undefined
        if (error) reject(error)
        else resolve(result)
      }
      this.pending = finish
      const timer = setTimeout(() => { finish(new Error('SQL 超过 15 秒，已关闭连接；服务器上的执行结果可能尚未确认')); this.close() }, 15000)
      const query = this.connection.query(sql)
      query.on('fields', (fields: FieldPacket[]) => { result.columns = fields.slice(0, 100).map((field) => field.name); if (fields.length > 100) result.limited = true })
      const stream = query.stream({ highWaterMark: 16 })
      stream.on('data', (row: unknown) => {
        if (settled) return
        if (Array.isArray(row)) {
          const cells = row.slice(0, 100).map((cell) => {
            if (cell === null) return null
            if (Buffer.isBuffer(cell)) {
              if (cell.length > 4096) result.limited = true
              return cell.subarray(0, 4096).toString('hex')
            }
            const text = typeof cell === 'object' ? JSON.stringify(cell) : String(cell)
            if (text.length > 65536) result.limited = true
            return text.slice(0, 65536)
          })
          bytes += cells.reduce((sum, cell) => sum + Buffer.byteLength(cell || ''), 0)
          if (result.rows.length >= 1000 || bytes > 2 * 1024 * 1024) {
            result.limited = true
            finish()
            this.close() // Stop network consumption; do not accumulate the rest of a large result.
            stream.destroy()
          } else result.rows.push(cells)
        } else if (row && typeof row === 'object' && 'affectedRows' in row) result.affectedRows = Number(row.affectedRows)
      })
      stream.once('end', () => finish())
      stream.on('error', (error: Error) => finish(error))
    })
  }

  /** Row mutations use server-side parameters, including servers with NO_BACKSLASH_ESCAPES. */
  executeMutation(sql: string, values: Array<string | null>): Promise<MysqlQueryResult> {
    if (this.closed || this.pending) return Promise.reject(new Error('数据库连接已关闭或正忙'))
    if (!/^(?:INSERT|UPDATE|DELETE)\s/i.test(sql) || Buffer.byteLength(sql) > 65536 || values.length > 200 || values.some((value) => value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 65536))) return Promise.reject(new Error('行修改参数超出允许范围'))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, affectedRows = 0): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.pending = undefined
        if (error) reject(error)
        else resolve({ columns: [], rows: [], affectedRows, limited: false })
      }
      const timer = setTimeout(() => { finish(new Error('行修改超时，结果尚未确认，请检查数据库后再重试')); this.close() }, 15000)
      this.pending = finish
      try {
        this.connection.execute(sql, values, (error, result) => {
          if (error) finish(error)
          else if (!Array.isArray(result) && 'affectedRows' in result) finish(undefined, result.affectedRows)
          else finish(new Error('行修改返回了不支持的结果类型'))
        })
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending?.(new Error('数据库连接已关闭'))
    this.connection.destroy()
  }
}
