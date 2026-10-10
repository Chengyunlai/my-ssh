import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { safeExternalUrl } from '../shared/external-url'

const execute = promisify(execFile)

/** 只允许 http(s) 且无嵌入凭据的地址，命令参数不经过 shell。 */
export async function openBrowser(raw: string): Promise<void> {
  const url = safeExternalUrl(raw)
  if (!url) throw new Error('该地址不能交给系统浏览器打开')
  if (process.platform === 'darwin') await execute('open', [url])
  else if (process.platform === 'win32') await execute('rundll32.exe', ['url.dll,FileProtocolHandler', url])
  else await execute('xdg-open', [url])
}
