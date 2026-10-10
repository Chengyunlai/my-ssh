import { describe, expect, it } from 'vitest'
import { ProfileStore, validateProfile, type ProfilePersistence } from './profiles'
import type { Profile } from '../shared/types'

const profile: Profile = { id: 'fixture', name: 'Fixture', host: '127.0.0.1', port: 22, username: 'demo', authType: 'password', password: 'fixture-secret' }

function persistence(): ProfilePersistence {
  let profiles: Profile[] = []
  return { read: () => profiles, write: (next) => { profiles = next } }
}

describe('ProfileStore', () => {
  it('saves, replaces and deletes configurations without leaking mutable copies', () => {
    const store = new ProfileStore(persistence())
    store.save(profile)
    store.list()[0].name = 'changed outside store'
    expect(store.list()[0].name).toBe('Fixture')
    store.save({ ...profile, name: 'Updated' })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].name).toBe('Updated')
    store.delete(profile.id)
    expect(store.list()).toEqual([])
  })

  it('rejects invalid profiles before changing persistence', () => {
    const store = new ProfileStore(persistence())
    store.save(profile)
    expect(() => store.save({ ...profile, port: 0 })).toThrow('端口')
    expect(() => validateProfile({ ...profile, password: 123 })).toThrow('password')
    expect(() => validateProfile({ ...profile, authType: 'key', keyPath: '' })).toThrow('私钥')
    expect(store.list()).toEqual([profile])
  })

  it('does not overwrite corrupt storage', () => {
    const backing: ProfilePersistence = { read: () => null as never, write: () => { throw new Error('must not write') } }
    expect(() => new ProfileStore(backing).save(profile)).toThrow('文件格式')
  })
})
