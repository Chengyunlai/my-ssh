import { describe, expect, it } from 'vitest'
import { checkOfficeZip, colorBlocks, rasterSize, pdfAssetDirectory } from './preview-format'
import { renderPreview } from './preview-render'
import { createCanvas, PDFDocument } from '@napi-rs/canvas'
import * as XLSX from 'xlsx'
import UTIF from 'utif'

const request = { filename: 'test.png', page: 0, columns: 40, rows: 12 }

describe('terminal document previews', () => {
  it('uses forward-slash terminated PDF resource paths on Windows and Unix', () => {
    expect(pdfAssetDirectory('D:\\my ssh\\node_modules\\pdfjs-dist', 'cmaps')).toBe('D:/my ssh/node_modules/pdfjs-dist/cmaps/')
    expect(pdfAssetDirectory('/tmp/my ssh/pdfjs-dist/', 'wasm')).toBe('/tmp/my ssh/pdfjs-dist/wasm/')
  })
  it('generates RGB sequences from pixels and preserves transparent backgrounds', () => {
    expect(colorBlocks(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 1, 2)).toEqual(['\x1b[38;2;255;0;0m\x1b[48;2;255;255;255m▀\x1b[0m'])
  })
  it('fits images and rejects decompression-bomb dimensions before decoding', () => {
    expect(rasterSize(800, 600, 40, 12)).toEqual({ width: 32, height: 24 })
    expect(() => rasterSize(100000, 100000, 40, 12)).toThrow('12 MP')
    expect(() => rasterSize(NaN, 100, 40, 12)).toThrow()
  })
  it('renders an actual PNG into bounded terminal pixels', async () => {
    const canvas = createCanvas(32, 24)
    canvas.getContext('2d').fillStyle = '#ff0000'
    canvas.getContext('2d').fillRect(0, 0, 32, 24)
    const result = await renderPreview({ ...request, bytes: canvas.toBuffer('image/png') })
    expect(result.lines).toHaveLength(12)
    expect(result.lines![0]).toContain('255;0;0')
  })
  it('rejects SVG external references before native decode', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="https://example.invalid/x.png"/></svg>')
    await expect(renderPreview({ ...request, filename: 'test.svg', bytes })).rejects.toThrow('外部引用')
  })
  it('decodes TIFF and ICO images with a real PNG payload', async () => {
    const bytes = new Uint8Array(8 * 8 * 4).fill(255)
    const tiff = Buffer.from(UTIF.encodeImage(bytes, 8, 8))
    expect((await renderPreview({ ...request, filename: 'test.tiff', bytes: tiff })).lines).toHaveLength(12)
    const png = createCanvas(8, 8).toBuffer('image/png')
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header[6] = header[7] = 8
    header.writeUInt32LE(png.length, 14)
    header.writeUInt32LE(22, 18)
    const result = await renderPreview({ ...request, filename: 'test.ico', bytes: Buffer.concat([header, png]) })
    expect(result.lines).toHaveLength(12)
  })
  it('rejects OOXML whose announced expanded content exceeds the limit', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['test']]), 'Sheet')
    const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]))
    bytes.writeUInt32LE(64 * 1024 * 1024, central + 24)
    expect(() => checkOfficeZip(bytes)).toThrow('32 MiB')
  })
  it('reads multiple workbooks without executing formula or terminal control bytes', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Hello\x1b[2J', 42]]), 'First')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second']]), 'Second')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const first = await renderPreview({ ...request, filename: 'test.xlsx', bytes })
    expect(first.pages).toBe(2)
    expect(first.text).toContain('42')
    expect(first.text).not.toContain('\x1b')
    expect((await renderPreview({ ...request, filename: 'test.xlsx', bytes, page: 1 })).text).toContain('Second')
  })
  it('renders PDF pages and extracts real text', async () => {
    const pdf = new PDFDocument()
    const context = pdf.beginPage(200, 200)
    context.font = '20px sans-serif'
    context.fillText('Hello PDF', 15, 30)
    pdf.endPage()
    pdf.beginPage(200, 200).fillRect(0, 0, 200, 200)
    pdf.endPage()
    const bytes = pdf.close()
    const result = await renderPreview({ ...request, filename: 'test.pdf', bytes })
    expect(result.pages).toBe(2)
    expect(result.lines).toHaveLength(12)
    expect(result.text.replace(/\s/g, '')).toContain('HelloPDF')
    await expect(renderPreview({ ...request, filename: 'test.pdf', bytes, page: 2 })).rejects.toThrow('页码')
  })
  it('rejects malformed, truncated and oversized documents', async () => {
    await expect(renderPreview({ ...request, filename: 'test.pdf', bytes: Buffer.from('not a pdf') })).rejects.toThrow()
    await expect(renderPreview({ ...request, bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).rejects.toThrow('5 MiB')
    expect(() => checkOfficeZip(Buffer.from('PK\x03\x04bad'))).toThrow('目录损坏')
  })
})
