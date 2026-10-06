import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PreviewImage {
  dataUrl: string
  width: number
  height: number
}

/**
 * Render every page of a PDF to a small PNG data URL. pdf.js honours each page's
 * /Rotate, so rotated back sides will appear upside-down here, which is what we want.
 */
export async function renderPreviews(bytes: Uint8Array, targetWidth = 360): Promise<PreviewImage[]> {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  const images: PreviewImage[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const scale = targetWidth / base.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not create canvas context')
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      images.push({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return images
}
