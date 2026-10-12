import { expect, it, vi } from 'vitest'
import { CoreEventHub } from '../core/host'
import type { MySshCore } from '../core'
import { ShellScreens } from './shells'

it('forwards split UTF-8 input intact and discards pending input when leaving a Shell', async () => {
  const events = new CoreEventHub()
  const sendData = vi.fn()
  const core = { events, ssh: { resize: vi.fn(), sendData } } as unknown as MySshCore
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const screens = new ShellScreens(core)
  events.send('ssh:shell-status', { sessionId: 'demo', shellId: 'main', status: 'connected' })
  const screen = screens.list('demo')[0]
  try {
    const attached = screens.attach(screen)
    await vi.waitFor(() => expect(process.stdin.listenerCount('data')).toBeGreaterThan(0))
    const chinese = Buffer.from('你好🙂')
    for (const byte of chinese) process.stdin.emit('data', Buffer.from([byte]))
    expect(sendData.mock.calls.map((call) => call[2]).join('')).toBe('你好🙂')
    process.stdin.emit('data', Buffer.from([0xe4]))
    process.stdin.emit('data', Buffer.from([0x1d]))
    await attached
    sendData.mockClear()
    const again = screens.attach(screen)
    await vi.waitFor(() => expect(process.stdin.listenerCount('data')).toBeGreaterThan(0))
    process.stdin.emit('data', Buffer.from('new\x1d'))
    await again
    expect(sendData).toHaveBeenCalledWith('demo', 'main', 'new')
  } finally { screens.dispose(); output.mockRestore() }
})
