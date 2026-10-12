import { createCore } from '../../../out/tui/core.cjs'
import { startFixture } from '../core/server.mjs'

const fixture = await startFixture()
const core = createCore()
try {
  const { sessionId } = core.ssh.connect(fixture.profile)
  const hello = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('没有收到 Shell 回显')), 5000)
    let output = ''
    core.events.on('ssh:output', (event) => {
      output += event.data
      if (output.includes('CORE_OK 你好')) { clearTimeout(timer); resolve('CORE_OK 你好') }
    })
    core.events.on('ssh:shell-status', (status) => {
      if (status.status === 'connected') core.ssh.sendData(sessionId, status.shellId, 'hello\r')
    })
  })
  console.log(await hello)
  const result = await core.sftp.read(sessionId, '/home/demo/hello.txt')
  console.log(result.content.trim())
} finally {
  core.dispose()
  await fixture.close()
}
