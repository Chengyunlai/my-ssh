import { it, expect } from 'vitest'
import { csvResult, sortMysqlResult } from './mysql-results'

it('exports commas, quotes, newline, NULL and untrusted spreadsheet formulas safely', () => {
  expect(csvResult({ columns: ['message'], rows: [['a,"b\nc'], ['=HYPERLINK("bad")'], [null], ['-123']], limited: false }))
    .toBe('"message"\r\n"a,""b\nc"\r\n"\t=HYPERLINK(""bad"")"\r\n""\r\n"-123"\r\n')
})

it('protects leading whitespace/newline and full-width formula prefixes without normalizing exported data', () => {
  const output = csvResult({ columns: ['value'], rows: [['  ＝1+2'], ['\n=1+2'], ['＠SUM(A1)']], limited: false })
  expect(output).toContain('"\t  ＝1+2"')
  expect(output).toContain('"\t\n=1+2"')
  expect(output).toContain('"\t＠SUM(A1)"')
})

it('sorts a separate result without mutating the server row order', () => {
  const result = { columns: ['id'], rows: [['10'], ['2']], limited: false }
  expect(sortMysqlResult(result, 0, false).rows).toEqual([['2'], ['10']])
  expect(result.rows).toEqual([['10'], ['2']])
})
