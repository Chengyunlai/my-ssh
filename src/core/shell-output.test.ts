import { expect, it } from 'vitest'
import { CwdOutput } from './shell-output'

it('forwards tmux OSC color queries with ST and subsequent fullscreen output immediately', () => {
  const output = new CwdOutput()
  const frame = '\x1b]11;?\x1b\\\x1b[?1049hTMUX_READY'
  expect(output.push(frame)).toEqual({ text: frame, cwd: undefined })
  expect(output.push('\x1b]10;')).toEqual({ text: '\x1b]10;', cwd: undefined })
  expect(output.push('?\x1b\\next').text).toBe('?\x1b\\next')
})

it('tracks OSC 7 with BEL or split ST while preserving adjacent bytes', () => {
  const output = new CwdOutput()
  expect(output.push('before\x1b').text).toBe('before')
  expect(output.push(']7;file://localhost/hello%20').text).toBe('')
  expect(output.push('world\x1b').text).toBe('')
  expect(output.push('\\after')).toEqual({ text: 'after', cwd: '/hello world' })
  expect(output.push('\x1b]7;file://host/a\x07\x1b]7;file://host/b\x1b\\tail')).toEqual({ text: 'tail', cwd: '/b' })
})

it('bounds incomplete cwd sequences without buffering arbitrary application traffic', () => {
  const output = new CwdOutput()
  const incomplete = '\x1b]7;file://host/' + 'x'.repeat(9000)
  expect(output.push(incomplete).text).toBe(incomplete)
  expect(output.push('next').text).toBe('next')
})
