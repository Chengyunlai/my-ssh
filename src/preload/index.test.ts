import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  expose: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: {
    invoke: mocks.invoke,
    send: mocks.send,
    on: mocks.on,
    removeListener: mocks.removeListener
  },
  webUtils: { getPathForFile: vi.fn() }
}))

import './index'

describe('preload monitor API', () => {
  beforeEach(() => mocks.invoke.mockReset())

  it('only forwards a sessionId to the typed monitor channel', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, value: { ok: false, error: { code: 'unsupported' } } })
    const api = mocks.expose.mock.calls[0][1] as { monitor: { getSnapshot(sessionId: string): Promise<unknown> } }

    const result = await api.monitor.getSnapshot('session-1')

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } })
    expect(mocks.invoke).toHaveBeenCalledWith('monitor:snapshot', 'session-1')
  })

  it('only forwards a sessionId to the service scan channel', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, value: { ok: true, snapshot: { counts: {} } } })
    const api = mocks.expose.mock.calls[0][1] as {
      serviceScan: { run(sessionId: string): Promise<unknown> }
    }

    const result = await api.serviceScan.run('session-1')

    expect(result).toMatchObject({ ok: true })
    expect(mocks.invoke).toHaveBeenCalledWith('service-scan:run', 'session-1')
  })

  it('forwards the address to the external-open channel and unwraps the verdict', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, value: false })
    const api = mocks.expose.mock.calls[0][1] as {
      openExternal(url: string): Promise<boolean>
    }

    // 拒绝走返回值而不是抛异常：渲染端要能把「不能打开」显示成不可点，而不是当成崩溃
    await expect(api.openExternal('file:///etc/passwd')).resolves.toBe(false)
    expect(mocks.invoke).toHaveBeenCalledWith('shell:open-external', 'file:///etc/passwd')
  })
})
