import { generateKeyPairSync } from 'node:crypto'
import path from 'node:path'
import ssh2 from 'ssh2'

const { Server, utils } = ssh2

const { STATUS_CODE, OPEN_MODE } = utils.sftp
const root = '/home/demo'
const metrics = [
  'MYSSH_METRICS_V1', '[stat]', 'cpu 10 0 10 80 0 0 0 0 0 0', '[loadavg]', '0.1 0.2 0.3 1/10 42',
  '[meminfo]', 'MemTotal: 102400 kB', 'MemAvailable: 51200 kB', 'SwapTotal: 0 kB', 'SwapFree: 0 kB',
  '[netdev]', 'eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0', '[df]',
  'Filesystem 1024-blocks Used Available Capacity Mounted on', '/dev/demo 102400 51200 51200 50% /',
  '[uptime]', '3600 0', 'END'
].join('\n') + '\n'
const services = [
  'MYSSH_NETLIST_V1', '[meta]', 'uid=1000', 'sudo=0', 'ssver=fixture', '[tcplisten]',
  'LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=42,fd=1))',
  '[udplisten]', '[containers]', '[nginxconf]', '[osrelease]', 'ID=fixture', 'PRETTY_NAME="Local SSH demo"',
  '[identity]', '1000', 'END'
].join('\n') + '\n'

/** 仅监听回环地址的虚拟服务，不执行系统命令、不访问本机文件。 */
export async function startFixture() {
  const files = new Map([[`${root}/hello.txt`, Buffer.from('Hello SFTP\n')]])
  const metadata = new Map()
  const directories = new Set(['/', '/home', root])
  const connections = new Set()
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    connections.add(client)
    client.once('close', () => connections.delete(client))
    client.on('error', () => {})
    client.on('authentication', (context) => {
      if (context.method === 'password' && context.username === 'demo' && context.password === 'demo-fixture') context.accept()
      else context.reject()
    })
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty())
      session.on('window-change', (acceptChange) => acceptChange?.())
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        stream.write('MySSH local fixture\r\nmyssh-demo$ ')
        let input = ''
        stream.on('data', (data) => {
          input += data.toString('utf8')
          let end
          while ((end = input.indexOf('\r')) >= 0) {
            const command = input.slice(0, end)
            input = input.slice(end + 1)
            if (command.startsWith('if [ -n "$BASH_VERSION" ]')) {
              stream.write(`\r\n\x1b]7;file://localhost${root}\x07myssh-demo$ `)
            } else if (command === 'exit') stream.end()
            else if (command === 'hello') {
              const output = Buffer.from('\r\nCORE_OK 你好\r\nmyssh-demo$ ')
              const split = output.indexOf(Buffer.from('你')) + 1
              stream.write(output.subarray(0, split))
              setImmediate(() => stream.write(output.subarray(split)))
            } else stream.write(`\r\nfixture: ${command}\r\nmyssh-demo$ `)
          }
        })
      })
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec()
        stream.end(info.command.includes('MYSSH_METRICS_V1') ? metrics : services)
      })
      session.on('sftp', (acceptSftp) => {
        const sftp = acceptSftp()
        const handles = new Map()
        let seq = 0
        const normalize = (value) => path.posix.resolve(root, value)
        const attrs = (filename) => ({ mode: metadata.get(filename)?.mode ?? (directories.has(filename) ? 0o40755 : 0o100644), uid: metadata.get(filename)?.uid ?? 1000, gid: metadata.get(filename)?.gid ?? 1000, size: files.get(filename)?.length || 0, atime: 1700000000, mtime: 1700000000 })
        const handle = (id, value) => { const key = Buffer.from(String(++seq)); handles.set(key.toString(), value); sftp.handle(id, key) }
        const status = (id, code = STATUS_CODE.OK) => sftp.status(id, code)
        sftp.on('REALPATH', (id, filename) => {
          const resolved = normalize(filename)
          sftp.name(id, [{ filename: resolved, longname: resolved, attrs: attrs(resolved) }])
        })
        for (const event of ['STAT', 'LSTAT']) sftp.on(event, (id, filename) => {
          const resolved = normalize(filename)
          if (!files.has(resolved) && !directories.has(resolved)) status(id, STATUS_CODE.NO_SUCH_FILE)
          else sftp.attrs(id, attrs(resolved))
        })
        sftp.on('FSTAT', (id, key) => {
          const opened = handles.get(key.toString())
          if (!opened) status(id, STATUS_CODE.FAILURE)
          else sftp.attrs(id, attrs(opened.filename))
        })
        sftp.on('OPENDIR', (id, filename) => {
          const resolved = normalize(filename)
          if (!directories.has(resolved)) status(id, STATUS_CODE.NO_SUCH_FILE)
          else handle(id, { filename: resolved, directory: true, read: false })
        })
        sftp.on('READDIR', (id, key) => {
          const opened = handles.get(key.toString())
          if (!opened || opened.read) { status(id, STATUS_CODE.EOF); return }
          opened.read = true
          const entries = [...directories, ...files.keys()].filter((filename) => filename !== opened.filename && path.posix.dirname(filename) === opened.filename)
          sftp.name(id, entries.map((filename) => ({ filename: path.posix.basename(filename), longname: filename, attrs: attrs(filename) })))
        })
        sftp.on('OPEN', (id, filename, flags, attributes) => {
          const resolved = normalize(filename)
          if (flags & OPEN_MODE.CREAT) {
            if (!files.has(resolved)) metadata.set(resolved, { mode: 0o100000 | (attributes?.mode ?? 0o666) })
            files.set(resolved, Buffer.alloc(0))
          }
          if (!files.has(resolved)) status(id, STATUS_CODE.NO_SUCH_FILE)
          else handle(id, { filename: resolved })
        })
        sftp.on('SETSTAT', (id, filename, attributes) => { metadata.set(normalize(filename), attributes); status(id) })
        sftp.on('READ', (id, key, offset, length) => {
          const opened = handles.get(key.toString())
          const content = opened && files.get(opened.filename)
          if (!content) status(id, STATUS_CODE.NO_SUCH_FILE)
          else if (offset >= content.length) status(id, STATUS_CODE.EOF)
          else sftp.data(id, content.subarray(offset, offset + length))
        })
        sftp.on('WRITE', (id, key, offset, data) => {
          const opened = handles.get(key.toString())
          if (!opened) { status(id, STATUS_CODE.FAILURE); return }
          const previous = files.get(opened.filename) || Buffer.alloc(0)
          const updated = Buffer.alloc(Math.max(previous.length, offset + data.length))
          previous.copy(updated); data.copy(updated, offset)
          files.set(opened.filename, updated)
          status(id)
        })
        sftp.on('CLOSE', (id, key) => { handles.delete(key.toString()); status(id) })
        sftp.on('MKDIR', (id, filename) => { directories.add(normalize(filename)); status(id) })
        sftp.on('RMDIR', (id, filename) => { directories.delete(normalize(filename)); status(id) })
        sftp.on('REMOVE', (id, filename) => { files.delete(normalize(filename)); status(id) })
        sftp.on('RENAME', (id, from, to) => {
          const source = normalize(from), target = normalize(to)
          if (!files.has(source)) { status(id, STATUS_CODE.NO_SUCH_FILE); return }
          files.set(target, files.get(source)); files.delete(source); metadata.set(target, metadata.get(source)); metadata.delete(source); status(id)
        })
      })
    }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const profile = { id: 'local-demo', name: 'Local demo', host: '127.0.0.1', port: server.address().port, username: 'demo', authType: 'password', password: 'demo-fixture' }
  return {
    profile, files, metadata,
    close: async () => {
      for (const client of connections) client.end()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
