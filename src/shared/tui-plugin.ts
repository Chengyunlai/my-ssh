export interface CommandCatalogEntry { command: string; description: string; example?: string }
export interface CommandCatalogCategory { name: string; commands: CommandCatalogEntry[] }
export type TuiContribution =
  | { kind: 'commands'; categories: CommandCatalogCategory[] }
  | { kind: 'monitor' }
  | { kind: 'mysql' }
  | { kind: 'wsl' }
export interface TuiPluginDescriptor { schema: 1; id: string; contributions: TuiContribution[] }
export interface TuiPluginManifest { kind: 'tui-declarative-v1'; entry: string; sha256: string; minAppVersion: string }

function text(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f-\x9f]/.test(value) }

/** Declarative terminal entries carry data only; executable JS/React/runtimes are never accepted here. */
export function validateTuiPlugin(value: unknown, id: string): TuiPluginDescriptor {
  const descriptor = value as TuiPluginDescriptor
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !descriptor || descriptor.schema !== 1 || descriptor.id !== id || !Array.isArray(descriptor.contributions) || !descriptor.contributions.length || descriptor.contributions.length > 8) throw new Error('终端插件描述格式无效')
  let commands = 0
  for (const item of descriptor.contributions) {
    if (!item || !['commands', 'monitor', 'mysql', 'wsl'].includes(item.kind)) throw new Error('终端插件包含不支持的能力')
    if (item.kind === 'commands') {
      if (!Array.isArray(item.categories) || item.categories.length > 100) throw new Error('命令分类格式无效')
      for (const category of item.categories) {
        if (!text(category.name, 100) || !Array.isArray(category.commands)) throw new Error('命令分类格式无效')
        for (const command of category.commands) {
          commands++
          if (commands > 2000 || !text(command.command, 4096) || !text(command.description, 1000) || command.example !== undefined && !text(command.example, 4096)) throw new Error('命令条目无效或过多')
        }
      }
    }
  }
  return descriptor
}
