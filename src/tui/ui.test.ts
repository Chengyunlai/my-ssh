import { describe, expect, it } from 'vitest'
import { fit, plain } from './ui'
import { editorCommand } from './editor'

describe('TUI untrusted display and editor arguments', () => {
  it('removes control bytes from remote names and previews', () => {
    expect(plain('safe\x1b]52;c;secret\x07\nnext\r')).toBe('safe]52;c;secret\nnext')
    expect(fit('中文ab', 5)).toBe('中文a')
    expect(fit('a\nb', 5)).toBe('a b')
  })

  it('parses editor arguments without invoking a shell', () => {
    expect(editorCommand('code --wait')).toEqual(['code', '--wait'])
    expect(editorCommand('"C:\\Program Files\\Editor\\edit.exe" --wait')).toEqual(['C:\\Program Files\\Editor\\edit.exe', '--wait'])
    expect(editorCommand('vi $(touch nope)')).toEqual(['vi', '$(touch', 'nope)'])
    expect(() => editorCommand('"unclosed')).toThrow('引号')
  })
})
