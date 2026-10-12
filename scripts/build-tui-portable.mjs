import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { serialize } from 'node:v8'
import { brotliCompressSync, constants } from 'node:zlib'
import { createHash } from 'node:crypto'
import { inject } from 'postject'

const root = path.resolve('.')
const manifest = JSON.parse(fs.readFileSync('out/tui/package.json', 'utf8'))
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run with npm run pack:tui-portable')
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Portable releases must be built with Node 22 LTS')
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-build-'))
try {
  fs.cpSync('out/tui', stage, { recursive: true })
  // Reuse the repository lock. npm recomputes dependency flags for this smaller root,
  // while preserving the exact resolved versions/integrities already locked in the repo.
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  lock.name = manifest.name
  lock.version = manifest.version
  lock.packages[''] = { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies }
  fs.writeFileSync(path.join(stage, 'package-lock.json'), JSON.stringify(lock))
  execFileSync(process.execPath, [npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' })
  execFileSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' })
  execFileSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--audit-level=high', '--registry=https://registry.npmjs.org'], { cwd: stage, stdio: 'inherit' })
  // Canvas optional platform packages are required for rendering. Reject an archive
  // that works only on help/version paths before producing a release executable.
  execFileSync(process.execPath, ['-e', "require('@napi-rs/canvas').createCanvas(1,1)"], { cwd: stage, stdio: 'inherit' })
  const runtimeDirectory = path.dirname(fs.realpathSync(process.execPath))
  const runtimeLicense = [path.join(runtimeDirectory, 'LICENSE'), path.join(runtimeDirectory, '..', 'LICENSE')]
    .find((filename) => fs.existsSync(filename) && fs.readFileSync(filename, 'utf8').includes('Node.js is licensed'))
  if (!runtimeLicense) throw new Error('Build with an official Node 22 distribution containing its LICENSE next to the runtime')
  fs.copyFileSync(runtimeLicense, path.join(stage, 'NODE-LICENSE'))
  const entries = []
  function collect(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const filename = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Embedded dependency cannot be a symlink: ${name}`)
      if (entry.isDirectory()) collect(filename, name)
      else if (entry.isFile()) entries.push([name, fs.readFileSync(filename)])
    }
  }
  collect(stage)
  const work = path.resolve('out/sea')
  fs.mkdirSync(work, { recursive: true })
  const asset = path.join(work, 'application.br')
  fs.writeFileSync(asset, brotliCompressSync(serialize(entries), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }))
  const blob = path.join(work, 'sea.blob')
  const config = path.join(work, 'sea.json')
  fs.writeFileSync(config, JSON.stringify({ main: path.join(root, 'scripts/sea-launcher.cjs'), output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets: { application: asset } }))
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' })
  const filename = `myssh-tui-${manifest.version}-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
  const output = path.resolve('dist', filename)
  fs.copyFileSync(process.execPath, output)
  fs.chmodSync(output, 0o755)
  if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', output])
  await inject(output, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {})
  })
  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', output])
  const digest = createHash('sha256').update(fs.readFileSync(output)).digest('hex')
  fs.writeFileSync(output + '.sha256', `${digest}  ${filename}\n`)
  console.log(`Portable TUI: ${output} (${fs.statSync(output).size} bytes, Node ${process.version})`)
} finally { fs.rmSync(stage, { recursive: true, force: true }) }
