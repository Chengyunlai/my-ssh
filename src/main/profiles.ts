import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Profile } from '@shared/types'

interface StoredProfile extends Omit<Profile, 'password' | 'passphrase'> {
  /** base64:优先 safeStorage(Keychain)加密,不可用时退化为明文 base64 */
  password?: string
  passphrase?: string
}

function file(): string {
  return path.join(app.getPath('userData'), 'profiles.json')
}

function readAll(): StoredProfile[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf-8'))
  } catch {
    return []
  }
}

function writeAll(list: StoredProfile[]): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(list, null, 2))
}

function encrypt(value?: string): string | undefined {
  if (!value) return undefined
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  return Buffer.from(value, 'utf-8').toString('base64')
}

function decrypt(value?: string): string | undefined {
  if (!value) return undefined
  const buf = Buffer.from(value, 'base64')
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  }
  return buf.toString('utf-8')
}

export function listProfiles(): Profile[] {
  return readAll().map((p) => ({
    ...p,
    password: decrypt(p.password),
    passphrase: decrypt(p.passphrase)
  }))
}

export function saveProfile(profile: Profile): Profile {
  const list = readAll()
  const stored: StoredProfile = {
    ...profile,
    password: encrypt(profile.password),
    passphrase: encrypt(profile.passphrase)
  }
  const idx = list.findIndex((p) => p.id === profile.id)
  if (idx >= 0) list[idx] = stored
  else list.push(stored)
  writeAll(list)
  return profile
}

export function deleteProfile(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id))
}
