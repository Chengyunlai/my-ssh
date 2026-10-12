import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { PREVIEW_LIMITS, type PreviewPage, type PreviewRequest } from './preview-format'
import type { TerminalUI } from './ui'

export function runPreview(request: PreviewRequest, signal?: AbortSignal): Promise<PreviewPage> {
  if (request.bytes.byteLength > PREVIEW_LIMITS.bytes) return Promise.reject(new Error('预览文件超过 5 MiB 上限'))
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(path.join(__dirname, 'preview-worker.cjs'), { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true })
    // Decoder diagnostics are untrusted text and never escape into the terminal.
    worker.stdout.resume()
    worker.stderr.resume()
    const finish = (error?: Error, result?: PreviewPage): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    const timer = setTimeout(() => finish(new Error('预览解析超过 15 秒，已停止')), PREVIEW_LIMITS.timeout)
    const abort = (): void => finish(new Error('预览已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    worker.once('message', (message) => finish(message.error ? new Error(message.error) : undefined, message.result))
    worker.once('error', (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => finish(new Error(`预览进程已退出 (${code})`)))
  })
}

export async function showPreview(ui: TerminalUI, bytes: Uint8Array, filename: string): Promise<void> {
  let page = 0
  while (true) {
    const controller = new AbortController()
    const result = await ui.busy('解析文件预览', runPreview({ bytes, filename, page, columns: ui.width - 3, rows: ui.height - 6 }, controller.signal), () => controller.abort())
    const title = result.label + ' · ' + path.basename(filename)
    if (result.lines) await ui.image(title, result.lines)
    else await ui.view(title, result.text)
    while (true) {
      const action = await ui.menu('文件预览', [
        { label: '返回文件列表', value: 'back' },
        ...(result.lines && result.text ? [{ label: '查看本页文字', value: 'text' }] : []),
        ...(page > 0 ? [{ label: '上一页 / 工作表', value: 'previous' }] : []),
        ...(page + 1 < result.pages ? [{ label: '下一页 / 工作表', value: 'next' }] : [])
      ])
      if (!action || action === 'back') return
      if (action === 'text') { await ui.view(filename, result.text); continue }
      if (action === 'previous') page--
      if (action === 'next') page++
      break
    }
  }
}
