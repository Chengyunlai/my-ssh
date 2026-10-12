import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Profile } from '@shared/types'
import { ProfileStore } from '../core/profiles'

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

const store = new ProfileStore({
  read: () => readAll().map((profile) => ({
    ...profile,
    password: decrypt(profile.password),
    passphrase: decrypt(profile.passphrase)
  })),
  write: (profiles) => writeAll(profiles.map((profile) => ({
    ...profile,
    password: encrypt(profile.password),
    passphrase: encrypt(profile.passphrase)
  })))
})

export function listProfiles(): Profile[] { return store.list() }
export function saveProfile(profile: Profile): Profile { return store.save(profile) }
export function deleteProfile(id: string): void { store.delete(id) }
