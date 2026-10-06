/**
 * Generates sample PDFs with a large page number on each page, for eyeballing
 * imposition order and rotation. Run: pnpm make-sample
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'

async function makeNumbered(pages: number, file: string, rotateEvery?: number) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792]) // Letter portrait
    const label = String(i)
    const size = 220
    const tw = font.widthOfTextAtSize(label, size)
    page.drawText(label, { x: (612 - tw) / 2, y: 792 / 2 - size / 3, size, font, color: rgb(0.1, 0.1, 0.1) })
    page.drawText(`page ${i} of ${pages} — top`, { x: 40, y: 740, size: 18, font })
    page.drawRectangle({ x: 20, y: 20, width: 572, height: 752, borderWidth: 2, borderColor: rgb(0.6, 0.6, 0.6) })
    if (rotateEvery && i % rotateEvery === 0) page.setRotation(degrees(90))
  }
  writeFileSync(file, await doc.save())
  console.log(`wrote ${file} (${pages} pages)`)
}

mkdirSync('sample', { recursive: true })
await makeNumbered(20, 'sample/numbered-20.pdf')
await makeNumbered(5, 'sample/numbered-5.pdf')
await makeNumbered(6, 'sample/mixed-rotation-6.pdf', 3)
