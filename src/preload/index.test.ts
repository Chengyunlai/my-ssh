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
})
