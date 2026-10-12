import { randomUUID } from 'node:crypto'
import { MysqlSession, mysqlIdentifier, validateMysqlProfile, type MysqlProfile, type MysqlQueryResult } from '../core/mysql'
import { TerminalUI, Cancelled, ExitRequested } from './ui'
import { editText } from './editor'
import type { EncryptedVault } from './vault'
import fs from 'node:fs'
import { localPath } from './paths'
import { csvResult, sortMysqlResult } from './mysql-results'

export interface SavedMysqlProfile extends MysqlProfile { history?: string[] }

function resultText(result: MysqlQueryResult): string {
  return [result.columns.join(' | '), ...result.rows.map((row) => row.map((value) => value === null ? 'NULL' : value).join(' | ')),
    result.affectedRows === undefined ? `${result.rows.length} 行` : `${result.affectedRows} 行受影响`,
    ...(result.limited ? ['结果已截断（最多 1000 行 / 100 列 / 2 MiB）；如连接已关闭，请重新连接。'] : [])].join('\n')
}

export class MysqlWorkspace {
  private session?: MysqlSession
  constructor(private readonly ui: TerminalUI, private readonly vault: EncryptedVault<SavedMysqlProfile>) {}

  private profiles(): SavedMysqlProfile[] {
    const profiles = this.vault.read()
    for (const profile of profiles) validateMysqlProfile(profile)
    return profiles
  }

  private save(profile: SavedMysqlProfile): void {
    const profiles = this.profiles().filter((item) => item.id !== profile.id)
    this.vault.write([...profiles, profile])
  }

  private async form(existing?: SavedMysqlProfile): Promise<SavedMysqlProfile> {
    const profile: SavedMysqlProfile = {
      id: existing?.id || randomUUID(), name: await this.ui.input('数据库连接名称', existing?.name),
      host: await this.ui.input('数据库主机', existing?.host || '127.0.0.1'),
      port: Number(await this.ui.input('数据库端口', String(existing?.port || 3306))),
      user: await this.ui.input('数据库用户名', existing?.user || 'root'),
      password: await this.ui.input('数据库密码（加密保存）', existing?.password, true),
      database: await this.ui.input('默认数据库（可为空）', existing?.database), history: existing?.history || []
    }
    const tls = await this.ui.menu('数据库 TLS', [{ label: '启用 TLS，验证服务器证书', value: true }, { label: '不启用 TLS', value: false }])
    if (tls === undefined) throw new Cancelled()
    profile.tls = tls
    validateMysqlProfile(profile)
    return profile
  }

  async run(): Promise<void> {
    while (true) {
      const profiles = this.profiles()
      const id = await this.ui.menu('MySQL 管理器', [...profiles.map((profile) => ({ label: `${profile.name} · ${profile.user}@${profile.host}:${profile.port}`, value: profile.id })), { label: '+ 新建数据库连接', value: '+' }])
      if (!id) return
      if (id === '+') { this.save(await this.form()); continue }
      const profile = profiles.find((profile) => profile.id === id)!
      const action = await this.ui.menu(profile.name, [
        { label: '连接数据库', value: 'connect' }, { label: '编辑数据库配置', value: 'edit' }, { label: '删除数据库配置', value: 'delete' }
      ])
      if (action === 'edit') this.save(await this.form(profile))
      if (action === 'delete' && await this.ui.confirm('删除数据库配置及查询历史？')) this.vault.write(profiles.filter((profile) => profile.id !== id))
      if (action === 'connect') {
        const controller = new AbortController()
        this.session = await this.ui.busy('连接数据库', MysqlSession.connect(profile, controller.signal), () => controller.abort())
        try { await this.workspace(profile) }
        finally { this.session.close(); this.session = undefined }
      }
    }
  }

  private async query(sql: string): Promise<MysqlQueryResult> {
    return this.ui.busy('执行 SQL', this.session!.query(sql), () => this.session?.close())
  }

  private async execute(profile: SavedMysqlProfile, initial = ''): Promise<void> {
    const input = await this.ui.input('SQL（Enter 后确认执行）', initial || 'SELECT 1')
    const edited = await this.ui.menu('SQL', [{ label: '预览并执行', value: false }, { label: '用本地编辑器修改 SQL', value: true }])
    if (edited === undefined) return
    const sql = edited ? await editText(this.ui, input, 'query.sql') : input
    await this.ui.view('即将在 ' + profile.name + ' 执行', sql)
    if (!await this.ui.confirm('执行上面的 SQL？数据库写入不会自动回滚。')) return
    profile.history = [sql, ...(profile.history || []).filter((item) => item !== sql)].slice(0, 30)
    this.save(profile)
    await this.results('SQL 结果', await this.query(sql))
  }

  private async workspace(profile: SavedMysqlProfile): Promise<void> {
    while (!this.session!.isClosed) {
      const action = await this.ui.menu(profile.name + ' · MySQL', [
        { label: '数据库 / 表 / 结构 / 数据', value: 'catalog' }, { label: '执行 SQL', value: 'sql' },
        { label: '查询历史', value: 'history' }, { label: '断开数据库', value: 'disconnect' }
      ])
      if (!action || action === 'disconnect') return
      try {
        if (action === 'catalog') await this.catalog()
        if (action === 'sql') await this.execute(profile)
        if (action === 'history') {
        const sql = await this.ui.menu('查询历史（存于加密 vault）', (profile.history || []).map((sql) => ({ label: sql, value: sql })))
        if (sql) await this.execute(profile, sql)
        }
      } catch (error) {
        if (error instanceof ExitRequested) throw error
        if (!(error instanceof Cancelled)) await this.ui.view('数据库操作失败', error instanceof Error ? error.message : String(error))
      }
    }
  }

  private async catalog(): Promise<void> {
    const databases = await this.query('SHOW DATABASES')
    const database = await this.ui.menu('数据库', databases.rows.map((row) => ({ label: row[0] || 'NULL', value: row[0] })))
    if (!database) return
    const tables = await this.query(`SHOW TABLES FROM ${mysqlIdentifier(database)}`)
    const table = await this.ui.menu(database + ' · 表', tables.rows.map((row) => ({ label: row[0] || 'NULL', value: row[0] })))
    if (!table) return
    const qualified = `${mysqlIdentifier(database)}.${mysqlIdentifier(table)}`
    const action = await this.ui.menu(table, [{ label: '查看表结构', value: 'schema' }, { label: '查看表数据 / 行编辑 / 分页', value: 'data' }, { label: '查看建表 SQL', value: 'ddl' }, { label: '查看索引', value: 'indexes' }])
    if (!action) return
    if (action === 'data') { await this.table(qualified); return }
    const sql = action === 'schema' ? `SHOW COLUMNS FROM ${qualified}` : action === 'indexes' ? `SHOW INDEX FROM ${qualified}` : `SHOW CREATE TABLE ${qualified}`
    await this.results(table, await this.query(sql))
  }

  private async results(title: string, initial: MysqlQueryResult): Promise<void> {
    let result = initial
    while (true) {
      await this.ui.view(title, resultText(result))
      const action = await this.ui.menu('查询结果', [{ label: '返回', value: 'back' }, { label: '按列排序', value: 'sort' }, { label: '导出当前结果 CSV', value: 'export' }])
      if (!action || action === 'back') return
      if (action === 'sort') {
        const column = await this.ui.menu('排序列', result.columns.map((name, index) => ({ label: name, value: index })))
        if (column === undefined) continue
        const descending = await this.ui.menu('排序方向', [{ label: '升序', value: false }, { label: '降序', value: true }])
        if (descending !== undefined) result = sortMysqlResult(result, column, descending)
      }
      if (action === 'export') {
        const filename = localPath(await this.ui.input('CSV 保存路径', 'query-result.csv'))
        if (fs.existsSync(filename) && !await this.ui.confirm(`覆盖本地 CSV ${filename}？`)) continue
        fs.writeFileSync(filename, '\uFEFF' + csvResult(result), { mode: 0o600 })
        await this.ui.view('CSV 已导出', filename + '\n仅包含当前结果；危险公式前缀已转为电子表格文字。')
      }
    }
  }

  private async mutate(sql: string, values: Array<string | null>): Promise<void> {
    await this.ui.view('行修改预览', sql + '\n参数：' + JSON.stringify(values))
    if (!await this.ui.confirm('提交行修改？操作不会自动回滚。')) return
    const result = await this.ui.busy('修改数据库行', this.session!.executeMutation(sql, values), () => this.session?.close())
    await this.ui.view('行修改结果', resultText(result))
  }

  private async table(qualified: string): Promise<void> {
    const structure = await this.query(`SHOW COLUMNS FROM ${qualified}`)
    const fields = structure.rows.map((row) => ({ name: row[0] || '', key: row[3], extra: row[5] })).filter((field) => field.name)
    const primary = fields.filter((field) => field.key === 'PRI').map((field) => field.name)
    let page = 0
    while (!this.session!.isClosed) {
      const order = primary.length ? ' ORDER BY ' + primary.map(mysqlIdentifier).join(', ') : ''
      const result = await this.query(`SELECT * FROM ${qualified}${order} LIMIT 100 OFFSET ${page * 100}`)
      const index = await this.ui.menu(`${qualified} · 第 ${page + 1} 页`, [
        ...result.rows.map((row, i) => ({ label: `${i + 1} · ${row.map((value) => value === null ? 'NULL' : value).join(' | ')}`, value: String(i) })),
        { label: '新增行', value: 'insert' }, { label: '查看 / 排序 / 导出当前页', value: 'view' },
        ...(page > 0 ? [{ label: '上一页', value: 'previous' }] : []),
        ...(result.rows.length === 100 ? [{ label: '下一页', value: 'next' }] : [])
      ], result.columns.join(' | '))
      if (!index) return
      if (index === 'previous') page--
      if (index === 'next') page++
      if (index === 'view') await this.results(qualified, result)
      if (index === 'insert') {
        const values: Array<string | null> = []
        const columns = fields.filter((field) => !field.extra?.includes('auto_increment'))
        for (const field of columns) {
          const value = await this.ui.input(`${field.name}（:null = NULL）`)
          values.push(value === ':null' ? null : value)
        }
        if (columns.length) await this.mutate(`INSERT INTO ${qualified} (${columns.map((field) => mysqlIdentifier(field.name)).join(', ')}) VALUES (${values.map(() => '?').join(', ')})`, values)
      }
      if (/^\d+$/.test(index)) {
        const row = result.rows[Number(index)]
        await this.ui.view('当前行', result.columns.map((name, i) => `${name}: ${row[i] === null ? 'NULL' : row[i]}`).join('\n'))
        const action = await this.ui.menu('行操作', [{ label: '返回', value: 'back' }, { label: '修改一个字段', value: 'edit' }, { label: '删除当前行', value: 'delete' }])
        if (!action || action === 'back') continue
        if (result.limited) { await this.ui.view('行修改', '结果内容已截断，禁止从不完整的行写回；请使用明确的 SQL。'); continue }
        if (!primary.length || primary.some((name) => !result.columns.includes(name))) { await this.ui.view('行修改', '没有完整主键的表仅支持查看；可通过 SQL 显式修改。'); continue }
        const keys = primary.map((name) => row[result.columns.indexOf(name)])
        const where = primary.map((name) => `${mysqlIdentifier(name)} <=> ?`).join(' AND ')
        if (action === 'delete') await this.mutate(`DELETE FROM ${qualified} WHERE ${where} LIMIT 1`, keys)
        if (action === 'edit') {
          const field = await this.ui.menu('修改字段', result.columns.map((name) => ({ label: name, value: name })))
          if (!field) continue
          const previous = row[result.columns.indexOf(field)]
          const value = await this.ui.input(field + '（:null = NULL）', previous === null ? ':null' : previous)
          await this.mutate(`UPDATE ${qualified} SET ${mysqlIdentifier(field)} = ? WHERE ${where} LIMIT 1`, [value === ':null' ? null : value, ...keys])
        }
      }
    }
  }

  dispose(): void { this.session?.close() }
}
