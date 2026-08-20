import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  expectedReleaseAssets,
  validateReleaseAssets
} from './validate-release-assets.mjs'

const version = '1.2.3'
const temporaryDirectories = []

function digest(contents) {
  return createHash('sha512').update(contents).digest('base64')
}

function createValidFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'myssh-release-test-'))
  temporaryDirectories.push(directory)

  const payloads = new Map()
  for (const name of expectedReleaseAssets(version)) {
    if (name.endsWith('.yml')) continue
    const size = name.endsWith('.blockmap') ? 128 : 1024 * 1024
    const contents = Buffer.alloc(size, name.charCodeAt(0))
    payloads.set(name, contents)
    writeFileSync(join(directory, name), contents)
  }

  const metadata = new Map([
    ['latest.yml', `MySSH-${version}-win-x64.exe`],
    ['latest-mac.yml', `MySSH-${version}-mac-arm64.zip`],
    ['latest-linux.yml', `MySSH-${version}-linux-x86_64.AppImage`]
  ])
  for (const [name, target] of metadata) {
    const contents = payloads.get(target)
    writeFileSync(join(directory, name), [
      `version: ${version}`,
      'files:',
      `  - url: ${target}`,
      `    sha512: ${digest(contents)}`,
      `    size: ${contents.length}`,
      `path: ${target}`,
      `sha512: ${digest(contents)}`
    ].join('\n'))
  }
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('release asset validation', () => {
  it('accepts the exact asset set with matching update metadata', async () => {
    const directory = createValidFixture()
    await expect(validateReleaseAssets(directory, version)).resolves.toEqual(
      expectedReleaseAssets(version)
    )
  })

  it('rejects unapproved files', async () => {
    const directory = createValidFixture()
    writeFileSync(join(directory, 'unexpected.txt'), 'not approved')
    await expect(validateReleaseAssets(directory, version)).rejects.toThrow('asset set mismatch')
  })

  it('rejects metadata whose digest does not match its payload', async () => {
    const directory = createValidFixture()
    const metadata = join(directory, 'latest.yml')
    writeFileSync(metadata, readFile(metadata).replace(/sha512: [^\n]+/, 'sha512: invalid'))
    await expect(validateReleaseAssets(directory, version)).rejects.toThrow('sha512 does not match')
  })
})

function readFile(path) {
  return readFileSync(path, 'utf8')
}
