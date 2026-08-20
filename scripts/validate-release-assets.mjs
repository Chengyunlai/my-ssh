import { createHash } from 'node:crypto'
import {
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MEBIBYTE = 1024 * 1024

export function expectedReleaseAssets(version) {
  return [
    `MySSH-${version}-linux-x86_64.AppImage`,
    `MySSH-${version}-mac-arm64.dmg`,
    `MySSH-${version}-mac-arm64.dmg.blockmap`,
    `MySSH-${version}-mac-arm64.zip`,
    `MySSH-${version}-mac-arm64.zip.blockmap`,
    `MySSH-${version}-win-x64.exe`,
    `MySSH-${version}-win-x64.exe.blockmap`,
    'latest-linux.yml',
    'latest-mac.yml',
    'latest.yml'
  ].sort()
}

function assertSize(name, size) {
  if (name.endsWith('.yml')) {
    if (size < 1 || size > MEBIBYTE) {
      throw new Error(`${name} must be between 1 byte and 1 MiB`)
    }
    return
  }

  if (name.endsWith('.blockmap')) {
    if (size < 1 || size > 32 * MEBIBYTE) {
      throw new Error(`${name} must be between 1 byte and 32 MiB`)
    }
    return
  }

  if (size < MEBIBYTE || size > 2 * 1024 * MEBIBYTE) {
    throw new Error(`${name} must be between 1 MiB and 2 GiB`)
  }
}

function sha512(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

function parseUpdateMetadata(path, expectedVersion) {
  const source = readFileSync(path, 'utf8')
  const version = source.match(/^version:\s*([^\s]+)\s*$/m)?.[1]
  if (version !== expectedVersion) {
    throw new Error(`${basename(path)} version must be ${expectedVersion}`)
  }

  const entries = [...source.matchAll(
    /^\s*-\s+url:\s*([^\s]+)\s*\r?\n\s+sha512:\s*([^\s]+)\s*\r?\n\s+size:\s*(\d+)\s*$/gm
  )].map((match) => ({
    name: match[1],
    sha512: match[2],
    size: Number(match[3])
  }))

  if (entries.length === 0) {
    throw new Error(`${basename(path)} has no valid update file entries`)
  }
  return entries
}

export async function validateReleaseAssets(directory, version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`)
  }

  const entries = readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Release artifact must be a regular file: ${entry.name}`)
    }
  }

  const actual = entries.map((entry) => entry.name).sort()
  const expected = expectedReleaseAssets(version)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release asset set mismatch\nExpected: ${expected.join(', ')}\nActual: ${actual.join(', ')}`
    )
  }

  for (const name of actual) {
    const path = join(directory, name)
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Release artifact cannot be a symbolic link: ${name}`)
    }
    assertSize(name, statSync(path).size)
  }

  const metadataTargets = new Map([
    ['latest.yml', `MySSH-${version}-win-x64.exe`],
    ['latest-mac.yml', `MySSH-${version}-mac-arm64.zip`],
    ['latest-linux.yml', `MySSH-${version}-linux-x86_64.AppImage`]
  ])

  for (const [metadata, requiredTarget] of metadataTargets) {
    const updateEntries = parseUpdateMetadata(join(directory, metadata), version)
    if (!updateEntries.some((entry) => entry.name === requiredTarget)) {
      throw new Error(`${metadata} must reference ${requiredTarget}`)
    }

    for (const entry of updateEntries) {
      if (!expected.includes(entry.name) || entry.name.endsWith('.yml')) {
        throw new Error(`${metadata} references unexpected asset: ${entry.name}`)
      }
      const target = join(directory, entry.name)
      const size = statSync(target).size
      if (entry.size !== size) {
        throw new Error(`${metadata} size does not match ${entry.name}`)
      }
      if (entry.sha512 !== await sha512(target)) {
        throw new Error(`${metadata} sha512 does not match ${entry.name}`)
      }
    }
  }

  return actual
}

const invokedPath = process.argv[1] && pathToFileURL(process.argv[1]).href
if (import.meta.url === invokedPath) {
  const [directory, version] = process.argv.slice(2)
  if (!directory || !version) {
    throw new Error('Usage: validate-release-assets.mjs <directory> <version>')
  }
  const assets = await validateReleaseAssets(directory, version)
  console.log(`Validated ${assets.length} release assets for v${version}`)
}
