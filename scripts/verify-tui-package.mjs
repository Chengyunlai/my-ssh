import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { startFixture } from '../examples/stage-01-core-tui/core/server.mjs'
import { startMysqlFixture } from '../examples/stage-04-tui-plugins/core/mysql-server.mjs'

const execute = promisify(execFile)
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const tarball = path.resolve('dist', `myssh-tui-${pkg.version}.tgz`)
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-package-verify-'))
try {
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'myssh-install-fixture', version: '1.0.0', private: true }))
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run with npm run verify:tui-package')
  await execute(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory })
  assert.equal(fs.existsSync(path.join(directory, 'node_modules/electron')), false)
  assert.equal(fs.existsSync(path.join(directory, 'node_modules/react')), false)
  const binary = path.join(directory, 'node_modules/myssh-tui/myssh.cjs')
  const help = await execute(process.execPath, [binary, '--help'], { cwd: directory })
  assert.match(help.stdout, /Ctrl\+]/)
  const version = await execute(process.execPath, [binary, '--version'], { cwd: directory })
  assert.equal(version.stdout.trim(), pkg.version)
  const consumer = path.join(directory, 'consumer.mts')
  fs.writeFileSync(consumer, "import { createCore, type MySshCore, type Profile } from 'myssh-tui/core'; import { MysqlSession, type MysqlProfile } from 'myssh-tui/mysql'; import { validateTuiPlugin, type TuiPluginDescriptor } from 'myssh-tui/plugin'; const plugin: TuiPluginDescriptor = validateTuiPlugin({ schema: 1, id: 'author-plugin', contributions: [{kind:'monitor'}] }, 'author-plugin'); void plugin; const core: MySshCore = createCore(); const profile: Profile = {id:'demo',name:'demo',host:'127.0.0.1',port:22,username:'demo',authType:'password'}; const database: MysqlProfile = {id:'demo',name:'demo',host:'127.0.0.1',port:3306,user:'demo',password:'fixture'}; void database; void MysqlSession; void profile; core.dispose();")
  await execute(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', consumer], { cwd: directory })
  const esm = await execute(process.execPath, ['--input-type=module', '-e', "import { createCore } from 'myssh-tui/core'; createCore().dispose(); console.log('ESM_IMPORT_OK')"], { cwd: directory })
  assert.match(esm.stdout, /ESM_IMPORT_OK/)
  const core = await execute(process.execPath, ['-e', "const core = require('myssh-tui/core').createCore(); core.dispose(); console.log('CORE_IMPORT_OK')"], { cwd: directory })
  assert.match(core.stdout, /CORE_IMPORT_OK/)
  const validator = createRequire(path.join(directory, 'package.json'))('myssh-tui/plugin').validateTuiPlugin
  const descriptor = validator({ schema: 1, id: 'author-plugin', contributions: [{ kind: 'commands', categories: [{ name: 'Author', commands: [{ command: 'hello', description: 'Third-party example' }] }] }] }, 'author-plugin')
  const entry = path.join(directory, 'author-plugin', 'terminal.json')
  fs.mkdirSync(path.dirname(entry))
  const bytes = Buffer.from(JSON.stringify(descriptor))
  fs.writeFileSync(entry, bytes)
  assert.match((await execute(process.execPath, [binary, '--validate-plugin', entry], { cwd: directory })).stdout, /PLUGIN_OK author-plugin/)
  const { createHash } = await import('node:crypto')
  const { pathToFileURL } = await import('node:url')
  const registry = path.join(directory, 'registry.json')
  fs.writeFileSync(registry, JSON.stringify({ plugins: [{ id: 'author-plugin', name: 'Author', version: '1.0.0', description: 'Third-party example', official: true,
    tui: { kind: 'tui-declarative-v1', minAppVersion: '1.5.0', entry: 'author-plugin/terminal.json', sha256: createHash('sha256').update(bytes).digest('hex') } }] }))
  const home = path.join(directory, 'isolated-home')
  await execute(process.execPath, [binary, '--install-plugin', 'author-plugin', '--registry', pathToFileURL(registry).href], { cwd: directory, env: { ...process.env, MYSSH_TUI_HOME: home } })
  const installed = JSON.parse(fs.readFileSync(path.join(home, 'plugins/author-plugin.json'), 'utf8'))
  assert.equal(installed.enabled, false)
  assert.equal(installed.official, false)
  fs.writeFileSync(entry, JSON.stringify({ ...descriptor, contributions: [{ kind: 'execute-js', source: 'throw new Error("not executed")' }] }))
  const invalid = await execute(process.execPath, [binary, '--validate-plugin', entry], { cwd: directory }).then(() => null, (error) => error)
  assert.equal(invalid?.code, 1)
  assert.match(invalid.stderr, /不支持/)
  const mysqlFixture = await startMysqlFixture()
  const installedMysql = createRequire(path.join(directory, 'package.json'))('myssh-tui/mysql')
  let database
  try {
    database = await installedMysql.MysqlSession.connect(mysqlFixture.profile)
    assert.equal((await database.query('SELECT fixture')).rows[0][0], 'MYSQL_OK 你好')
  } finally { database?.close(); await mysqlFixture.close() }
  const fixture = await startFixture()
  const installedCore = createRequire(path.join(directory, 'package.json'))('myssh-tui/core').createCore()
  try {
    const ready = new Promise((resolve) => installedCore.events.on('ssh:shell-status', (event) => {
      if (event.status === 'connected') resolve()
    }))
    const { sessionId } = installedCore.ssh.connect(fixture.profile)
    await ready
    const preview = await installedCore.sftp.read(sessionId, '/home/demo/hello.txt')
    assert.equal(preview.content, 'Hello SFTP\n')
  } finally { installedCore.dispose(); await fixture.close() }
  const ttyGuard = await execute(process.execPath, [binary], { cwd: directory }).then(() => null, (error) => error)
  assert.equal(ttyGuard?.code, 1)
  assert.match(ttyGuard.stderr, /交互式终端/)
  console.log('Independent package verified: no Electron/React, help/version, public core import, third-party public contract/CLI install/rejection, and non-TTY guard.')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
