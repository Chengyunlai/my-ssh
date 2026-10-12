import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas'
import { imageSize } from 'image-size'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import UTIF from 'utif'
import { checkOfficeZip, colorBlocks, rasterSize, pdfAssetDirectory, PREVIEW_LIMITS, type PreviewRequest, type PreviewPage } from './preview-format'
import { plain } from './ui'

function clipped(value: string): string { return plain(value).slice(0, PREVIEW_LIMITS.text) + (value.length > PREVIEW_LIMITS.text ? '\n…预览已截断' : '') }

export async function renderPreview(request: PreviewRequest): Promise<PreviewPage> {
  const { bytes, filename, page } = request
  if (bytes.byteLength < 4 || bytes.byteLength > PREVIEW_LIMITS.bytes) throw new Error('预览要求完整文件，大小不超过 5 MiB')
  const extension = path.extname(filename).toLowerCase()
  if (extension === '.pdf') {
    const require = createRequire(__filename)
    const directory = path.dirname(require.resolve('pdfjs-dist/package.json'))
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, maxImageSize: PREVIEW_LIMITS.pixels,
      cMapUrl: pdfAssetDirectory(directory, 'cmaps'), cMapPacked: true,
      standardFontDataUrl: pdfAssetDirectory(directory, 'standard_fonts'),
      wasmUrl: pdfAssetDirectory(directory, 'wasm'), verbosity: 0 })
    try {
      const document = await loading.promise
      if (page < 0 || page >= document.numPages) throw new Error('PDF 页码超出范围')
      const current = await document.getPage(page + 1)
      const viewport = current.getViewport({ scale: 1 })
      const size = rasterSize(viewport.width, viewport.height, request.columns, request.rows)
      const scale = Math.min(size.width / viewport.width, size.height / viewport.height)
      const canvas = createCanvas(size.width, size.height)
      await current.render({ canvas: canvas as never, viewport: current.getViewport({ scale }) }).promise
      const text = await current.getTextContent()
      return { pages: document.numPages, label: `PDF · ${page + 1}/${document.numPages}`, lines: colorBlocks(canvas.getContext('2d').getImageData(0, 0, size.width, size.height).data, size.width, size.height),
        text: clipped(text.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')) }
    } finally { await loading.destroy() }
  }
  if (extension === '.xlsx' || extension === '.xls' || extension === '.docx') {
    checkOfficeZip(bytes)
    if (extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      return { pages: 1, label: 'DOCX · 文字预览', text: clipped(result.value) }
    }
    const workbook = XLSX.read(bytes, { type: 'array', sheetRows: 1000, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false })
    const name = workbook.SheetNames[page]
    if (!name) throw new Error('工作表不存在')
    const sheet = workbook.Sheets[name]
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
    range.e.c = Math.min(range.e.c, range.s.c + 99)
    range.e.r = Math.min(range.e.r, range.s.r + 999)
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, range, defval: '' })
    return { pages: workbook.SheetNames.length, label: `工作表 ${page + 1}/${workbook.SheetNames.length} · ${plain(name)}`,
      text: clipped(rows.map((row) => row.join(' | ')).join('\n') + '\n（每表最多 1000 行 / 100 列）') }
  }
  if (extension === '.doc') throw new Error('旧版 DOC 需要下载后转换为 DOCX，终端和桌面的 DOCX 解析器均不支持二进制 DOC')
  const dimensions = imageSize(bytes)
  const size = rasterSize(dimensions.width, dimensions.height, request.columns, request.rows)
  if (dimensions.type === 'svg' && /(?:<!DOCTYPE|<!ENTITY|<script|(?:href|url)\s*[=(:])/i.test(Buffer.from(bytes).toString('utf8'))) throw new Error('SVG 中包含外部引用或脚本，禁止预览')
  let image
  if (dimensions.type === 'tiff') {
    const buffer = Buffer.from(bytes)
    const frames = UTIF.decode(buffer)
    const frame = frames[0]
    if (!frame) throw new Error('TIFF 没有可预览图像')
    rasterSize(Number((frame.t256 as number[])[0]), Number((frame.t257 as number[])[0]), request.columns, request.rows)
    UTIF.decodeImage(buffer, frame)
    const source = createCanvas(frame.width, frame.height)
    source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0)
    image = source
  } else if (dimensions.type === 'ico') {
    const buffer = Buffer.from(bytes)
    const count = buffer.readUInt16LE(4)
    let embedded: Buffer | undefined
    for (let i = 0; i < count && 6 + (i + 1) * 16 <= buffer.length; i++) {
      const offset = 6 + i * 16
      const length = buffer.readUInt32LE(offset + 8)
      const start = buffer.readUInt32LE(offset + 12)
      if (start + length > buffer.length) throw new Error('ICO 条目损坏')
      const candidate = buffer.subarray(start, start + length)
      if (candidate.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { embedded = candidate; break }
    }
    if (!embedded) throw new Error('此 ICO 没有 PNG 图像，请下载后用本地应用查看')
    const inner = imageSize(embedded)
    rasterSize(inner.width, inner.height, request.columns, request.rows)
    image = await loadImage(embedded)
  } else image = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(size.width, size.height)
  canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height)
  return { pages: 1, label: `图片 · ${dimensions.width} × ${dimensions.height}`, text: '', lines: colorBlocks(canvas.getContext('2d').getImageData(0, 0, size.width, size.height).data, size.width, size.height) }
}
