import { spawn } from 'node:child_process'
import { startFixture } from '../examples/stage-01-core-tui/core/server.mjs'

if (process.platform === 'win32') {
  console.log('PTY verification requires Unix pty; use Windows Terminal for the manual interaction check.')
} else {
  const fixture = await startFixture()
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('python3', ['scripts/verify-tui.py', String(fixture.profile.port)], { stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`PTY verification exited ${code}`)))
    })
  } finally { await fixture.close() }
}
