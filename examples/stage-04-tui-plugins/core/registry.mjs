import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { terminalDescriptor } from '../../stage-05-tui-compatibility/user_code/main.mjs'

/** Synthetic marketplace speaking the real terminal descriptor contract. */
export async function startRegistryFixture() {
  const resources = new Map()
  const plugins = [
    ['fixture-mysql', 'MySQL fixture', { kind: 'mysql' }],
    ['fixture-commands', 'Commands fixture', { kind: 'commands', categories: [{ name: 'Fixture', commands: [{ command: 'hello', description: 'Synthetic SSH echo', example: 'hello' }] }] }],
    ['fixture-monitor', 'Monitor fixture', { kind: 'monitor' }]
  ].map(([id, name, contribution]) => {
    const descriptor = Buffer.from(JSON.stringify(id === 'fixture-commands' ? terminalDescriptor(id) : { schema: 1, id, contributions: [contribution] }))
    resources.set(`/${id}/terminal.json`, descriptor)
    return { id, name, version: '1.0.0', description: 'Synthetic terminal plugin', official: true,
      tui: { kind: 'tui-declarative-v1', minAppVersion: '1.5.0', entry: `${id}/terminal.json`, sha256: createHash('sha256').update(descriptor).digest('hex') } }
  })
  resources.set('/registry.json', Buffer.from(JSON.stringify({ name: 'Synthetic market', plugins })))
  const server = createServer((request, response) => {
    const resource = resources.get(request.url)
    if (!resource) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': resource.length })
    response.end(resource)
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/registry.json`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }) }
}
