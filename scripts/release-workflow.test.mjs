import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n')

describe('release workflow', () => {
  const buildJob = workflow.match(/^  build:\n([\s\S]*?)(?=^  publish:)/m)?.[0] ?? ''
  const publishJob = workflow.match(/^  publish:\n[\s\S]*$/m)?.[0] ?? ''

  it('keeps publishing in one downstream job outside the build matrix', () => {
    expect(buildJob).toContain('strategy:')
    expect(buildJob).toContain('electron-builder --publish never')
    expect(buildJob).toContain('actions/upload-artifact@')
    expect(buildJob).not.toContain('gh release')
    expect(workflow).not.toContain('electron-builder --publish always')

    expect(publishJob).toContain('needs: build')
    expect(publishJob).toContain('actions/download-artifact@')
    expect(publishJob.match(/gh release (?:view|upload|create)/g)).toHaveLength(3)
    expect(publishJob).toContain('gh release upload')
    expect(publishJob).toContain('--clobber')
  })

  it('serializes publishing across tag pushes and manual runs', () => {
    expect(workflow).toContain('push:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(publishJob).toContain('group: release-publisher')
    expect(publishJob).toContain('cancel-in-progress: false')
  })

  it('runs the centralized asset contract before publishing', () => {
    const validator = 'node scripts/validate-release-assets.mjs release-artifacts'
    expect(publishJob.indexOf(validator)).toBeGreaterThan(-1)
    expect(publishJob.indexOf(validator)).toBeLessThan(publishJob.indexOf('gh release view'))
  })
})
