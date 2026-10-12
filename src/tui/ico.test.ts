import { expect, it } from 'vitest'
import { decodeIcon } from './ico'

function icon(depth: number): Buffer {
  const colors = depth <= 8 ? 1 << depth : 0
  const bitmap = Buffer.alloc(40 + colors * 4 + 8 + 8)
  bitmap.writeUInt32LE(40); bitmap.writeInt32LE(2, 4); bitmap.writeInt32LE(4, 8)
  bitmap.writeUInt16LE(1, 12); bitmap.writeUInt16LE(depth, 14)
  const pixels = 40 + colors * 4
  if (colors) {
    bitmap[40 + 4 + 2] = 255 // palette 1 is red
    bitmap[pixels] = depth === 1 ? 0x80 : depth === 4 ? 0x10 : 1
    bitmap[pixels + 4] = depth === 1 ? 0x40 : depth === 4 ? 0x01 : 0
    if (depth === 8) bitmap[pixels + 5] = 1
  } else if (depth === 24) {
    // 2-pixel 24-bit rows require 8-byte padding, so expand the data below.
    const data = Buffer.alloc(40 + 16 + 8); bitmap.copy(data, 0, 0, 40)
    data[40 + 2] = 255; data[48 + 3 + 2] = 255
    return wrap(data)
  } else {
    const data = Buffer.alloc(40 + 16 + 8); bitmap.copy(data, 0, 0, 40)
    data[40 + 2] = 255; data[48 + 4 + 2] = 255
    data[56] = 0x80 // bottom-left is transparent; zero alpha falls back to AND mask.
    return wrap(data)
  }
  bitmap[pixels + 8] = 0x80
  return wrap(bitmap)
}
function wrap(bitmap: Buffer): Buffer {
  const data = Buffer.alloc(22 + bitmap.length)
  data.writeUInt16LE(1, 2); data.writeUInt16LE(1, 4); data[6] = 2; data[7] = 2
  data.writeUInt32LE(bitmap.length, 14); data.writeUInt32LE(22, 18); bitmap.copy(data, 22)
  return data
}

it.each([1, 4, 8, 24, 32])('decodes %i-bit bottom-up ICO DIB including padding and transparency', (depth) => {
  const decoded = decodeIcon(icon(depth))
  expect('rgba' in decoded).toBe(true)
  if (!('rgba' in decoded)) return
  expect([...decoded.rgba.slice(4, 8)]).toEqual([255, 0, 0, 255]) // top-right
  expect(decoded.rgba[8]).toBe(255) // bottom-left
  expect(decoded.rgba[11]).toBe(depth === 24 ? 255 : 0)
})

it('rejects truncated directory, payload, inconsistent dimensions and unsupported compression', () => {
  const bytes = icon(32)
  expect(() => decodeIcon(bytes.subarray(0, -1))).toThrow('条目')
  const dimensions = Buffer.from(bytes); dimensions.writeInt32LE(3, 22 + 4)
  expect(() => decodeIcon(dimensions)).toThrow('尺寸')
  const compressed = Buffer.from(bytes); compressed.writeUInt32LE(1, 22 + 16)
  expect(() => decodeIcon(compressed)).toThrow('不支持')
})
