import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { MysqlSession, mysqlIdentifier } from '../out/tui/mysql.cjs'

// This entry is for the ephemeral CI MySQL container, never a production database.
if (!process.env.MYSSH_TEST_MYSQL_PORT || !process.env.MYSSH_TEST_MYSQL_PASSWORD) throw new Error('Set the ephemeral test MySQL port and password explicitly')
const profile = { id: 'test', name: 'Ephemeral CI MySQL', host: '127.0.0.1', port: Number(process.env.MYSSH_TEST_MYSQL_PORT), user: 'root', password: process.env.MYSSH_TEST_MYSQL_PASSWORD, tls: false }
const database = mysqlIdentifier('myssh_verify_' + randomBytes(8).toString('hex'))
let session = await MysqlSession.connect(profile)
let created = false
try {
  await session.query(`CREATE DATABASE ${database}`)
  created = true
  const table = database + '.`items`'
  await session.query(`CREATE TABLE ${table} (id INT PRIMARY KEY, message TEXT NULL)`)
  const hostile = "x'; DROP TABLE items; --"
  await session.executeMutation(`INSERT INTO ${table} (id, message) VALUES (?, ?)`, ['1', hostile])
  assert.equal((await session.query(`SELECT message FROM ${table} WHERE id = 1`)).rows[0][0], hostile)
  await session.query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'")
  await session.executeMutation(`UPDATE ${table} SET message = ? WHERE id = ?`, ['中文 \\ quote \'', '1'])
  assert.equal((await session.query(`SELECT message FROM ${table} WHERE id = 1`)).rows[0][0], "中文 \\ quote '")
  await session.executeMutation(`UPDATE ${table} SET message = ? WHERE id = ?`, [null, '1'])
  assert.equal((await session.query(`SELECT message FROM ${table} WHERE id = 1`)).rows[0][0], null)
  assert.ok((await session.query(`SHOW COLUMNS FROM ${table}`)).rows.length === 2)
  assert.ok((await session.query(`SHOW INDEX FROM ${table}`)).rows.length > 0)
  const values = Array.from({ length: 1001 }, (_, i) => `(${i + 2}, 'fixture')`).join(',')
  await session.query(`INSERT INTO ${table} (id, message) VALUES ${values}`)
  const limited = await session.query(`SELECT * FROM ${table}`)
  assert.equal(limited.rows.length, 1000)
  assert.equal(limited.limited, true)
  assert.equal(session.isClosed, true)
  session = await MysqlSession.connect(profile)
  await session.executeMutation(`DELETE FROM ${table} WHERE id = ?`, ['1'])
  assert.equal((await session.query(`SELECT COUNT(*) FROM ${table}`)).rows[0][0], '1001')
  console.log('Real MySQL verified: parameterized CRUD, NO_BACKSLASH_ESCAPES, NULL/Unicode, metadata, row cap and reconnect.')
} finally {
  if (session.isClosed) session = await MysqlSession.connect(profile)
  try { if (created) await session.query(`DROP DATABASE ${database}`) }
  finally { session.close() }
}
