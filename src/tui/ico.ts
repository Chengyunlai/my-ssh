import { rasterSize } from './preview-format'

export type IconImage = { png: Buffer } | { width: number; height: number; rgba: Uint8ClampedArray }

/** ICO uses bottom-up, padded DIB rows and a separate 1-bit transparency mask. */
export function decodeIcon(bytes: Uint8Array): IconImage {
  const data = Buffer.from(bytes)
  if (data.length < 22 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) throw new Error('ICO 头无效')
  const count = data.readUInt16LE(4)
  if (!count || count > 256 || 6 + count * 16 > data.length) throw new Error('ICO 目录损坏')
  const entries: Array<{ width: number; height: number; bytes: Buffer }> = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const length = data.readUInt32LE(entry + 8)
    const offset = data.readUInt32LE(entry + 12)
    if (offset < 6 + count * 16 || length < 8 || offset + length > data.length) throw new Error('ICO 条目损坏')
    entries.push({ width: data[entry] || 256, height: data[entry + 1] || 256, bytes: data.subarray(offset, offset + length) })
  }
  entries.sort((a, b) => b.width * b.height - a.width * a.height)
  const png = entries.find((entry) => entry.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  if (png) return { png: png.bytes }
  for (const entry of entries) {
    const bitmap = entry.bytes
    if (bitmap.length < 40) continue
    const header = bitmap.readUInt32LE(0)
    const width = bitmap.readInt32LE(4)
    const height = bitmap.readInt32LE(8) / 2
    const depth = bitmap.readUInt16LE(14)
    if (![40, 108, 124].includes(header) || ![1, 4, 8, 24, 32].includes(depth) || bitmap.readUInt32LE(16) !== 0) continue
    if (width !== entry.width || height !== entry.height || bitmap.readUInt16LE(12) !== 1) throw new Error('ICO 位图尺寸无效')
    rasterSize(width, height, 160, 50)
    const colors = depth <= 8 ? bitmap.readUInt32LE(32) || 1 << depth : 0
    if (colors > 1 << depth) throw new Error('ICO 调色板无效')
    const pixels = header + colors * 4
    const rowBytes = Math.ceil(width * depth / 32) * 4
    const maskBytes = Math.ceil(width / 32) * 4
    const mask = pixels + rowBytes * height
    if (mask > bitmap.length || mask < bitmap.length && mask + maskBytes * height > bitmap.length || depth !== 32 && mask + maskBytes * height > bitmap.length) throw new Error('ICO 位图截断')
    const rgba = new Uint8ClampedArray(width * height * 4)
    let hasAlpha = false
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = pixels + (height - 1 - y) * rowBytes
      const dest = (y * width + x) * 4
      let source: number
      if (depth <= 8) {
        const bit = x * depth
        const index = bitmap[row + Math.floor(bit / 8)] >> (8 - depth - bit % 8) & ((1 << depth) - 1)
        if (index >= colors) throw new Error('ICO 调色板索引无效')
        source = header + index * 4
      } else source = row + x * depth / 8
      rgba[dest] = bitmap[source + 2]; rgba[dest + 1] = bitmap[source + 1]; rgba[dest + 2] = bitmap[source]
      rgba[dest + 3] = depth === 32 ? bitmap[source + 3] : 255
      if (rgba[dest + 3]) hasAlpha = true
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dest = (y * width + x) * 4 + 3
      if (depth === 32 && !hasAlpha) rgba[dest] = 255
      if (mask + maskBytes * height <= bitmap.length && bitmap[mask + (height - 1 - y) * maskBytes + Math.floor(x / 8)] & (0x80 >> x % 8)) rgba[dest] = 0
    }
    return { width, height, rgba }
  }
  throw new Error('ICO 使用了不支持的压缩或位域格式，请下载查看')
}
