import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { startFixture } from '../examples/stage-01-core-tui/core/server.mjs'
import { previewFixtures } from './preview-fixtures.mjs'

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const name = `myssh-tui-${version}-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
const original = path.resolve('dist', name)
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-standalone-'))
const binary = path.join(directory, process.platform === 'win32' ? 'myssh.exe' : 'myssh')
try {
  const digest = createHash('sha256').update(fs.readFileSync(original)).digest('hex')
  assert.equal(fs.readFileSync(original + '.sha256', 'utf8').trim(), `${digest}  ${name}`)
  fs.copyFileSync(original, binary)
  fs.chmodSync(binary, 0o755)
  const options = { cwd: directory, env: { ...process.env, PATH: directory }, encoding: 'utf8', timeout: 30000 }
  assert.equal(execFileSync(binary, ['--version'], options).trim(), version)
  assert.match(execFileSync(binary, ['--help'], options), /--preview/)
  await previewFixtures(directory)
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['scripts/verify-preview.py', binary, directory, process.execPath], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' } })
  const tty = spawn(binary, [], { cwd: directory, env: options.env })
  let error = ''
  tty.stderr.on('data', (data) => { error += data })
  await new Promise((resolve, reject) => {
    tty.once('error', reject)
    tty.once('exit', (code) => { try { assert.equal(code, 1); assert.match(error, /交互式终端/); resolve() } catch (failure) { reject(failure) } })
  })
  const fixture = await startFixture()
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/verify-tui.py', String(fixture.profile.port), process.execPath, binary], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' } })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Portable PTY verification exited ${code}`)))
    })
  } finally { await fixture.close() }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-tui-plugins.mjs', binary], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Standalone plugin verification exited ${code}`)))
  })
  console.log('Standalone executable verified with no node/npm on PATH, outside the source checkout.')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
