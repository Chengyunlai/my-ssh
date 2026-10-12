import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { validateTuiPlugin } from '../../../out/tui/plugin.cjs'

// In an installed author project: import { validateTuiPlugin } from 'myssh-tui/plugin'.
export const categories = [{ name: '日常操作', commands: [{ command: 'hello', description: '示例服务回显', example: 'hello' }] }]

/** A React command panel and terminal entry can consume this same data; no UI source is executed. */
export function terminalDescriptor(id = 'sample-command-book') {
  return validateTuiPlugin({ schema: 1, id, contributions: [{ kind: 'commands', categories }] }, id)
}

export function buildMarket(directory) {
  const descriptor = terminalDescriptor()
  const bytes = Buffer.from(JSON.stringify(descriptor))
  const entry = `${descriptor.id}/terminal.json`
  fs.mkdirSync(path.join(directory, descriptor.id), { recursive: true })
  fs.writeFileSync(path.join(directory, entry), bytes)
  fs.writeFileSync(path.join(directory, 'registry.json'), JSON.stringify({ name: '第三方示例市场', plugins: [{
    id: descriptor.id, name: '示例命令手册', version: '1.0.0', description: '共用命令数据的终端入口', author: 'Example', category: 'terminal',
    tui: { kind: 'tui-declarative-v1', minAppVersion: '1.5.0', entry, sha256: createHash('sha256').update(bytes).digest('hex') }
  }] }, null, 2))
  return { registry: pathToFileURL(path.resolve(directory, 'registry.json')).href, entry: path.resolve(directory, entry) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const destination = process.argv[2] || '.dev/third-party-market'
  console.log(JSON.stringify(buildMarket(destination), null, 2))
}
