import type { OutputSide, RotationMode, Sheet, Signature, Slot } from './types'

/**
 * Compute the booklet imposition for a document.
 *
 * Returns signatures in order. Each signature's sheets are listed outermost first,
 * which is the order you print them (sheet 1 front, sheet 1 back, sheet 2 front, ...).
 * Fold the stack in half and the pages read in order.
 *
 * @param pageCount number of source pages (>= 1)
 * @param sheetsPerSignature sheets per signature; 0 or undefined = single booklet
 */
export function impose(pageCount: number, sheetsPerSignature = 0): Signature[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`pageCount must be a positive integer, got ${pageCount}`)
  }
  if (!Number.isInteger(sheetsPerSignature) || sheetsPerSignature < 0) {
    throw new Error(`sheetsPerSignature must be a non-negative integer, got ${sheetsPerSignature}`)
  }

  const signatures: Signature[] = []
  const pagesPerSignature = sheetsPerSignature > 0 ? sheetsPerSignature * 4 : Infinity

  let base = 0 // pages consumed so far
  while (base < pageCount) {
    const remaining = pageCount - base
    const pagesHere = Math.min(remaining, pagesPerSignature)
    const sheetCount = Math.ceil(pagesHere / 4)
    const span = sheetCount * 4 // pages this signature covers, incl. blanks

    const slot = (n: number): Slot => (n <= pageCount ? n : null)
    const sheets: Sheet[] = []
    for (let k = 0; k < sheetCount; k++) {
      sheets.push({
        front: [slot(base + span - 2 * k), slot(base + 2 * k + 1)],
        back: [slot(base + 2 * k + 2), slot(base + span - 2 * k - 1)],
      })
    }
    signatures.push({ firstPage: base + 1, sheets })
    base += span
  }
  return signatures
}

/** Flatten signatures into the ordered list of output PDF pages. */
export function toOutputSides(signatures: Signature[], rotation: RotationMode): OutputSide[] {
  const sides: OutputSide[] = []
  signatures.forEach((sig, signatureIndex) => {
    sig.sheets.forEach((sheet, sheetIndex) => {
      sides.push({
        signatureIndex,
        sheetIndex,
        side: 'front',
        slots: sheet.front,
        rotated: rotation === 'front',
      })
      sides.push({
        signatureIndex,
        sheetIndex,
        side: 'back',
        slots: sheet.back,
        rotated: rotation === 'back',
      })
    })
  })
  return sides
}

/** Summary numbers for the UI. */
export function summarize(signatures: Signature[], pageCount: number) {
  const sheets = signatures.reduce((n, s) => n + s.sheets.length, 0)
  return {
    signatures: signatures.length,
    sheets,
    outputPages: sheets * 2,
    blankPages: sheets * 4 - pageCount,
  }
}
