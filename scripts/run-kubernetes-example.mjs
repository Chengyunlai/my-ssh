import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const directory = mkdtempSync(join(tmpdir(), 'myssh-kube-example-'))
try {
  mkdirSync(join(directory, 'node_modules'))
  symlinkSync(resolve('out/tui'), join(directory, 'node_modules/myssh-tui'), 'junction')
  const result = spawnSync(process.execPath, ['examples/stage-06-kubernetes/user_code/main.mjs', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_PATH: join(directory, 'node_modules') } })
  process.exitCode = result.status ?? 1
} finally { rmSync(directory, { recursive: true, force: true }) }
