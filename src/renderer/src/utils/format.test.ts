import { describe, expect, it } from 'vitest'
import { formatSize } from './format'

describe('formatSize', () => {
  it('formats byte values with binary units', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })

  it('rounds large unit values without decimals', () => {
    expect(formatSize(100 * 1024)).toBe('100 KB')
  })

  it('rejects invalid sizes', () => {
    expect(formatSize(-1)).toBe('—')
    expect(formatSize(Number.NaN)).toBe('—')
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
