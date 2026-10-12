import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, PDFDocument } from '@napi-rs/canvas'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

/** Synthetic documents only; never include real server or personal data. */
export async function previewFixtures(directory) {
  const canvas = createCanvas(40, 30)
  canvas.getContext('2d').fillStyle = '#ff0000'
  canvas.getContext('2d').fillRect(0, 0, 40, 30)
  fs.writeFileSync(path.join(directory, 'fixture.png'), canvas.toBuffer('image/png'))
  const pdf = new PDFDocument()
  for (const name of ['PDFfixture', 'PDFsecond']) {
    const context = pdf.beginPage(200, 200)
    context.font = '20px sans-serif'
    context.fillText(name, 10, 30)
    pdf.endPage()
  }
  fs.writeFileSync(path.join(directory, 'fixture.pdf'), pdf.close())
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['SHEETfirst', 42]]), 'First')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['SHEETsecond', 99]]), 'Second')
  fs.writeFileSync(path.join(directory, 'fixture.xlsx'), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCXfixture 你好</w:t></w:r></w:p></w:body></w:document>')
  fs.writeFileSync(path.join(directory, 'fixture.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
}
