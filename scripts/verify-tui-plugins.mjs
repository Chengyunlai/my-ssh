import { spawn } from 'node:child_process'
import { startFixture } from '../examples/stage-01-core-tui/core/server.mjs'
import { startMysqlFixture } from '../examples/stage-04-tui-plugins/core/mysql-server.mjs'
import { startRegistryFixture } from '../examples/stage-04-tui-plugins/core/registry.mjs'

const ssh = await startFixture()
const mysql = await startMysqlFixture()
const registry = await startRegistryFixture()
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/verify-tui-plugins.py', String(ssh.profile.port), String(mysql.profile.port), registry.url, process.execPath, ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' }
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Plugin terminal verification exited ${code}`)))
  })
} finally { await registry.close(); await mysql.close(); await ssh.close() }
