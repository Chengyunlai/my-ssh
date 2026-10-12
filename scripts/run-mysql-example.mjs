import { spawn } from 'node:child_process'
import { startMysqlFixture } from '../examples/stage-04-tui-plugins/core/mysql-server.mjs'
const fixture = await startMysqlFixture()
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['examples/stage-04-tui-plugins/user_code/main.mjs'], {
      stdio: 'inherit', env: { ...process.env, MYSSH_EXAMPLE_DB_PORT: String(fixture.profile.port) }
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Example exited ${code}`)))
  })
} finally { await fixture.close() }
