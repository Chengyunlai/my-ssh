import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, PDFDocument } from '@napi-rs/canvas'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import UTIF from 'utif'

/** Synthetic documents only; never include real server or personal data. */
export async function previewFixtures(directory) {
  const canvas = createCanvas(40, 30)
  canvas.getContext('2d').fillStyle = '#ff0000'
  canvas.getContext('2d').fillRect(0, 0, 40, 30)
  fs.writeFileSync(path.join(directory, 'fixture.png'), canvas.toBuffer('image/png'))
  const bitmap = Buffer.alloc(40 + 16 + 8)
  bitmap.writeUInt32LE(40); bitmap.writeInt32LE(2, 4); bitmap.writeInt32LE(4, 8)
  bitmap.writeUInt16LE(1, 12); bitmap.writeUInt16LE(32, 14)
  for (const offset of [40, 44, 48, 52]) { bitmap[offset + 2] = 255; bitmap[offset + 3] = 255 }
  const icon = Buffer.alloc(22 + bitmap.length)
  icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4); icon[6] = 2; icon[7] = 2
  icon.writeUInt32LE(bitmap.length, 14); icon.writeUInt32LE(22, 18); bitmap.copy(icon, 22)
  fs.writeFileSync(path.join(directory, 'fixture.ico'), icon)
  const tiff = Buffer.alloc(2032)
  const frame = (offset) => ({ t256: [2], t257: [2], t258: [8, 8, 8, 8], t259: [1], t262: [2], t273: [offset], t277: [4], t278: [2], t279: [16], t284: [1], t338: [2] })
  Buffer.from(UTIF.encode([frame(2000), frame(2016)])).copy(tiff)
  for (const offset of [2000, 2004, 2008, 2012]) { tiff[offset] = 255; tiff[offset + 3] = 255 }
  for (const offset of [2016, 2020, 2024, 2028]) { tiff[offset + 1] = 255; tiff[offset + 3] = 255 }
  fs.writeFileSync(path.join(directory, 'fixture.tiff'), tiff)
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
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCXfixture 你好</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>TABLEfirst</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>TABLEsecond</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
  fs.writeFileSync(path.join(directory, 'fixture.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
  const slides = new JSZip()
  slides.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>')
  slides.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="second" Target="slides/slide2.xml"/><Relationship Id="first" Target="slides/slide1.xml"/></Relationships>')
  for (const number of [1, 2]) slides.file(`ppt/slides/slide${number}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>PPTXslide${number} 你好</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`)
  fs.writeFileSync(path.join(directory, 'fixture.pptx'), await slides.generateAsync({ type: 'nodebuffer' }))
}
