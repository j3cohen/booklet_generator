import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildBooklet, SHEET_HEIGHT, SHEET_WIDTH } from './buildBooklet'

async function makeSource(pages: number, rotateEvery?: number) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792])
    p.drawText(String(i), { x: 100, y: 400, size: 100 })
    if (rotateEvery && i % rotateEvery === 0) p.setRotation(degrees(90))
  }
  return doc.save()
}

describe('buildBooklet', () => {
  it('produces Letter landscape sheets with back sides rotated by default', async () => {
    const res = await buildBooklet(await makeSource(8), { rotation: 'back' })
    expect(res.pageCount).toBe(8)
    expect(res.sides).toHaveLength(4)

    const out = await PDFDocument.load(res.bytes)
    expect(out.getPageCount()).toBe(4)
    out.getPages().forEach((p, i) => {
      expect(p.getWidth()).toBe(SHEET_WIDTH)
      expect(p.getHeight()).toBe(SHEET_HEIGHT)
      expect(p.getRotation().angle).toBe(i % 2 === 1 ? 180 : 0)
    })
  })

  it('rotates front sides in front mode and nothing in none mode', async () => {
    const src = await makeSource(4)
    const front = await PDFDocument.load((await buildBooklet(src, { rotation: 'front' })).bytes)
    expect(front.getPages().map((p) => p.getRotation().angle)).toEqual([180, 0])
    const none = await PDFDocument.load((await buildBooklet(src, { rotation: 'none' })).bytes)
    expect(none.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0])
  })

  it('honours signatures and pads blanks', async () => {
    const res = await buildBooklet(await makeSource(20), { rotation: 'back', sheetsPerSignature: 2 })
    expect(res.signatures.map((s) => s.sheets.length)).toEqual([2, 2, 1])
    const out = await PDFDocument.load(res.bytes)
    expect(out.getPageCount()).toBe(10)
  })

  it('accepts source pages with their own /Rotate', async () => {
    const res = await buildBooklet(await makeSource(6, 3), { rotation: 'back' })
    const out = await PDFDocument.load(res.bytes)
    expect(out.getPageCount()).toBe(4)
  })

  it('treats pages without a content stream as blank', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792]) // never drawn on: no /Contents
    doc.addPage([612, 792]).drawText('2', { x: 50, y: 50, size: 40 })
    const res = await buildBooklet(await doc.save(), { rotation: 'back' })
    const out = await PDFDocument.load(res.bytes)
    expect(out.getPageCount()).toBe(2)
  })

  it('rejects bytes that are not a PDF', async () => {
    await expect(buildBooklet(new TextEncoder().encode('hello'), { rotation: 'back' })).rejects.toThrow()
  })
})
