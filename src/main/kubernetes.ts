import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, ipcMain, safeStorage, type WebContents } from 'electron'
import { KubernetesConfigStore } from './kubernetes-store'
import { KubernetesClient } from '../core/kubernetes'
import type { KubernetesLogOptions } from '../shared/kubernetes'
import type { IpcResult } from '../shared/types'

/** Registrations and processes belong to the importing window, never another window. */
export function registerKubernetes(): void {
  const store = new KubernetesConfigStore(join(app.getPath('userData'), 'kubernetes-configs.enc'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value)
  })
  let cleaningGeneration = 0
  const clients = new Map<WebContents, KubernetesClient>()
  const clientFor = (sender: WebContents): KubernetesClient => {
    if (sender.isDestroyed()) throw new Error('窗口已关闭')
    let client = clients.get(sender)
    if (!client) {
      client = new KubernetesClient()
      clients.set(sender, client)
      sender.once('destroyed', () => { client?.dispose(); if (clients.get(sender) === client) clients.delete(sender) })
    }
    return client
  }
  const handle = <T, Args extends unknown[]>(name: string, action: (sender: WebContents, ...args: Args) => T | Promise<T>): void => {
    ipcMain.handle(`kubernetes:${name}`, async (event, ...args: Args): Promise<IpcResult<T>> => {
      try { return { ok: true, value: await action(event.sender, ...args) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Kubernetes 操作失败' } }
    })
  }
  handle('remembered', () => store.list())
  handle('select-config', (sender, id: string) => {
    const saved = store.get(id)
    const config = clientFor(sender).restoreConfig(saved.snapshot)
    store.select(id, saved.selection.context, saved.selection.namespace)
    return { ...saved.selection, ...config }
  })
  handle('remember-selection', (_sender, id: string, context: string, namespace: string) => store.select(id, context, namespace))
  handle('remove-config', (_sender, id: string) => {
    store.remove(id)
    cleaningGeneration++
    for (const client of clients.values()) client.forgetConfig(id)
  })
  handle('clear-configs', () => {
    store.clear()
    cleaningGeneration++
    for (const client of clients.values()) client.dispose()
    clients.clear()
  })
  handle('import', async (sender) => {
    const generation = cleaningGeneration
    const result = await dialog.showOpenDialog({ title: '选择可信的 kubeconfig', defaultPath: join(homedir(), '.kube'), properties: ['openFile', 'showHiddenFiles'] })
    if (result.canceled || !result.filePaths[0] || sender.isDestroyed()) return null
    if (generation !== cleaningGeneration) throw new Error('配置记录已清理，请重新导入')
    const client = clientFor(sender)
    const config = await client.importConfig(result.filePaths[0])
    try {
      if (generation !== cleaningGeneration) throw new Error('配置记录已清理，请重新导入')
      store.save(client.exportConfig(config.id))
      for (const other of clients.values()) if (other !== client) other.forgetConfig(config.id)
      return config
    } catch (error) { client.forgetConfig(config.id); throw error }
  })
  handle('discover', (sender, configId: string, context: string, namespace: string) => {
    store.select(configId, context, namespace)
    return clientFor(sender).discover(configId, context, namespace)
  })
  handle('metrics', (sender, targetId: string, pod: string) => clientFor(sender).metrics(targetId, pod))
  handle('logs', (sender, targetId: string, pod: string, container: string, options: KubernetesLogOptions) => clientFor(sender).logs(targetId, pod, container, options))
  handle('targets', (sender) => clientFor(sender).targets())
  handle('forward', (sender, targetId: string) => clientFor(sender).forward(targetId))
  handle('forwards', (sender) => clientFor(sender).forwards())
  handle('stop', (sender, id: string) => clientFor(sender).stop(id))
}
