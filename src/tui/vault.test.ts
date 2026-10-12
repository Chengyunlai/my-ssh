import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedVault } from './vault'
import { ProfileStore } from '../core/profiles'

const directories: string[] = []
function file(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myssh-vault-test-'))
  directories.push(directory)
  return path.join(directory, 'profiles.vault.json')
}

afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

const profile = { id: 'fixture', name: 'demo', host: '127.0.0.1', port: 22, username: 'demo', authType: 'password' as const, password: 'never-plaintext', passphrase: 'also-secret' }

describe('encrypted TUI vault', () => {
  it('encrypts database passwords/history and binds the vault to its purpose', () => {
    const filename = file()
    const database = new EncryptedVault<{ password: string; history: string[] }>(filename, 'master-password', 'myssh-tui-databases-v1')
    const value = { password: 'database-secret', history: ['SELECT private_business_data'] }
    database.write([value])
    expect(database.read()).toEqual([value])
    const text = fs.readFileSync(filename, 'utf8')
    expect(text).not.toContain(value.password)
    expect(text).not.toContain(value.history[0])
    expect(() => new EncryptedVault(filename, 'master-password')).toThrow('无法解锁')
    database.dispose()
  })
  it('persists encrypted profiles and unlocks them with the correct password', () => {
    const filename = file()
    const vault = new EncryptedVault(filename, 'master-password')
    new ProfileStore(vault).save(profile)
    const disk = fs.readFileSync(filename, 'utf8')
    expect(disk).not.toContain(profile.password)
    expect(disk).not.toContain(profile.passphrase)
    expect(disk).not.toContain(profile.host)
    if (process.platform !== 'win32') expect(fs.statSync(filename).mode & 0o777).toBe(0o600)
    vault.dispose()
    const reopened = new EncryptedVault(filename, 'master-password')
    expect(new ProfileStore(reopened).list()).toEqual([profile])
    reopened.dispose()
  })

  it('wrong passwords and tampered ciphertext preserve the existing file', () => {
    const filename = file()
    const vault = new EncryptedVault(filename, 'master-password')
    vault.write([profile])
    const original = fs.readFileSync(filename, 'utf8')
    expect(() => new EncryptedVault(filename, 'wrong-password')).toThrow('无法解锁')
    expect(fs.readFileSync(filename, 'utf8')).toBe(original)
    const damaged = JSON.parse(original)
    damaged.tag = Buffer.alloc(16).toString('base64')
    fs.writeFileSync(filename, JSON.stringify(damaged))
    const corrupted = fs.readFileSync(filename, 'utf8')
    expect(() => new EncryptedVault(filename, 'master-password')).toThrow('无法解锁')
    expect(fs.readFileSync(filename, 'utf8')).toBe(corrupted)
    vault.dispose()
  })

  it('rejects invalid JSON and weak passwords without resetting storage', () => {
    const filename = file()
    expect(() => new EncryptedVault(filename, 'short')).toThrow('至少')
    fs.writeFileSync(filename, '{invalid')
    expect(() => new EncryptedVault(filename, 'master-password')).toThrow()
    expect(fs.readFileSync(filename, 'utf8')).toBe('{invalid')
  })
})
