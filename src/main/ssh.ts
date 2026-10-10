import type { WebContents } from 'electron'
import type { Profile } from '../shared/types'
import * as ssh from '../core/ssh'
import { electronHost } from './core-host'

export {
  getCwd, whenReady, setOnSessionClosed, addOnSessionClosed, getClient,
  ExecCommandError, execCommand, disconnectAll, closeShell, sendData, resize, disconnect
} from '../core/ssh'
export type { ExecCommandErrorCode, ExecCommandResult, TestConnectionResult } from '../core/ssh'

export function connect(profile: Profile, contents: WebContents): { sessionId: string } {
  return ssh.connect(profile, electronHost(contents))
}

export function testConnect(profile: Profile, contents: WebContents): Promise<ssh.TestConnectionResult> {
  return ssh.testConnect(profile, electronHost(contents))
}

export function openShell(sessionId: string, contents: WebContents, cols = 80, rows = 24): { shellId: string } | undefined {
  return ssh.openShell(sessionId, electronHost(contents), cols, rows)
}

export function isSessionOwnedBy(sessionId: string, contents: WebContents): boolean {
  return ssh.isSessionOwnedBy(sessionId, electronHost(contents))
}
