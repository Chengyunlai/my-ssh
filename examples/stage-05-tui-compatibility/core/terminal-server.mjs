import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ssh2 from 'ssh2'

/** Synthetic loopback authentication; only launches the fixed test application in its own temp directory. */
export async function startTerminalFixture(mode, directory) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
  const clients = new Set()
  const children = new Set()
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client)
    client.on('error', () => {})
    client.once('close', () => clients.delete(client))
    client.on('authentication', (context) => context.method === 'password' && context.username === 'demo' && context.password === 'demo-fixture' ? context.accept() : context.reject())
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      let columns = 110, rows = 30
      let terminalChild
      session.on('pty', (acceptPty, _reject, info) => { columns = info.cols; rows = info.rows; acceptPty() })
      session.on('window-change', (acceptChange, _reject, info) => {
        columns = info.cols; rows = info.rows
        if (terminalChild && !terminalChild.stdin.destroyed) terminalChild.stdin.write(JSON.stringify({ resize: [columns, rows] }) + '\n')
        acceptChange?.()
      })
      session.on('shell', (acceptShell) => {
        const channel = acceptShell()
        const child = spawn('python3', [fileURLToPath(new URL('terminal-bridge.py', import.meta.url)), mode, directory, String(columns), String(rows)], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
        terminalChild = child
        children.add(child)
        let pending = ''
        child.stdout.on('data', (bytes) => {
          pending += bytes.toString('utf8')
          let end
          while ((end = pending.indexOf('\n')) >= 0) {
            const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1)
            if (message.output) channel.write(Buffer.from(message.output, 'base64'))
          }
        })
        child.stderr.on('data', () => {})
        channel.on('data', (bytes) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ input: bytes.toString('base64') }) + '\n') })
        child.stdin.on('error', () => {})
        child.once('error', () => channel.end())
        child.once('close', () => { children.delete(child); channel.end() })
        channel.once('close', () => { child.stdin.end() })
      })
    }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { port: server.address().port, close: async () => {
    for (const client of clients) client.destroy()
    for (const child of children) child.stdin.end()
    await Promise.all([...children].map((child) => new Promise((resolve) => child.once('close', resolve))))
    await new Promise((resolve) => server.close(resolve))
  } }
}
