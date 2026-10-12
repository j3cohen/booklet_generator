import { PDFDocument, degrees, type PageBoundingBox, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib'
import { impose, toOutputSides } from './imposition'
import type { BookletOptions, Insets, OutputSide, Signature } from './types'

/** US Letter landscape, in PDF points. */
export const SHEET_WIDTH = 792
export const SHEET_HEIGHT = 612
const SLOT_WIDTH = SHEET_WIDTH / 2

export interface BuildResult {
  bytes: Uint8Array
  signatures: Signature[]
  sides: OutputSide[]
  pageCount: number
}

interface Embedded {
  page: PDFEmbeddedPage
  /** Source page's own /Rotate, normalised to 0 | 90 | 180 | 270. */
  rotate: number
}

/** Pages with no content stream (true blanks) cannot be embedded; we leave their slot empty. */
async function embedAll(out: PDFDocument, pages: PDFPage[], crop?: Insets): Promise<(Embedded | null)[]> {
  const result: (Embedded | null)[] = []
  for (const srcPage of pages) {
    if (!srcPage.node.Contents()) {
      result.push(null)
      continue
    }
    const rotate = normalizeRotation(srcPage.getRotation().angle)
    const bbox = crop ? insetsToBoundingBox(srcPage, crop, rotate) : undefined
    const [page] = await out.embedPages([srcPage], [bbox])
    result.push({ page, rotate })
  }
  return result
}

const POINTS_PER_INCH = 72

/**
 * Convert trim insets given in the page's visual orientation into a bounding box in
 * the page's own (unrotated) user space. pdf-lib shifts the box to the origin when
 * embedding, so the embedded page's width/height become the cropped size.
 *
 * With /Rotate N the page is displayed turned N° clockwise, so e.g. at 90° the
 * user-space left edge is what the viewer shows at the top.
 */
export function insetsToBoundingBox(srcPage: PDFPage, insets: Insets, rotate: number): PageBoundingBox {
  const { x, y, width, height } = srcPage.getCropBox()
  const { top: vt, right: vr, bottom: vb, left: vl } = insets
  // Insets from the user-space top, right, bottom, left edges.
  let t = vt, r = vr, b = vb, l = vl
  switch (rotate) {
    case 90:
      // visual top = user left, visual right = user top, visual bottom = user right, visual left = user bottom
      l = vt; t = vr; r = vb; b = vl
      break
    case 180:
      t = vb; r = vl; b = vt; l = vr
      break
    case 270:
      // visual top = user right, visual right = user bottom, visual bottom = user left, visual left = user top
      r = vt; b = vr; l = vb; t = vl
      break
  }
  const box: PageBoundingBox = {
    left: x + l * POINTS_PER_INCH,
    right: x + width - r * POINTS_PER_INCH,
    bottom: y + b * POINTS_PER_INCH,
    top: y + height - t * POINTS_PER_INCH,
  }
  if (box.right <= box.left || box.top <= box.bottom) {
    return { left: x, bottom: y, right: x + width, top: y + height }
  }
  return box
}

/**
 * Impose a PDF into a 2-up, fold-in-half booklet on Letter landscape sheets.
 * Runs entirely in memory; safe for the browser.
 */
export async function buildBooklet(input: Uint8Array | ArrayBuffer, options: BookletOptions): Promise<BuildResult> {
  const src = await PDFDocument.load(input, { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  if (pageCount === 0) throw new Error('The PDF has no pages.')

  const signatures = impose(pageCount, options.sheetsPerSignature ?? 0)
  const sides = toOutputSides(signatures, options.rotation)

  const out = await PDFDocument.create()
  out.setTitle(`${src.getTitle() ?? 'Document'} (booklet)`)
  out.setProducer('booklet_generator')

  const embedded = await embedAll(out, src.getPages(), options.crop)

  for (const side of sides) {
    const sheet = out.addPage([SHEET_WIDTH, SHEET_HEIGHT])
    side.slots.forEach((slot, slotIndex) => {
      const page = slot === null ? null : embedded[slot - 1]
      if (page) drawFitted(sheet, page, slotIndex * SLOT_WIDTH)
    })
    if (side.rotated) sheet.setRotation(degrees(180))
  }

  const bytes = await out.save()
  return { bytes, signatures, sides, pageCount }
}

function normalizeRotation(angle: number): number {
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return a
}

/**
 * Draw an embedded page scaled to fit a SLOT_WIDTH × SHEET_HEIGHT slot starting at
 * x = slotX, centred, honouring the source page's own /Rotate so it appears as it
 * does in a viewer.
 */
function drawFitted(sheet: PDFPage, { page, rotate }: Embedded, slotX: number) {
  const { width: w, height: h } = page
  const swapped = rotate === 90 || rotate === 270
  const visualW = swapped ? h : w
  const visualH = swapped ? w : h

  const scale = Math.min(SLOT_WIDTH / visualW, SHEET_HEIGHT / visualH)
  const drawnW = visualW * scale
  const drawnH = visualH * scale
  const x0 = slotX + (SLOT_WIDTH - drawnW) / 2
  const y0 = (SHEET_HEIGHT - drawnH) / 2

  // pdf-lib rotates counter-clockwise about the draw origin (x, y). A PDF /Rotate of
  // N means "display rotated N degrees clockwise", so we draw with -N and shift the
  // origin so the rotated box lands inside [x0, x0+drawnW] × [y0, y0+drawnH].
  let x = x0
  let y = y0
  switch (rotate) {
    case 90:
      // rotate -90 (clockwise): box spans x..x+h*s, y-w*s..y
      y = y0 + drawnH
      break
    case 180:
      // box spans x-w*s..x, y-h*s..y
      x = x0 + drawnW
      y = y0 + drawnH
      break
    case 270:
      // rotate +90 (counter-clockwise): box spans x-h*s..x, y..y+w*s
      x = x0 + drawnW
      break
  }

  sheet.drawPage(page, {
    x,
    y,
    xScale: scale,
    yScale: scale,
    rotate: degrees(-rotate),
  })
}
