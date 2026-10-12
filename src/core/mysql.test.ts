import { describe, it, expect } from 'vitest'
import { MysqlSession, mysqlIdentifier, validateMysqlProfile } from './mysql'
// @ts-expect-error The wire fixture is JavaScript, not part of the published Core API.
import { startMysqlFixture } from '../../examples/stage-04-tui-plugins/core/mysql-server.mjs'

describe('trusted Node MySQL core', () => {
  it('validates connection values and quotes catalog identifiers as literal names', () => {
    expect(mysqlIdentifier('demo`;DROP DATABASE x')).toBe('`demo``;DROP DATABASE x`')
    expect(() => mysqlIdentifier('bad\0name')).toThrow()
    expect(() => validateMysqlProfile({ id: 'x', name: 'x', host: '127.0.0.1', port: 0, user: 'x', password: '' })).toThrow('端口')
  })
  it('authenticates and queries over the actual TCP MySQL protocol, retaining errors', async () => {
    const fixture = await startMysqlFixture()
    let session: MysqlSession | undefined
    try {
      await expect(MysqlSession.connect({ ...fixture.profile, password: 'wrong' })).rejects.toThrow('authentication')
      await expect(MysqlSession.connect({ ...fixture.profile, tls: true })).rejects.toThrow()
      session = await MysqlSession.connect(fixture.profile)
      expect((await session.query('SELECT fixture')).rows).toEqual([['MYSQL_OK 你好']])
      expect((await session.query('SHOW DATABASES')).columns).toEqual(['Database'])
      expect(await session.query('DO fixture')).toMatchObject({ columns: [], rows: [], affectedRows: 0 })
      await expect(session.query('DROP DATABASE real')).rejects.toThrow('declared demo queries')
      expect((await session.query('SELECT fixture')).rows).toHaveLength(1)
    } finally { session?.close(); await fixture.close() }
  })
  it('preserves NULL and sends row values through real prepared statement packets', async () => {
    const fixture = await startMysqlFixture()
    const session = await MysqlSession.connect(fixture.profile)
    try {
      const sql = 'UPDATE `demo`.`items` SET `message` = ? WHERE `id` <=> ? LIMIT 1'
      const value = "x'; DROP DATABASE real; --"
      expect((await session.executeMutation(sql, [value, '1'])).affectedRows).toBe(1)
      expect((await session.query('SELECT * FROM `demo`.`items` LIMIT 100')).rows[0][1]).toBe(value)
      await session.executeMutation(sql, [null, '1'])
      expect((await session.query('SELECT * FROM `demo`.`items` LIMIT 100')).rows[0][1]).toBeNull()
      expect(fixture.queries).toContainEqual({ sql, values: [value, '1'] })
      const clipped = await session.query('SELECT long')
      expect(clipped.rows[0][0]).toHaveLength(65536)
      expect(clipped.limited).toBe(true)
    } finally { session.close(); await fixture.close() }
  })
  it('stops consuming a large result and closes its socket instead of buffering all rows', async () => {
    const fixture = await startMysqlFixture()
    const session = await MysqlSession.connect(fixture.profile)
    try {
      const result = await session.query('SELECT many')
      expect(result.rows).toHaveLength(1000)
      expect(result.limited).toBe(true)
      expect(session.isClosed).toBe(true)
      await expect(session.query('SELECT fixture')).rejects.toThrow('已关闭')
    } finally { session.close(); await fixture.close() }
  })
})
