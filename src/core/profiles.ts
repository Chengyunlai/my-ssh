import type { Profile } from '../shared/types'

/** 宿主决定文件位置和凭据加密；核心只负责连接配置的校验与增删改。 */
export interface ProfilePersistence {
  read(): Profile[]
  write(profiles: Profile[]): void
}

export function validateProfile(value: unknown): asserts value is Profile {
  if (!value || typeof value !== 'object') throw new Error('连接配置必须是对象')
  const p = value as Record<string, unknown>
  for (const key of ['id', 'name', 'host', 'username']) {
    if (typeof p[key] !== 'string' || !(p[key] as string).trim()) throw new Error(`连接配置缺少 ${key}`)
  }
  if (!Number.isInteger(p.port) || (p.port as number) < 1 || (p.port as number) > 65535) {
    throw new Error('端口必须是 1–65535 的整数')
  }
  if (p.authType !== 'password' && p.authType !== 'key') throw new Error('认证方式无效')
  for (const key of ['password', 'keyPath', 'passphrase']) {
    if (p[key] !== undefined && typeof p[key] !== 'string') throw new Error(`${key} 必须是文本`)
  }
  if (p.authType === 'key' && !p.keyPath) throw new Error('私钥认证需要私钥文件路径')
}

export class ProfileStore {
  constructor(private readonly persistence: ProfilePersistence) {}

  list(): Profile[] {
    const profiles = this.persistence.read()
    if (!Array.isArray(profiles)) throw new Error('连接配置文件格式无效')
    for (const profile of profiles) validateProfile(profile)
    return profiles.map((profile) => ({ ...profile }))
  }

  save(profile: Profile): Profile {
    validateProfile(profile)
    const list = this.list()
    const index = list.findIndex((item) => item.id === profile.id)
    if (index < 0) list.push({ ...profile })
    else list[index] = { ...profile }
    this.persistence.write(list)
    return { ...profile }
  }

  delete(id: string): void {
    this.persistence.write(this.list().filter((profile) => profile.id !== id))
  }
}
