# Booklet Generator

Turn any PDF into a fold-in-half booklet, with the back side of every sheet
pre-rotated 180° for printers whose duplex setting flips the wrong way.

**Live app:** https://j3cohen.github.io/booklet_generator/

Everything runs in the browser. The PDF never leaves your device, so it works
offline-ish and from iPad Safari.

## Why

Built-in booklet printing (e.g. the iPadOS print dialog) assumes the printer
flips sheets along a particular edge. Mine does not, so every back side comes
out upside-down. The old workaround was: generate the booklet on the iPad, save
it as a PDF, then rotate every even page by hand. This app does all of that in
one step.

## How to use

1. Open the app and choose a PDF (tap the box, or drag a file onto it).
2. Pick options:
   - **Binding** — *Single booklet* nests every sheet into one fold (fine up to
     roughly 10 sheets / 40 pages). *Signatures of N sheets* splits a long
     document into groups you fold separately and then stack in order.
   - **Printer fix** — *Rotate back sides 180°* is the default and matches the
     manual workaround. If your printer flips the other way, choose *Rotate
     front sides* instead. *No rotation* gives a standard booklet.
   - **Fit to page** — *Auto-trim whitespace* (default) scans every page for
     the whitespace common to all of them and crops it away so the content is
     drawn larger in each half-sheet, keeping a small padding you can adjust.
     *Manual margins* lets you type the inches to trim from each edge (tap
     *Use detected* to start from the scanned values). *Full page* keeps the
     original margins. The hint under the options shows the content size and
     how much larger the pages will be drawn.
3. Tap **Generate booklet**. A preview of every output side appears; rotated
   sides show upside-down on purpose.
4. **Download PDF**, or on iPad use **Share…** to save to Files or AirPrint
   directly.
5. Print double-sided on **US Letter, landscape**, using the same double-sided
   setting you already use. Fold each signature in half.

The output has two source pages per side of a Letter landscape sheet, each
scaled to fit a 5.5 × 8.5 in half with its aspect ratio preserved. Blank pages
are added at the end as needed to reach a multiple of four.

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # unit tests for imposition order and PDF building
pnpm build        # production build into dist/
pnpm make-sample  # regenerate the numbered test PDFs in sample/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

### Layout

- `src/lib/imposition.ts` — pure page-order math (which source pages go on
  which side of which sheet).
- `src/lib/buildBooklet.ts` — composes the output PDF with pdf-lib and applies
  the rotation by setting each page's `/Rotate`, exactly as rotating in
  Preview or the Files app does.
- `src/lib/contentBounds.ts` — rasterises each source page at low resolution
  with pdf.js and finds the whitespace shared by every page.
- `src/lib/preview.ts` — renders thumbnails with pdf.js.
- `src/App.tsx` — the single-screen UI.

### Notes

- Rotation is applied via the page's `/Rotate` attribute. Every mainstream
  viewer and print path honours it. If a printer ever ignores it, the fallback
  is to bake the rotation into the page content when drawing; that is not
  implemented.
- Source pages that carry their own `/Rotate` (landscape scans, etc.) are
  drawn as they appear in a viewer.
- Trimming is one uniform crop for the whole document (the union of every
  page's content box), so type size stays consistent across pages. Detection
  is pixel-based: a full-bleed cover or a scan with dark edges will stop
  auto-trim from finding much, in which case use manual margins. Cropping is
  done by embedding each page with a tighter bounding box; nothing is
  re-rendered.
