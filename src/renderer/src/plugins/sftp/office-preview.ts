import * as XLSX from 'xlsx'

export const OFFICE_PREVIEW_LIMITS = {
  maxRows: 1000,
  maxColumns: 100,
  maxCells: 100_000,
  maxHtmlBytes: 2 * 1024 * 1024
} as const

const textEncoder = new TextEncoder()

export interface SpreadsheetPreviewResult {
  html: string
  limited: boolean
}

export interface HtmlPreviewResult {
  html: string
  limited: boolean
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function cellText(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const denseData = sheet['!data'] as XLSX.CellObject[][] | undefined
  const cell = denseData
    ? denseData[row]?.[col]
    : (sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined)
  if (!cell) return ''
  try {
    return XLSX.utils.format_cell(cell)
  } catch {
    return String(cell.v ?? '')
  }
}

export function renderWorksheetPreview(sheet: XLSX.WorkSheet): SpreadsheetPreviewResult {
  const actualRef = typeof sheet['!ref'] === 'string' ? XLSX.utils.decode_range(sheet['!ref']) : null
  const fullRef = typeof sheet['!fullref'] === 'string' ? XLSX.utils.decode_range(sheet['!fullref']) : actualRef
  if (!actualRef || !fullRef) throw new Error('表格中没有可预览的工作表')

  const requestedRows = Math.max(0, fullRef.e.r - fullRef.s.r + 1)
  const requestedColumns = Math.max(0, fullRef.e.c - fullRef.s.c + 1)
  const availableRows = Math.max(0, actualRef.e.r - actualRef.s.r + 1)
  const availableColumns = Math.max(0, actualRef.e.c - actualRef.s.c + 1)
  const maxCellsByRows = Math.max(1, Math.floor(OFFICE_PREVIEW_LIMITS.maxCells / Math.max(1, Math.min(requestedColumns, OFFICE_PREVIEW_LIMITS.maxColumns))))
  const rows = Math.min(availableRows, OFFICE_PREVIEW_LIMITS.maxRows, maxCellsByRows)
  const columns = Math.min(availableColumns, OFFICE_PREVIEW_LIMITS.maxColumns)
  let limited = rows < requestedRows || columns < requestedColumns || rows * columns < requestedRows * requestedColumns

  const parts: string[] = ['<table><tbody>']
  const closing = '</tbody></table>'
  const closingBytes = textEncoder.encode(closing).byteLength
  let length = textEncoder.encode(parts[0]).byteLength
  for (let row = 0; row < rows; row++) {
    const cells: string[] = []
    for (let col = 0; col < columns; col++) {
      cells.push(`<td>${escapeHtml(cellText(sheet, actualRef.s.r + row, actualRef.s.c + col))}</td>`)
    }
    const rowHtml = `<tr>${cells.join('')}</tr>`
    const rowBytes = textEncoder.encode(rowHtml).byteLength
    if (length + rowBytes + closingBytes > OFFICE_PREVIEW_LIMITS.maxHtmlBytes) {
      limited = true
      break
    }
    parts.push(rowHtml)
    length += rowBytes
  }
  if (limited) {
    const note = '<tr><td colspan="100">预览已限制，仅展示表格的部分内容。</td></tr>'
    if (length + textEncoder.encode(note).byteLength + closingBytes <= OFFICE_PREVIEW_LIMITS.maxHtmlBytes) parts.push(note)
  }
  parts.push(closing)
  return { html: parts.join(''), limited }
}

/** 限制任意 Office 转换器生成的 HTML,避免 DOCX 等格式绕过表格渲染上限。 */
export function limitHtmlPreview(html: string): HtmlPreviewResult {
  if (textEncoder.encode(html).byteLength <= OFFICE_PREVIEW_LIMITS.maxHtmlBytes) {
    return { html, limited: false }
  }

  const note = '<p>预览已限制,请下载文件查看完整内容。</p>'
  let low = 0
  let high = html.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textEncoder.encode(html.slice(0, middle) + note).byteLength <= OFFICE_PREVIEW_LIMITS.maxHtmlBytes) low = middle
    else high = middle - 1
  }
  let prefix = html.slice(0, low)
  const lastTagEnd = prefix.lastIndexOf('>')
  if (lastTagEnd >= 0) prefix = prefix.slice(0, lastTagEnd + 1)
  while (prefix && textEncoder.encode(prefix + note).byteLength > OFFICE_PREVIEW_LIMITS.maxHtmlBytes) {
    prefix = prefix.slice(0, -1)
  }
  return { html: prefix + note, limited: true }
}

export function parseSpreadsheetPreview(bytes: Uint8Array): SpreadsheetPreviewResult {
  const workbook = XLSX.read(bytes, {
    type: 'array',
    sheets: 0,
    sheetRows: OFFICE_PREVIEW_LIMITS.maxRows,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookDeps: false,
    bookFiles: false,
    bookVBA: false
  })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) throw new Error('表格中没有可预览的工作表')
  return renderWorksheetPreview(workbook.Sheets[firstSheet])
}
