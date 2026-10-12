import { it, expect } from 'vitest'
import { csvResult, sortMysqlResult } from './mysql-results'

it('exports commas, quotes, newline, NULL and untrusted spreadsheet formulas safely', () => {
  expect(csvResult({ columns: ['message'], rows: [['a,"b\nc'], ['=HYPERLINK("bad")'], [null], ['-123']], limited: false }))
    .toBe('"message"\r\n"a,""b\nc"\r\n"\'=HYPERLINK(""bad"")"\r\n""\r\n"-123"\r\n')
})

it('sorts a separate result without mutating the server row order', () => {
  const result = { columns: ['id'], rows: [['10'], ['2']], limited: false }
  expect(sortMysqlResult(result, 0, false).rows).toEqual([['2'], ['10']])
  expect(result.rows).toEqual([['10'], ['2']])
})
