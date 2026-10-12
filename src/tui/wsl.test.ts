import { expect, it } from 'vitest'
import { parseWslDistributions } from './wsl'

it('reads Windows UTF-16 and UTF-8 WSL output without shell interpolation', () => {
  expect(parseWslDistributions(Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'))).toEqual(['Ubuntu', 'Debian'])
  expect(parseWslDistributions(Buffer.from('Ubuntu\n'))).toEqual(['Ubuntu'])
  expect(parseWslDistributions(Buffer.from('bad\x1bname\n'))).toEqual([])
})
