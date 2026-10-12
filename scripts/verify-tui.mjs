import { spawn } from 'node:child_process'
import { startFixture } from '../examples/stage-01-core-tui/core/server.mjs'

const fixture = await startFixture()
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/verify-tui.py', String(fixture.profile.port), process.execPath], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`PTY verification exited ${code}`)))
  })
} finally { await fixture.close() }
