import mysql from 'mysql2'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const driverDirectory = path.dirname(require.resolve('mysql2'))
// mysql2 exposes a server helper but no public writer for prepare responses.
// These packet primitives belong only to the synthetic protocol fixture.
const Packet = require(path.join(driverDirectory, 'lib/packets/packet.js'))
const ColumnDefinition = require(path.join(driverDirectory, 'lib/packets/column_definition.js'))

/** Loopback MySQL wire-protocol fixture; it never executes SQL against real data. */
export async function startMysqlFixture() {
  const connections = new Set()
  const queries = []
  let tableRows = [['1', 'MYSQL_OK 你好']]
  let nextId = 2
  const server = mysql.createServer((connection) => {
    connections.add(connection)
    connection.on('error', () => {})
    connection.on('end', () => connections.delete(connection))
    // mysql2's server helper keeps one command across requests. Reset its packet
    // sequence for each small fixture command; this is fixture infrastructure only.
    connection.stream.prependListener('data', () => { if (connection.clientHelloReply) connection.sequenceId = 0 })
    connection.serverHandshake({ protocolVersion: 10, serverVersion: '8.0.0-myssh-fixture', connectionId: 1, statusFlags: 2,
      characterSet: 45, capabilityFlags: 0x8a20f,
      authCallback: (info, done) => {
        const hash = (bytes) => createHash('sha1').update(bytes).digest()
        const first = hash('demo-fixture')
        const scramble = hash(Buffer.concat([info.authPluginData1, info.authPluginData2, hash(first)]))
        const expected = Buffer.from(first.map((byte, i) => byte ^ scramble[i]))
        const valid = info.user === 'demo' && info.authToken.length === expected.length && timingSafeEqual(expected, info.authToken)
        done(null, valid ? undefined : { message: 'Fixture authentication failed', code: 1045 })
      } })
    const rows = (columns, values) => {
      connection.sequenceId = 1
      connection.writeColumns(columns.map((name) => ({ catalog: 'def', schema: 'demo', table: 'items', orgTable: 'items', name, orgName: name, characterSet: 45, columnLength: 1024, columnType: 253, flags: 0, decimals: 0 })))
      for (const row of values) connection.writeTextRow(row)
      connection.writeEof()
    }
    connection.on('query', (sql) => {
      queries.push(sql)
      if (sql === 'SHOW DATABASES') rows(['Database'], [['demo']])
      else if (sql === 'SHOW TABLES FROM `demo`') rows(['Tables_in_demo'], [['items']])
      else if (sql === 'SHOW COLUMNS FROM `demo`.`items`') rows(['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'], [['id', 'int', 'NO', 'PRI', null, 'auto_increment'], ['message', 'varchar(255)', 'YES', '', null, '']])
      else if (sql === 'SHOW CREATE TABLE `demo`.`items`') rows(['Table', 'Create Table'], [['items', 'CREATE TABLE items (id INT PRIMARY KEY, message VARCHAR(255))']])
      else if (sql === 'SHOW INDEX FROM `demo`.`items`') rows(['Key_name', 'Column_name'], [['PRIMARY', 'id']])
      else if ((sql === 'SELECT fixture' || sql === "SELECT 'MYSQL_OK 你好' AS message")) rows(['message'], [['MYSQL_OK 你好']])
      else if (sql === 'SELECT many') rows(['message'], Array.from({ length: 1100 }, (_, i) => [`ROW${i}`]))
      else if (sql === 'SELECT long') rows(['message'], [['x'.repeat(100000)]])
      else if (sql.startsWith('SELECT * FROM `demo`.`items`')) rows(['id', 'message'], tableRows.slice(Number(sql.match(/OFFSET (\d+)/)?.[1] || 0), Number(sql.match(/OFFSET (\d+)/)?.[1] || 0) + 100))
      else { connection.sequenceId = 1; connection.writeError({ message: 'Fixture accepts only declared demo queries', code: 1064 }) }
    })
    const statements = new Map()
    connection.on('stmt_prepare', (sql) => {
      connection.sequenceId = 1
      if (!/^(UPDATE|INSERT INTO|DELETE FROM) `demo`\.`items`/.test(sql)) { connection.writeError({ code: 1064, message: 'Fixture prepared statement is outside the virtual table' }); return }
      const id = statements.size + 1
      statements.set(id, sql)
      const count = (sql.match(/\?/g) || []).length
      const packet = new Packet(0, Buffer.alloc(16), 0, 16)
      packet.offset = 4
      packet.writeInt8(0); packet.writeInt32(id); packet.writeInt16(0); packet.writeInt16(count); packet.writeInt8(0); packet.writeInt16(0)
      connection.writePacket(packet)
      for (let i = 0; i < count; i++) connection.writePacket(ColumnDefinition.toPacket({ catalog: 'def', schema: '', table: '', orgTable: '', name: '?', orgName: '', characterSet: 45, columnLength: 255, columnType: 253, flags: 0, decimals: 0 }, 'utf8'))
      if (count) connection.writeEof()
    })
    connection.on('stmt_execute', (id, _flags, _iterations, values) => {
      connection.sequenceId = 1
      const sql = statements.get(id)
      if (!sql) { connection.writeError({ code: 1064, message: 'Unknown fixture statement' }); return }
      queries.push({ sql, values })
      if (sql.startsWith('UPDATE')) { const row = tableRows.find((row) => row[0] === values[1]); if (row) row[1] = values[0] }
      if (sql.startsWith('INSERT')) tableRows.push([String(nextId++), values[0]])
      if (sql.startsWith('DELETE')) tableRows = tableRows.filter((row) => row[0] !== values[0])
      connection.writeOk({ affectedRows: 1, insertId: nextId - 1, statusFlags: 2 })
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server._server.once('listening', resolve); server._server.once('error', reject) })
  return { profile: { id: 'demo', name: 'MySQL demo', host: '127.0.0.1', port: server._server.address().port, user: 'demo', password: 'demo-fixture', tls: false }, queries,
    close: () => new Promise((resolve) => { for (const connection of connections) connection.destroy(); server.close(resolve) }) }
}
