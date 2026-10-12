import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { Readable } from 'node:stream'
import { checkOfficeZip, PREVIEW_LIMITS, type PreviewPage } from './preview-format'
import { plain } from './ui'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const RELATIONS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Read package-local XML only; relationship targets never cause filesystem or network reads. */
async function xml(zip: JSZip, name: string): Promise<Element> {
  const file = zip.file(name)
  if (!file) throw new Error('Office 缺少必要内容')
  const chunks: Buffer[] = []
  let length = 0
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer') as Readable
    stream.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 2 * 1024 * 1024) { stream.destroy(); reject(new Error('Office 单个 XML 超过 2 MiB 上限')); return }
      chunks.push(chunk)
    })
    stream.once('error', reject)
    stream.once('end', () => resolve(Buffer.concat(chunks)))
  })
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('Office 禁止 DTD/实体声明')
  const document = new DOMParser({ onError: () => { throw new Error('Office XML 格式损坏') } }).parseFromString(text, 'application/xml')
  const pending: Array<{ element: Element; depth: number }> = [{ element: document.documentElement!, depth: 0 }]
  while (pending.length) {
    const { element, depth } = pending.pop()!
    if (depth > 128) throw new Error('Office XML 嵌套过深')
    for (let child = element.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) pending.push({ element: child as Element, depth: depth + 1 })
  }
  return document.documentElement!
}

function elements(parent: Element, namespace: string, local: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(namespace, local))
}

function paragraphText(paragraph: Element, namespace: string): string {
  const parts: string[] = []
  // Iterative preorder retains runs, tabs and hard line breaks without deep recursive traversal.
  const pending = [paragraph]
  while (pending.length) {
    const node = pending.pop()!
    if (node.namespaceURI === namespace && node.localName === 't') parts.push(node.textContent || '')
    if (node.namespaceURI === namespace && node.localName === 'tab') parts.push('    ')
    if (node.namespaceURI === namespace && ['br', 'cr'].includes(node.localName || '')) parts.push('\n')
    const children: Element[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) children.push(child as Element)
    pending.push(...children.reverse())
  }
  const style = elements(paragraph, WORD, 'pStyle')[0]?.getAttributeNS(WORD, 'val') || ''
  const heading = /^(?:Heading|标题)([1-6])$/i.exec(style)
  const prefix = heading ? '#'.repeat(Number(heading[1])) + ' ' : elements(paragraph, WORD, 'numPr').length ? '• ' : ''
  return prefix + parts.join('')
}

function paragraphs(parent: Element, namespace: string): string {
  return elements(parent, namespace, 'p').map((paragraph) => paragraphText(paragraph, namespace)).join('\n')
}

function content(parent: Element, namespace: string): string {
  const blocks: string[] = []
  const visit = (node: Element): void => {
    if (node.namespaceURI === namespace && node.localName === 'p') { blocks.push(paragraphText(node, namespace)); return }
    if (node.namespaceURI === namespace && node.localName === 'tbl') {
      for (const row of elements(node, namespace, 'tr').slice(0, 1000)) {
        const cells = Array.from(row.childNodes).filter((child) => child.nodeType === 1 && (child as Element).localName === 'tc') as Element[]
        blocks.push(cells.slice(0, 100).map((cell) => paragraphs(cell, namespace).replaceAll('\n', ' / ')).join(' | '))
      }
      return
    }
    for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) visit(child as Element)
  }
  // A paragraph owns its own text; do not re-emit all siblings for each block.
  for (let child = parent.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) visit(child as Element)
  const text = plain(blocks.join('\n\n'))
  return text.slice(0, PREVIEW_LIMITS.text) + (text.length > PREVIEW_LIMITS.text ? '\n…预览已截断' : '')
}

export async function officeContent(bytes: Uint8Array, extension: '.docx' | '.pptx', page: number): Promise<PreviewPage> {
  checkOfficeZip(bytes)
  const zip = await JSZip.loadAsync(bytes)
  if (extension === '.docx') {
    if (page !== 0) throw new Error('DOCX 页码超出范围')
    const document = await xml(zip, 'word/document.xml')
    const body = elements(document, WORD, 'body')[0]
    if (!body) throw new Error('DOCX 文档正文不存在')
    return { pages: 1, label: 'DOCX · 结构预览', text: content(body, WORD) + '\n（文字/标题/列表/表格；图片与精确排版请下载查看）' }
  }
  const presentation = await xml(zip, 'ppt/presentation.xml')
  const relationships = await xml(zip, 'ppt/_rels/presentation.xml.rels')
  const targets = new Map(Array.from(relationships.childNodes).filter((node) => node.nodeType === 1).map((node) => {
    const relation = node as Element
    return [relation.getAttribute('Id'), relation.getAttribute('TargetMode') === 'External' ? '' : relation.getAttribute('Target') || '']
  }))
  const slides = Array.from(presentation.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'))
  if (!slides.length || slides.length > 1000 || page < 0 || page >= slides.length) throw new Error('PPTX 幻灯片不存在或超过 1000 页')
  const target = targets.get(slides[page].getAttributeNS(RELATIONS, 'id')) || ''
  const name = target.startsWith('/') ? target.slice(1) : path.posix.normalize('ppt/' + target)
  if (!/^ppt\/slides\/[^/]+\.xml$/.test(name) || target.includes('\\')) throw new Error('PPTX 幻灯片关系无效')
  const slide = await xml(zip, name)
  return { pages: slides.length, label: `PPTX · ${page + 1}/${slides.length}`, text: content(slide, DRAWING) + '\n（文字/表格；图片、动画与精确排版请下载查看）' }
}
