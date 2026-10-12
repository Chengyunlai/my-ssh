import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalUI } from './ui'

const { spawn, execute } = vi.hoisted(() => ({ spawn: vi.fn(), execute: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  const execFile = Object.assign(vi.fn(), { [promisify.custom]: execute })
  return { execFile, spawn }
})
import { listWslDistributions, runWslDistribution, showWsl } from './wsl'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
let child: EventEmitter & { kill: ReturnType<typeof vi.fn> }
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  child = Object.assign(new EventEmitter(), { kill: vi.fn() })
  spawn.mockReset().mockReturnValue(child)
  execute.mockReset().mockResolvedValue({ stdout: Buffer.from('Ubuntu\r\nUbuntu\r\n', 'utf16le') })
})
afterEach(() => { Object.defineProperty(process, 'platform', originalPlatform); vi.restoreAllMocks() })

it('lists the system WSL using a cancellable, bounded call and deduplicates distributions', async () => {
  const signal = new AbortController().signal
  expect(await listWslDistributions(signal)).toEqual(['Ubuntu'])
  expect(execute).toHaveBeenCalledWith(expect.stringMatching(/System32[/\\]wsl.exe$/), ['--list', '--quiet'], expect.objectContaining({ signal, timeout: 15000, maxBuffer: 1024 * 1024 }))
})

it('waits for close, passes literal arguments without a shell, and cleans up cancellation listeners', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const running = runWslDistribution('Ubuntu name & literal', controller.signal)
  expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/System32[/\\]wsl.exe$/), ['--distribution', 'Ubuntu name & literal'], { stdio: 'inherit', shell: false })
  child.emit('exit', 0) // Pipes/stdio may still be open; completion requires close.
  child.emit('close', 0)
  await running
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})

it('kills only the owned child on abort and refuses launch after cancellation', async () => {
  const controller = new AbortController()
  const running = runWslDistribution('Ubuntu', controller.signal)
  controller.abort()
  expect(child.kill).toHaveBeenCalledOnce()
  child.emit('close', null)
  await expect(running).rejects.toThrow('取消')
  spawn.mockClear()
  await expect(runWslDistribution('Ubuntu', controller.signal)).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
})

it('restores the terminal after spawn failure and removes the abort listener', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const ui = { busy: (_title: string, result: Promise<unknown>) => result, menu: vi.fn().mockResolvedValue('Ubuntu'), suspend: vi.fn(), resume: vi.fn() }
  const running = showWsl(ui as unknown as TerminalUI, controller.signal)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  child.emit('error', new Error('fixture launch failure'))
  await expect(running).rejects.toThrow('fixture launch failure')
  expect(ui.suspend).toHaveBeenCalledOnce()
  expect(ui.resume).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})

it('shows the empty distribution state without launching a process', async () => {
  execute.mockResolvedValue({ stdout: Buffer.alloc(0) })
  const ui = { busy: (_title: string, result: Promise<unknown>) => result, view: vi.fn() }
  await showWsl(ui as unknown as TerminalUI)
  expect(ui.view).toHaveBeenCalledWith('WSL', expect.stringContaining('尚未安装'))
  expect(spawn).not.toHaveBeenCalled()
})

it('keeps the waiting host alive on console Ctrl+C and restores its signal handler after WSL exits', async () => {
  const original = process.listenerCount('SIGINT')
  const ui = { busy: (_title: string, result: Promise<unknown>) => result, menu: vi.fn().mockResolvedValue('Ubuntu'), suspend: vi.fn(), resume: vi.fn() }
  const running = showWsl(ui as unknown as TerminalUI)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  expect(process.listenerCount('SIGINT')).toBe(original + 1)
  process.emit('SIGINT')
  expect(child.kill).not.toHaveBeenCalled()
  child.emit('close', 0)
  await running
  expect(process.listenerCount('SIGINT')).toBe(original)
  expect(ui.resume).toHaveBeenCalledOnce()
})
