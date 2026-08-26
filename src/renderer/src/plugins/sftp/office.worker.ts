import mammoth from 'mammoth'
import { limitHtmlPreview, parseSpreadsheetPreview } from './office-preview'

export interface OfficeParseRequest {
  ext: string
  bytes: Uint8Array
}

export interface OfficeParseResponse {
  ok: boolean
  html?: string
  limited?: boolean
  error?: string
}

// docx / xlsx 解析放到 Web Worker:文档解析是 CPU 密集的同步操作,
// 放在渲染主线程会冻结整个界面(按钮、滚动、动画全部卡住)。
self.onmessage = (e: MessageEvent<OfficeParseRequest>): void => {
  const { ext, bytes } = e.data
  void (async () => {
    try {
      if (ext === 'docx') {
        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        const out = await mammoth.convertToHtml({ arrayBuffer })
        const limited = limitHtmlPreview(out.value)
        const res: OfficeParseResponse = { ok: true, html: limited.html, limited: limited.limited }
        self.postMessage(res)
        return
      } else if (ext === 'xlsx' || ext === 'xls') {
        const parsed = parseSpreadsheetPreview(bytes)
        const res: OfficeParseResponse = { ok: true, html: parsed.html, limited: parsed.limited }
        self.postMessage(res)
        return
      } else {
        throw new Error('暂不支持预览 .doc 格式,请下载后查看')
      }
    } catch (err) {
      const res: OfficeParseResponse = {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
      self.postMessage(res)
    }
  })()
}
