import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { php } from '@codemirror/lang-php'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import type { SftpReadResult } from '@shared/types'
import type { OfficeParseResponse } from './office.worker'

interface Props {
  sessionId: string
  remotePath: string
  name: string
  onClose: () => void
  onDownload: (remotePath: string, name: string) => void
  onSaved: () => void
}

/** 超过该体积的文本预览跳过语法高亮与编辑增强,避免大文件卡住 UI */
const LARGE_TEXT_BYTES = 512 * 1024

/**
 * 语法高亮映射:预览与编辑共用同一份规则。
 * 有官方 @codemirror/lang-* 包用官方包,否则用 legacy-modes 的 StreamLanguage。
 */
function langFor(name: string): Extension {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'mjs': case 'cjs':
      return javascript()
    case 'py': return python()
    case 'json': return json()
    case 'yml': case 'yaml': return yaml()
    case 'md': case 'markdown': return markdown()
    case 'html': case 'htm': return html()
    case 'css': return css()
    case 'sql': return sql()
    case 'xml': case 'svg': return xml()
    case 'c': case 'h': case 'cc': case 'cpp': case 'cxx': case 'hpp':
      return cpp()
    case 'java': return java()
    case 'go': return go()
    case 'rs': return rust()
    case 'php': return php()
    case 'sh': case 'bash': case 'zsh': case 'ksh':
      return StreamLanguage.define(shell)
    case 'conf': case 'nginx': return StreamLanguage.define(nginx)
    case 'dockerfile': case 'containerfile': return StreamLanguage.define(dockerFile)
    case 'ini': case 'cfg': case 'properties': return StreamLanguage.define(properties)
    case 'toml': return StreamLanguage.define(toml)
    case 'env': return StreamLanguage.define(properties)
    default: return []
  }
}

/** 只读(预览)与可写(编辑)两态扩展,通过 Compartment 切换 */
function modeExts(editable: boolean): Extension[] {
  return [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]
}

export default function FileViewer({
  sessionId,
  remotePath,
  name,
  onClose,
  onDownload,
  onSaved
}: Props): React.JSX.Element {
  const [result, setResult] = useState<SftpReadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedTip, setSavedTip] = useState(false)
  const [imgFit, setImgFit] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [content, setContent] = useState('')
  const [officeHtml, setOfficeHtml] = useState<string | null>(null)
  const [officeLoading, setOfficeLoading] = useState(false)
  const [officeError, setOfficeError] = useState<string | null>(null)
  const [readProgress, setReadProgress] = useState(0)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editableCompRef = useRef<Compartment | null>(null)
  const wrapCompRef = useRef<Compartment | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const editingRef = useRef(false)

  useEffect(() => {
    let disposed = false
    setResult(null)
    setError(null)
    setEditing(false)
    setWrap(true)
    setContent('')
    setOfficeHtml(null)
    setOfficeLoading(false)
    setOfficeError(null)
    setReadProgress(0)
    void window.ssh
      .sftpRead(sessionId, remotePath)
      .then((r) => {
        if (disposed) return
        setResult(r)
        setContent(r.content ?? '')
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      disposed = true
    }
  }, [sessionId, remotePath])

  // 预览下载进度:主进程按流式字节数上报,按会话 + 路径过滤
  useEffect(() => {
    return window.ssh.onReadProgress((p) => {
      if (p.sessionId === sessionId && p.remotePath === remotePath) {
        setReadProgress(p.percent)
      }
    })
  }, [sessionId, remotePath])

  // docx / xlsx 解析预览:解析放到 Web Worker,避免大文档卡住 UI 主线程
  useEffect(() => {
    if (result?.kind !== 'office' || !result.bytes) return
    let disposed = false
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    setOfficeLoading(true)
    setOfficeError(null)
    setOfficeHtml(null)
    const worker = new Worker(new URL('./office.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<OfficeParseResponse>): void => {
      if (disposed) {
        worker.terminate()
        return
      }
      const res = e.data
      setOfficeLoading(false)
      if (!res.ok) {
        setOfficeError(res.error ?? '解析失败')
      } else {
        // 净化仍依赖 DOM,放回渲染主线程(解析是重活,净化很轻)
        void import('dompurify').then(({ default: purify }) => {
          if (!disposed) setOfficeHtml(purify.sanitize(res.html ?? ''))
        })
      }
      worker.terminate()
    }
    worker.onerror = (e): void => {
      if (!disposed) {
        setOfficeLoading(false)
        setOfficeError(e.message || '文档解析失败')
      }
      worker.terminate()
    }
    worker.postMessage({ ext, bytes: result.bytes })
    return () => {
      disposed = true
      worker.terminate()
    }
  }, [result, name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 单一 CodeMirror 实例:预览 = 只读态,编辑 = 可写态,高亮规则完全一致
  useEffect(() => {
    if (!result || result.kind !== 'text' || !editorHostRef.current) return
    // 大文本跳过 basicSetup(行号/历史等)与语法高亮,显著降低渲染耗时
    const largeText = content.length > LARGE_TEXT_BYTES
    const editableComp = new Compartment()
    const wrapComp = new Compartment()
    const view = new EditorView({
      doc: content,
      parent: editorHostRef.current,
      extensions: [
        ...(largeText ? [] : [basicSetup, langFor(name)]),
        oneDark,
        editableComp.of(modeExts(false)),
        wrapComp.of(EditorView.lineWrapping),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              saveRef.current()
              return true
            }
          }
        ])
      ]
    })
    viewRef.current = view
    editableCompRef.current = editableComp
    wrapCompRef.current = wrapComp
    return () => {
      view.destroy()
      viewRef.current = null
      editableCompRef.current = null
      wrapCompRef.current = null
    }
    // content 通过 updateListener 同步;这里只按 kind/语言变化重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.kind, name])

  const save = async (): Promise<void> => {
    if (!result || result.kind !== 'text' || !editingRef.current) return
    setSaving(true)
    setSavedTip(false)
    try {
      await window.ssh.sftpWrite(sessionId, remotePath, content)
      setResult((r) => (r ? { ...r, content, size: new TextEncoder().encode(content).length } : r))
      setEditMode(false)
      setSavedTip(true)
      onSaved()
      window.setTimeout(() => setSavedTip(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  saveRef.current = save

  const setEditMode = (next: boolean): void => {
    editingRef.current = next
    viewRef.current?.dispatch({
      effects: editableCompRef.current?.reconfigure(modeExts(next))
    })
    setEditing(next)
  }

  const cancelEdit = (): void => {
    const view = viewRef.current
    if (view && result?.content !== undefined) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.content } })
    }
    setEditMode(false)
  }

  const toggleWrap = (): void => {
    const view = viewRef.current
    const comp = wrapCompRef.current
    if (!view || !comp) return
    setWrap((w) => {
      view.dispatch({ effects: comp.reconfigure(w ? [] : EditorView.lineWrapping) })
      return !w
    })
  }

  const isText = result?.kind === 'text'
  // 下载阶段封顶 85%,解析阶段 85-90%
  const loadingPct = Math.round((readProgress / 100) * 85)
  const parsingPct = Math.min(90, Math.max(loadingPct, 85))

  return (
    <div
      className="file-viewer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="file-viewer" role="dialog" aria-modal="true">
        <div className="file-viewer-head">
          <div className="file-viewer-title">
            <span className="file-viewer-name">{name}</span>
            <span className="file-viewer-path" title={remotePath}>
              {remotePath}
            </span>
          </div>
          <div className="file-viewer-actions">
            {isText && editing ? (
              <>
                <button className="btn btn-sm" onClick={cancelEdit} disabled={saving}>
                  取消
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
              </>
            ) : (
              <>
                {result?.kind === 'image' && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setImgFit((v) => !v)}>
                    {imgFit ? '原始尺寸' : '适应窗口'}
                  </button>
                )}
                {isText && (
                  <button className="btn btn-sm btn-ghost" onClick={toggleWrap}>
                    换行:{wrap ? '开' : '关'}
                  </button>
                )}
                {isText && !editing && (
                  <button
                    className="btn btn-sm"
                    onClick={() => setEditMode(true)}
                    disabled={!!error || result.truncated}
                    title={result.truncated ? '文件超过预览上限,编辑已禁用' : undefined}
                  >
                    编辑
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => onDownload(remotePath, name)}>
                  下载
                </button>
                <button className="btn btn-sm btn-ghost" onClick={onClose}>
                  关闭
                </button>
              </>
            )}
          </div>
        </div>
        <div className="file-viewer-body">
          {error && <div className="sftp-error">{error}</div>}
          {!result && !error && (
            <div className="file-viewer-loading">
              <div className="file-viewer-hint">加载中…</div>
              <div className="file-viewer-progress">
                <div className="file-viewer-progress-inner" style={{ width: `${loadingPct}%` }} />
              </div>
              <div className="file-viewer-percent">{loadingPct}%</div>
            </div>
          )}
          {result?.kind === 'image' && (
            <div className={`file-viewer-image${imgFit ? '' : ' original'}`}>
              <img src={result.dataUrl} alt={name} />
            </div>
          )}
          {result?.kind === 'pdf' && (
            <iframe className="file-viewer-pdf" src={result.dataUrl} title={name} />
          )}
          {result?.kind === 'office' && (
            <>
              {officeLoading && (
                <div className="file-viewer-loading">
                  <div className="file-viewer-hint">正在解析文档…</div>
                  <div className="file-viewer-progress">
                    <div className="file-viewer-progress-inner parsing" style={{ width: `${parsingPct}%` }} />
                  </div>
                  <div className="file-viewer-percent">{parsingPct}%</div>
                </div>
              )}
              {officeError && <div className="sftp-error">{officeError}</div>}
              {officeHtml && (
                <div className="file-viewer-doc" dangerouslySetInnerHTML={{ __html: officeHtml }} />
              )}
            </>
          )}
          {result?.kind === 'binary' && (
            <div className="file-viewer-hint">二进制文件,不支持在线预览/编辑,请下载后查看</div>
          )}
          {isText && (
            <div className="file-viewer-editor">
              <div ref={editorHostRef} className="file-viewer-editor-host" />
            </div>
          )}
          {result?.truncated && (
            <div className="file-viewer-truncated">文件较大,仅预览前 5MB(编辑已禁用,请下载后处理)</div>
          )}
        </div>
        {savedTip && <div className="file-viewer-tip">已保存</div>}
      </div>
    </div>
  )
}
