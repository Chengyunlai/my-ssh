import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { KubernetesConfigSnapshot } from '../core/kubernetes'
import type { KubernetesRememberedState, KubernetesSavedConfig } from '../shared/kubernetes'

interface Encryption { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
interface RecordEntry { snapshot: KubernetesConfigSnapshot; context: string; namespace: string }
interface StoredState { schema: 1; configs: RecordEntry[]; selectedId: string | null }
const empty = (): StoredState => ({ schema: 1, configs: [], selectedId: null })

/** Atomic, encrypted host storage. No plaintext fallback and no credential-bearing renderer API. */
export class KubernetesConfigStore {
  constructor(private readonly file: string, private readonly encryption: Encryption) {}

  private read(): StoredState {
    if (!existsSync(this.file)) return empty()
    if (!this.encryption.available()) throw new Error('系统加密存储不可用，无法读取已保存的集群配置')
    try {
      if (statSync(this.file).size > 16 * 1024 * 1024) throw new Error('size')
      const data = JSON.parse(this.encryption.decrypt(readFileSync(this.file))) as StoredState
      if (data.schema !== 1 || !Array.isArray(data.configs) || data.configs.length > 32 || (data.selectedId !== null && typeof data.selectedId !== 'string')) throw new Error('schema')
      const ids = new Set<string>()
      for (const entry of data.configs) {
        const snapshot = entry.snapshot
        if (!snapshot || typeof snapshot.id !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.id) || ids.has(snapshot.id) || typeof snapshot.name !== 'string' || !snapshot.name || snapshot.name.length > 255 || typeof snapshot.json !== 'string' || !Array.isArray(snapshot.contexts) || !snapshot.contexts.length || snapshot.contexts.some((context) => typeof context !== 'string') || !snapshot.contexts.includes(entry.context) || typeof entry.namespace !== 'string') throw new Error('record')
        ids.add(snapshot.id)
      }
      if (data.selectedId !== null && !ids.has(data.selectedId)) throw new Error('selection')
      return data
    } catch { throw new Error('已保存的集群配置无法解密或已损坏，可清空记录后重新导入') }
  }

  private write(data: StoredState): void {
    if (!this.encryption.available()) throw new Error('系统加密存储不可用，无法安全保存 kubeconfig')
    const json = JSON.stringify(data)
    if (Buffer.byteLength(json) > 8 * 1024 * 1024 || data.configs.length > 32) throw new Error('已保存配置超过数量或大小限制，请先清理旧配置')
    let encrypted: Buffer
    try { encrypted = this.encryption.encrypt(json) } catch { throw new Error('系统加密失败，未保存配置') }
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
    } catch { throw new Error('无法保存集群配置，原有记录已保留') }
    finally { rmSync(temporary, { force: true }) }
  }

  private publicEntry(entry: RecordEntry): KubernetesSavedConfig {
    const { id, name, contexts } = entry.snapshot
    return { id, name, contexts: [...contexts], context: entry.context, namespace: entry.namespace }
  }

  list(): KubernetesRememberedState {
    const state = this.read()
    return { configs: state.configs.map((entry) => this.publicEntry(entry)), selectedId: state.selectedId }
  }

  save(snapshot: KubernetesConfigSnapshot): KubernetesSavedConfig {
    const state = this.read()
    const existing = state.configs.find((entry) => entry.snapshot.id === snapshot.id)
    const entry: RecordEntry = { snapshot, context: existing && snapshot.contexts.includes(existing.context) ? existing.context : snapshot.contexts[0], namespace: existing?.namespace ?? '' }
    state.configs = [...state.configs.filter((item) => item.snapshot.id !== snapshot.id), entry]
    state.selectedId = snapshot.id
    this.write(state)
    return this.publicEntry(entry)
  }

  get(id: string): { snapshot: KubernetesConfigSnapshot; selection: KubernetesSavedConfig } {
    const entry = this.read().configs.find((item) => item.snapshot.id === id)
    if (!entry) throw new Error('配置已移除，请重新导入')
    return { snapshot: entry.snapshot, selection: this.publicEntry(entry) }
  }

  select(id: string, context: string, namespace: string): void {
    const state = this.read()
    const entry = state.configs.find((item) => item.snapshot.id === id)
    if (!entry || typeof context !== 'string' || !entry.snapshot.contexts.includes(context) || typeof namespace !== 'string' || (namespace !== '' && !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(namespace)) || namespace.length > 63) throw new Error('配置、Context 或命名空间无效')
    if (state.selectedId === id && entry.context === context && entry.namespace === namespace) return
    entry.context = context; entry.namespace = namespace; state.selectedId = id
    this.write(state)
  }

  remove(id: string): void {
    const state = this.read()
    state.configs = state.configs.filter((entry) => entry.snapshot.id !== id)
    if (state.selectedId === id) state.selectedId = state.configs.at(-1)?.snapshot.id ?? null
    if (!state.configs.length) this.clear()
    else this.write(state)
  }

  clear(): void { rmSync(this.file, { force: true }) }
}
