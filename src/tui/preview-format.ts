export const PREVIEW_LIMITS = { bytes: 5 * 1024 * 1024, pixels: 12_000_000, expandedZip: 32 * 1024 * 1024, timeout: 15_000, text: 65_536 } as const

export interface PreviewRequest { bytes: Uint8Array; filename: string; page: number; columns: number; rows: number }
export interface PreviewPage { lines?: string[]; text: string; pages: number; label: string }

/** Only generated RGB integers become ANSI sequences; document bytes never become terminal commands. */
export function colorBlocks(pixels: Uint8ClampedArray, width: number, height: number): string[] {
  const rgb = (x: number, y: number): string => {
    if (y >= height) return '255;255;255'
    const offset = (y * width + x) * 4
    const alpha = pixels[offset + 3] / 255
    return [0, 1, 2].map((i) => Math.round(pixels[offset + i] * alpha + 255 * (1 - alpha))).join(';')
  }
  const lines: string[] = []
  for (let y = 0; y < height; y += 2) {
    let line = ''
    for (let x = 0; x < width; x++) line += `\x1b[38;2;${rgb(x, y)}m\x1b[48;2;${rgb(x, y + 1)}m▀`
    lines.push(line + '\x1b[0m')
  }
  return lines
}

export function rasterSize(width: number, height: number, columns: number, rows: number): { width: number; height: number } {
  if (!Number.isFinite(width * height) || width < 1 || height < 1 || width * height > PREVIEW_LIMITS.pixels) throw new Error('图片尺寸无效或超过 12 MP 上限')
  const scale = Math.min(Math.max(1, Math.min(160, columns)) / width, Math.max(2, Math.min(100, rows * 2)) / height)
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/** Check OOXML central directory before parsers inflate attacker-controlled ZIP entries. */
export function checkOfficeZip(bytes: Uint8Array): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (data.length < 4) throw new Error('Office 文件不完整')
  if (data.readUInt32LE(0) !== 0x04034b50) return
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('Office ZIP 目录损坏')
  const count = data.readUInt16LE(end + 10)
  let offset = data.readUInt32LE(end + 16)
  let total = 0
  if (count > 10000 || count === 0xffff || offset === 0xffffffff) throw new Error('Office ZIP 条目过多或不支持 ZIP64')
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('Office ZIP 条目损坏')
    const flags = data.readUInt16LE(offset + 8)
    const expanded = data.readUInt32LE(offset + 24)
    total += expanded
    if (flags & 1 || expanded === 0xffffffff || total > PREVIEW_LIMITS.expandedZip) throw new Error('Office ZIP 加密或展开内容超过 32 MiB 上限')
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
  }
  if (offset !== end) throw new Error('Office ZIP 目录范围无效')
}
