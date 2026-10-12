// This script runs inside Node SEA; only built-in modules can be loaded initially.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { deserialize } = require('node:v8')
const { brotliDecompressSync } = require('node:zlib')
const { getAsset } = require('node:sea')
const { createRequire } = require('node:module')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-runtime-'))
fs.chmodSync(directory, 0o700)
function cleanup() {
  // Windows may keep loaded native DLLs locked until the process has fully exited.
  try { fs.rmSync(directory, { recursive: true, force: true }) } catch { /* no credentials are stored here */ }
}
process.once('exit', cleanup)
try {
  const entries = deserialize(brotliDecompressSync(Buffer.from(getAsset('application'))))
  for (const [name, bytes] of entries) {
    if (typeof name !== 'string' || name.includes('\\') || path.posix.isAbsolute(name) || name.split('/').includes('..')) throw new Error('Invalid embedded application path')
    const destination = path.join(directory, name)
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
    fs.writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' })
  }
  createRequire(path.join(directory, 'package.json'))('./myssh.cjs')
} catch (error) {
  cleanup()
  throw error
}
