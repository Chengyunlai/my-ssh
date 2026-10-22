import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { KubernetesConfigStore } from './kubernetes-store'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'myssh-remember-test-'))
  const file = join(directory, 'configs.enc')
  const key = randomBytes(32)
  const encryption = {
    available: () => true,
    encrypt(value: string): Buffer {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decrypt(value: Buffer): string {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    }
  }
  const snapshot = { id: 'a'.repeat(64), name: 'test', contexts: ['test', 'other'], json: JSON.stringify({ users: [{ user: { token: 'secret-fixture-token' } }], contexts: [{ name: 'test' }, { name: 'other' }] }) }
  return { directory, file, encryption, snapshot, close: () => rmSync(directory, { recursive: true, force: true }) }
}

describe('encrypted kubeconfig memory', () => {
  it('restores content and selection in a new store, exposes metadata only and deduplicates imports', () => {
    const f = fixture()
    try {
      const store = new KubernetesConfigStore(f.file, f.encryption)
      store.save(f.snapshot)
      store.select(f.snapshot.id, 'other', 'team')
      store.save({ ...f.snapshot, json: f.snapshot.json.replace('secret-fixture-token', 'rotated-token') })
      const restored = new KubernetesConfigStore(f.file, f.encryption)
      expect(restored.list()).toMatchObject({ selectedId: f.snapshot.id, configs: [{ name: 'test', context: 'other', namespace: 'team' }] })
      expect(restored.list().configs).toHaveLength(1)
      expect(restored.get(f.snapshot.id).snapshot.json).toContain('rotated-token')
      expect(JSON.stringify(restored.list())).not.toMatch(/token|users|json/)
      expect(readFileSync(f.file).includes(Buffer.from('rotated-token'))).toBe(false)
      if (process.platform !== 'win32') expect(statSync(f.file).mode & 0o777).toBe(0o600)
      expect(readdirSync(f.directory)).toEqual(['configs.enc'])
    } finally { f.close() }
  })
  it('removes individual records and clears damaged encrypted storage without touching a source file', () => {
    const f = fixture()
    try {
      const original = join(f.directory, 'original-kubeconfig')
      writeFileSync(original, f.snapshot.json, { mode: 0o600 })
      const store = new KubernetesConfigStore(f.file, f.encryption)
      store.save(f.snapshot)
      store.save({ ...f.snapshot, id: 'b'.repeat(64), name: 'second' })
      store.remove('b'.repeat(64))
      expect(store.list().selectedId).toBe(f.snapshot.id)
      store.remove(f.snapshot.id)
      expect(existsSync(f.file)).toBe(false)
      expect(readFileSync(original, 'utf8')).toBe(f.snapshot.json)
      writeFileSync(f.file, 'broken')
      expect(() => store.list()).toThrow('损坏')
      expect(() => store.save(f.snapshot)).toThrow('损坏')
      expect(readFileSync(f.file, 'utf8')).toBe('broken')
      store.clear()
      expect(store.list()).toEqual({ configs: [], selectedId: null })
    } finally { f.close() }
  })
  it('fails closed when system encryption is unavailable and preserves existing encrypted data', () => {
    const f = fixture()
    try {
      new KubernetesConfigStore(f.file, f.encryption).save(f.snapshot)
      const original = readFileSync(f.file)
      const unavailable = new KubernetesConfigStore(f.file, { ...f.encryption, available: () => false })
      expect(() => unavailable.list()).toThrow('加密存储不可用')
      expect(() => unavailable.save(f.snapshot)).toThrow('加密存储不可用')
      expect(readFileSync(f.file)).toEqual(original)
      unavailable.clear()
      expect(existsSync(f.file)).toBe(false)
    } finally { f.close() }
  })
})
