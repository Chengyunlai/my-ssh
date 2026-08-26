import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { OFFICE_PREVIEW_LIMITS, limitHtmlPreview, parseSpreadsheetPreview, renderWorksheetPreview } from './office-preview'

function workbookBytes(rows: unknown[][], bookType: 'xlsx' | 'xls' = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }))
}

describe('spreadsheet preview limits', () => {
  it('caps generated Office HTML by UTF-8 bytes', () => {
    const result = limitHtmlPreview(`<p>${'表格内容'.repeat(500_000)}</p>`)

    expect(result.limited).toBe(true)
    expect(new TextEncoder().encode(result.html).byteLength).toBeLessThanOrEqual(OFFICE_PREVIEW_LIMITS.maxHtmlBytes)
    expect(result.html).toContain('请下载文件查看完整内容')
  })

  it('renders a small workbook with escaped cell values', () => {
    const html = parseSpreadsheetPreview(workbookBytes([['<unsafe>', '&value'], ['ok', 'done']])).html

    expect(html).toContain('&lt;unsafe&gt;')
    expect(html).toContain('&amp;value')
    expect(html).not.toContain('<unsafe>')
  })

  it('limits rows and columns before producing HTML', () => {
    const rows = Array.from({ length: OFFICE_PREVIEW_LIMITS.maxRows + 20 }, (_, row) =>
      Array.from({ length: OFFICE_PREVIEW_LIMITS.maxColumns + 20 }, (_, col) => `${row}:${col}`)
    )
    const result = parseSpreadsheetPreview(workbookBytes(rows))

    expect(result.limited).toBe(true)
    expect(result.html.length).toBeLessThanOrEqual(OFFICE_PREVIEW_LIMITS.maxHtmlBytes)
    expect(result.html).toContain('预览已限制')
  })

  it('marks a workbook truncated by the parser row limit', () => {
    const rows = Array.from({ length: OFFICE_PREVIEW_LIMITS.maxRows + 20 }, (_, row) => [row])
    const result = parseSpreadsheetPreview(workbookBytes(rows))

    expect(result.limited).toBe(true)
  })

  it('keeps the legacy XLS preview path working', () => {
    const html = parseSpreadsheetPreview(workbookBytes([['legacy'], ['xls']], 'xls')).html

    expect(html).toContain('legacy')
    expect(html).toContain('xls')
  })

  it('rejects a workbook without a worksheet', () => {
    expect(() => renderWorksheetPreview({} as XLSX.WorkSheet)).toThrow()
  })
})
