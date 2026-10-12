import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildBooklet, insetsToBoundingBox, SHEET_HEIGHT, SHEET_WIDTH } from './buildBooklet'

async function makeSource(pages: number, rotateEvery?: number) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792])
    p.drawText(String(i), { x: 100, y: 400, size: 100 })
    if (rotateEvery && i % rotateEvery === 0) p.setRotation(degrees(90))
  }
  return doc.save()
}

function formBBoxes(resources: PDFDict | undefined): number[][] {
  const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return []
  const result: number[][] = []
  for (const [, ref] of xobjects.entries()) {
    const stream = xobjects.context.lookup(ref, PDFStream)
    const bbox = stream.dict.lookup(PDFName.of('BBox'), PDFArray)
    result.push(bbox.asArray().map((n) => (n as PDFNumber).asNumber()))
  }
  return result
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

  it('crops every embedded page to the given insets', async () => {
    const insets = { top: 1, right: 0.5, bottom: 0.25, left: 0.75 }
    const res = await buildBooklet(await makeSource(4), { rotation: 'back', crop: insets })
    const out = await PDFDocument.load(res.bytes)
    const bboxes = out.getPages().flatMap((p) => formBBoxes(p.node.Resources()))
    expect(bboxes).toHaveLength(4)
    for (const b of bboxes) expect(b).toEqual([54, 18, 576, 720])
  })

  it('maps visual insets onto the unrotated box of a /Rotate 90 page', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    p.setRotation(degrees(90))
    // Viewer shows the page turned clockwise: user-space left is the visual top.
    const box = insetsToBoundingBox(p, { top: 1, right: 0.5, bottom: 0.25, left: 0.75 }, 90)
    expect(box).toEqual({ left: 72, top: 792 - 36, right: 612 - 18, bottom: 54 })
  })

  it('falls back to the full page when insets would leave nothing', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    expect(insetsToBoundingBox(p, { top: 6, right: 0, bottom: 6, left: 0 }, 0)).toEqual({
      left: 0, bottom: 0, right: 612, top: 792,
    })
  })

  it('rejects bytes that are not a PDF', async () => {
    await expect(buildBooklet(new TextEncoder().encode('hello'), { rotation: 'back' })).rejects.toThrow()
  })
})
