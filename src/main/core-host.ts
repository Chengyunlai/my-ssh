import type { WebContents } from 'electron'
import type { CoreHost } from '../core/host'
import { logError } from './logger'

const hosts = new WeakMap<WebContents, CoreHost>()

export function electronHost(contents: WebContents): CoreHost {
  let host = hosts.get(contents)
  if (!host) {
    host = {
      send(channel, payload) {
        if (!contents.isDestroyed()) contents.send(channel, payload)
      },
      isDisposed: () => contents.isDestroyed(),
      onDispose(callback) {
        contents.once('destroyed', callback)
        return () => { contents.removeListener?.('destroyed', callback) }
      },
      logError
    }
    hosts.set(contents, host)
  }
  return host
}
