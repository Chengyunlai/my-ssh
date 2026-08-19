import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export interface OfficeParseRequest {
  ext: string
  bytes: Uint8Array
}

export interface OfficeParseResponse {
  ok: boolean
  html?: string
  error?: string
}

// docx / xlsx 解析放到 Web Worker:文档解析是 CPU 密集的同步操作,
// 放在渲染主线程会冻结整个界面(按钮、滚动、动画全部卡住)。
self.onmessage = (e: MessageEvent<OfficeParseRequest>): void => {
  const { ext, bytes } = e.data
  void (async () => {
    try {
      let html: string
      if (ext === 'docx') {
        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        const out = await mammoth.convertToHtml({ arrayBuffer })
        html = out.value
      } else if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(bytes, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        if (!sheet) throw new Error('表格中没有可预览的工作表')
        html = XLSX.utils.sheet_to_html(sheet)
      } else {
        throw new Error('暂不支持预览 .doc 格式,请下载后查看')
      }
      const res: OfficeParseResponse = { ok: true, html }
      self.postMessage(res)
    } catch (err) {
      const res: OfficeParseResponse = {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
      self.postMessage(res)
    }
  })()
}
