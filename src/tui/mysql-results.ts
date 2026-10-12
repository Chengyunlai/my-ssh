import type { MysqlQueryResult } from '../core/mysql'

export function csvResult(result: MysqlQueryResult): string {
  const cell = (value: string | null): string => {
    let text = value ?? ''
    const normalized = text.normalize('NFKC').trimStart()
    const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)
    if (/^[\t\r\n]/.test(text) || /^[=+@-]/.test(normalized) && !numeric) text = '\t' + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return [result.columns, ...result.rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function sortMysqlResult(result: MysqlQueryResult, column: number, descending: boolean): MysqlQueryResult {
  if (column < 0 || column >= result.columns.length) throw new Error('排序列不存在')
  return { ...result, rows: [...result.rows].sort((a, b) => (a[column] || '').localeCompare(b[column] || '', undefined, { numeric: true }) * (descending ? -1 : 1)) }
}
