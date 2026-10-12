import { build } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const output = path.join(root, 'out/tui')
const dependencies = Object.fromEntries(['ssh2', '@xterm/headless', '@xterm/addon-serialize'].map((name) => [name, pkg.dependencies[name] || pkg.devDependencies[name]]))
fs.rmSync(output, { recursive: true, force: true })
for (const [entry, filename] of [['src/tui/index.ts', 'myssh.cjs'], ['src/core/index.ts', 'core.cjs']]) {
  await build({
    root, configFile: false, define: { __MYSSH_VERSION__: JSON.stringify(pkg.version) },
    build: {
      ssr: path.join(root, entry), outDir: output, emptyOutDir: false, sourcemap: false,
      rollupOptions: { external: Object.keys(dependencies), output: { format: 'cjs', entryFileNames: filename } }
    }
  })
}
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({
  name: 'myssh-tui', version: pkg.version, description: 'MySSH terminal interface and Electron-independent SSH core',
  license: pkg.license, bin: { myssh: './myssh.cjs' }, main: './core.cjs',
  exports: { './core': { types: './types/core/index.d.ts', require: './core.cjs', default: './core.cjs' } },
  files: ['*.cjs', 'types', 'README.md', 'LICENSE'], engines: pkg.engines,
  dependencies, repository: pkg.repository
}, null, 2) + '\n')
fs.writeFileSync(path.join(output, 'README.md'), fs.readFileSync(path.join(root, 'docs/TUI.md'), 'utf8').replace(/myssh-tui-\d+\.\d+\.\d+\.tgz/g, `myssh-tui-${pkg.version}.tgz`))
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'))
fs.chmodSync(path.join(output, 'myssh.cjs'), 0o755)
fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
