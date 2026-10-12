import { nativeImage, type WebContents } from 'electron'
import * as sftp from '../core/sftp'
import { electronHost } from './core-host'

export { closeSftp, home, list, write, stat, mkdir, remove } from '../core/sftp'
export type { SftpReadResult } from '../shared/types'

export function read(sessionId: string, remotePath: string, contents: WebContents): Promise<sftp.SftpReadResult> {
  return sftp.read(sessionId, remotePath, electronHost(contents), { decodeImage: (buffer) => {
    const image = nativeImage.createFromBuffer(buffer)
    return image.isEmpty() ? undefined : `data:image/png;base64,${image.toPNG().toString('base64')}`
  } })
}

export function download(sessionId: string, remote: string, local: string, contents: WebContents): { transferId: string } {
  return sftp.download(sessionId, remote, local, electronHost(contents))
}

export function upload(sessionId: string, local: string, remote: string, contents: WebContents): { transferId: string } {
  return sftp.upload(sessionId, local, remote, electronHost(contents))
}
