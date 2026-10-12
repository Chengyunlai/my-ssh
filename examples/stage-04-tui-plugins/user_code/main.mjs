import { MysqlSession } from '../../../out/tui/mysql.cjs'

// Public Core entry, the same implementation exported as myssh-tui/mysql in the npm package.
const session = await MysqlSession.connect({ id: 'example', name: 'Loopback demo', host: '127.0.0.1',
  port: Number(process.env.MYSSH_EXAMPLE_DB_PORT || 3306), user: 'demo', password: 'demo-fixture', tls: false })
try {
  const result = await session.query("SELECT 'MYSQL_OK 你好' AS message")
  console.log(result.rows[0][0])
} finally { session.close() }
