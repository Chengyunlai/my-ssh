import type { MysqlQueryResult } from '../core/mysql'

export function csvResult(result: MysqlQueryResult): string {
  const cell = (value: string | null): string => {
    let text = value ?? ''
    if (/^[=+@\t\r-]/.test(text) && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return [result.columns, ...result.rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function sortMysqlResult(result: MysqlQueryResult, column: number, descending: boolean): MysqlQueryResult {
  if (column < 0 || column >= result.columns.length) throw new Error('排序列不存在')
  return { ...result, rows: [...result.rows].sort((a, b) => (a[column] || '').localeCompare(b[column] || '', undefined, { numeric: true }) * (descending ? -1 : 1)) }
}
