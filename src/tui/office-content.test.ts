import { expect, it } from 'vitest'
import JSZip from 'jszip'
import { officeContent } from './office-content'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const relation = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
async function document(body: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', `<x:document xmlns:x="${word}"><x:body>${body}</x:body></x:document>`)
  return zip.generateAsync({ type: 'uint8array' })
}

it('retains DOCX headings, runs, lists and table cells without repeating sibling paragraphs', async () => {
  const p = (text: string) => `<x:p><x:r><x:t>${text}</x:t></x:r></x:p>`
  const bytes = await document(`<x:p><x:pPr><x:pStyle x:val="Heading2"/></x:pPr><x:r><x:t>标题</x:t><x:tab/><x:t>你好</x:t></x:r></x:p>${p('正文')}<x:p><x:pPr><x:numPr/></x:pPr><x:r><x:t>条目</x:t></x:r></x:p><x:tbl><x:tr><x:tc>${p('姓名')}${p('别名')}</x:tc><x:tc>${p('张三')}</x:tc></x:tr></x:tbl>`)
  const result = await officeContent(bytes, '.docx', 0)
  expect(result.text).toContain('## 标题    你好')
  expect(result.text.match(/正文/g)).toHaveLength(1)
  expect(result.text).toContain('• 条目')
  expect(result.text).toContain('姓名 / 别名 | 张三')
})

it('rejects DTD, malformed XML and deep trees; strips terminal controls from content', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<!DOCTYPE x [<!ENTITY attack SYSTEM "file:///secret">]><x/>')
  await expect(officeContent(await zip.generateAsync({ type: 'uint8array' }), '.docx', 0)).rejects.toThrow('DTD')
  await expect(officeContent(await document('<x:p>'), '.docx', 0)).rejects.toThrow()
  await expect(officeContent(await document('<x:s>'.repeat(130) + '</x:s>'.repeat(130)), '.docx', 0)).rejects.toThrow('嵌套')
  const sanitized = await officeContent(await document('<x:p><x:r><x:t>safe&#27;unsafe</x:t></x:r></x:p>'), '.docx', 0)
  expect(sanitized.text).toContain('safeunsafe')
  expect(sanitized.text).not.toContain('\x1b')
})

it('bounds actual inflated XML before building a DOM', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<document>' + 'a'.repeat(2 * 1024 * 1024) + '</document>')
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  await expect(officeContent(bytes, '.docx', 0)).rejects.toThrow('2 MiB')
})

it('uses presentation order for PPTX pagination and never follows external slide relationships', async () => {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${presentation}" xmlns:r="${relation}"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="second" Target="slides/slide2.xml"/><Relationship Id="first" Target="slides/slide1.xml"/></Relationships>')
  for (const number of [1, 2]) zip.file(`ppt/slides/slide${number}.xml`, `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}"><p:cSld><a:p><a:r><a:t>SLIDE${number} 你好</a:t></a:r></a:p><a:tbl><a:tr><a:tc><a:p><a:r><a:t>CELL</a:t></a:r></a:p></a:tc></a:tr></a:tbl></p:cSld></p:sld>`)
  let bytes = await zip.generateAsync({ type: 'uint8array' })
  expect((await officeContent(bytes, '.pptx', 0)).text).toContain('SLIDE2 你好')
  expect((await officeContent(bytes, '.pptx', 1)).text).toContain('SLIDE1 你好')
  await expect(officeContent(bytes, '.pptx', 2)).rejects.toThrow('不存在')
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="second" Target="https://example.com/slide.xml" TargetMode="External"/></Relationships>')
  bytes = await zip.generateAsync({ type: 'uint8array' })
  await expect(officeContent(bytes, '.pptx', 0)).rejects.toThrow('关系')
})
