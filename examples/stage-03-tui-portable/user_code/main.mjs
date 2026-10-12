import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

// A synthetic 1×1 PNG, through the public CLI. Pass a SEA executable to avoid Node at runtime.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-example-'))
try {
  const image = path.join(directory, 'pixel.png')
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNZsAAAAASUVORK5CYII=', 'base64'))
  const command = process.argv[2] || process.execPath
  const args = process.argv[2] ? [] : [path.resolve('out/tui/myssh.cjs')]
  const result = spawnSync(command, [...args, '--preview', image], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
