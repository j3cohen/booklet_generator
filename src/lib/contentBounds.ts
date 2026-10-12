import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Insets } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Inclusive pixel box: columns minX..maxX, rows minY..maxY. */
export interface PixelBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PixelBoundsOptions {
  /** A pixel is "ink" if any RGB channel is below this (0–255). */
  threshold?: number
  /** A row or column only counts if it has at least this many ink pixels (drops scanner specks). */
  minInkPerLine?: number
}

/**
 * Find the bounding box of non-white pixels in an RGBA buffer. Pure and synchronous
 * so it can be unit-tested without a canvas. Returns null for a blank image.
 */
export function pixelBounds(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  { threshold = 235, minInkPerLine = 2 }: PixelBoundsOptions = {},
): PixelBox | null {
  const rows = new Uint32Array(height)
  const cols = new Uint32Array(width)
  for (let y = 0; y < height; y++) {
    let i = y * width * 4
    for (let x = 0; x < width; x++, i += 4) {
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        rows[y]++
        cols[x]++
      }
    }
  }
  let minY = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    if (rows[y] >= minInkPerLine) {
      if (minY < 0) minY = y
      maxY = y
    }
  }
  let minX = -1
  let maxX = -1
  for (let x = 0; x < width; x++) {
    if (cols[x] >= minInkPerLine) {
      if (minX < 0) minX = x
      maxX = x
    }
  }
  if (minY < 0 || minX < 0) return null
  return { minX, minY, maxX, maxY }
}

export interface DetectResult {
  /** Whitespace that can be trimmed from every page, already reduced by the padding. */
  insets: Insets
  /** Visual size of the first page, in inches. */
  pageSizeIn: { w: number; h: number }
  /** 1-based numbers of pages with no detectable content. */
  blankPages: number[]
}

/** Points per inch. */
const PT = 72
/** Render scale for detection: 0.5 → ~2 pt precision, ~300×400 px for Letter. */
const DETECT_SCALE = 0.5
/** Never trim so much that less than this many inches remain in either direction. */
const MIN_REMAINING_IN = 1

export function zeroInsets(): Insets {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

/**
 * Rasterise every page at low resolution and find the whitespace common to all of
 * them. One uniform crop keeps the type size consistent across the booklet.
 */
export async function detectContentInsets(bytes: Uint8Array, padInches = 0.1): Promise<DetectResult> {
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  const blankPages: number[] = []
  let union: Insets | null = null
  let pageSizeIn = { w: 0, h: 0 }
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not create canvas context')
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: DETECT_SCALE })
      const w = Math.ceil(viewport.width)
      const h = Math.ceil(viewport.height)
      if (i === 1) pageSizeIn = { w: viewport.width / DETECT_SCALE / PT, h: viewport.height / DETECT_SCALE / PT }
      canvas.width = w
      canvas.height = h
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      const box = pixelBounds(ctx.getImageData(0, 0, w, h).data, w, h)
      page.cleanup()
      if (!box) {
        blankPages.push(i)
        continue
      }
      const toIn = (px: number) => px / DETECT_SCALE / PT
      const here: Insets = {
        top: toIn(box.minY),
        left: toIn(box.minX),
        right: toIn(w - 1 - box.maxX),
        bottom: toIn(h - 1 - box.maxY),
      }
      union = union
        ? {
            top: Math.min(union.top, here.top),
            right: Math.min(union.right, here.right),
            bottom: Math.min(union.bottom, here.bottom),
            left: Math.min(union.left, here.left),
          }
        : here
    }
  } finally {
    await task.destroy()
  }

  if (!union) return { insets: zeroInsets(), pageSizeIn, blankPages }
  const padded: Insets = {
    top: Math.max(0, union.top - padInches),
    right: Math.max(0, union.right - padInches),
    bottom: Math.max(0, union.bottom - padInches),
    left: Math.max(0, union.left - padInches),
  }
  const remainingW = pageSizeIn.w - padded.left - padded.right
  const remainingH = pageSizeIn.h - padded.top - padded.bottom
  if (remainingW < MIN_REMAINING_IN || remainingH < MIN_REMAINING_IN) {
    return { insets: zeroInsets(), pageSizeIn, blankPages }
  }
  return { insets: round(padded), pageSizeIn, blankPages }
}

function round(i: Insets): Insets {
  const r = (n: number) => Math.round(n * 100) / 100
  return { top: r(i.top), right: r(i.right), bottom: r(i.bottom), left: r(i.left) }
}
