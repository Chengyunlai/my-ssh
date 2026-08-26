import { describe, expect, it } from 'vitest'
import { scheduleTerminalRefit } from './terminal-layout'

describe('scheduleTerminalRefit', () => {
  it('only schedules a refit for an active terminal', () => {
    const callbacks = new Map<number, () => void>()
    const cancelled: number[] = []
    const scheduler = {
      schedule: (callback: () => void): number => {
        const id = callbacks.size + 1
        callbacks.set(id, callback)
        return id
      },
      cancel: (id: number): void => {
        cancelled.push(id)
        callbacks.delete(id)
      }
    }
    const refit = () => {}

    const inactiveCleanup = scheduleTerminalRefit(false, refit, scheduler)
    inactiveCleanup()
    expect(callbacks.size).toBe(0)
    expect(cancelled).toEqual([])

    const activeCleanup = scheduleTerminalRefit(true, refit, scheduler)
    expect(callbacks.size).toBe(1)
    activeCleanup()
    expect(cancelled).toEqual([1])
  })
})
