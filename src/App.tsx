import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildBooklet, SHEET_HEIGHT, SHEET_WIDTH, type BuildResult } from './lib/buildBooklet'
import type { DetectResult } from './lib/contentBounds'
import { summarize } from './lib/imposition'
import type { PreviewImage } from './lib/preview'
import type { Insets, RotationMode } from './lib/types'

const STORAGE_KEY = 'booklet_generator.options.v2'

type FitMode = 'full' | 'auto' | 'manual'

interface Options {
  mode: 'single' | 'signatures'
  sheetsPerSignature: number
  rotation: RotationMode
  fit: FitMode
  /** Inches of whitespace to keep around detected content in auto mode. */
  pad: number
  manualInsets: Insets
}

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
const INSET_KEYS: (keyof Insets)[] = ['top', 'right', 'bottom', 'left']

const DEFAULT_OPTIONS: Options = {
  mode: 'single',
  sheetsPerSignature: 4,
  rotation: 'back',
  fit: 'auto',
  pad: 0.1,
  manualInsets: ZERO_INSETS,
}

function finiteInRange(n: unknown, min: number, max: number, fallback: number) {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

function parseInsets(raw: unknown): Insets {
  const o = (raw ?? {}) as Partial<Record<keyof Insets, unknown>>
  return {
    top: finiteInRange(o.top, 0, 20, 0),
    right: finiteInRange(o.right, 0, 20, 0),
    bottom: finiteInRange(o.bottom, 0, 20, 0),
    left: finiteInRange(o.left, 0, 20, 0),
  }
}

function loadOptions(): Options {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_OPTIONS
    const parsed = JSON.parse(raw) as Partial<Options>
    return {
      mode: parsed.mode === 'signatures' ? 'signatures' : 'single',
      sheetsPerSignature: Number.isInteger(parsed.sheetsPerSignature) && parsed.sheetsPerSignature! > 0 ? parsed.sheetsPerSignature! : 4,
      rotation: parsed.rotation === 'front' || parsed.rotation === 'none' ? parsed.rotation : 'back',
      fit: parsed.fit === 'full' || parsed.fit === 'manual' ? parsed.fit : 'auto',
      pad: finiteInRange(parsed.pad, 0, 2, 0.1),
      manualInsets: parseInsets(parsed.manualInsets),
    }
  } catch {
    return DEFAULT_OPTIONS
  }
}

function saveOptions(o: Options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o))
  } catch {
    /* private mode etc. */
  }
}

function outputName(inputName: string) {
  return inputName.replace(/\.pdf$/i, '') + '-booklet.pdf'
}

/** Scale at which a page of the given visual size (inches) is drawn into a half-sheet slot. */
function slotScale(wIn: number, hIn: number) {
  if (wIn <= 0 || hIn <= 0) return 0
  return Math.min(SHEET_WIDTH / 2 / 72 / wIn, SHEET_HEIGHT / 72 / hIn)
}

function fmtIn(n: number) {
  return n.toFixed(2).replace(/\.?0+$/, '')
}

export default function App() {
  const [options, setOptions] = useState<Options>(loadOptions)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [previews, setPreviews] = useState<PreviewImage[] | null>(null)
  const [busy, setBusy] = useState<'detect' | 'build' | 'preview' | null>(null)
  const [detected, setDetected] = useState<DetectResult | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const detectRun = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => saveOptions(options), [options])

  const blobUrl = useMemo(() => {
    if (!result) return null
    return URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
  }, [result])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  /** Scan a file for trimmable whitespace. A newer call supersedes any still running. */
  const detect = useCallback(async (f: File, pad: number) => {
    const run = ++detectRun.current
    const current = () => run === detectRun.current
    setBusy('detect')
    setDetectError(null)
    try {
      const { detectContentInsets } = await import('./lib/contentBounds')
      const bytes = new Uint8Array(await f.arrayBuffer())
      const res = await detectContentInsets(bytes, pad)
      if (current()) setDetected(res)
    } catch (e) {
      if (current()) setDetectError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current()) setBusy((b) => (b === 'detect' ? null : b))
    }
  }, [])

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      setError('Please choose a PDF file.')
      return
    }
    setError(null)
    setResult(null)
    setPreviews(null)
    setDetected(null)
    setDetectError(null)
    setFile(f)
    void detect(f, options.pad)
  }

  const setPad = (value: string) => {
    const pad = Math.max(0, Math.min(2, Number(value) || 0))
    setOptions({ ...options, pad })
    if (file) void detect(file, pad)
  }

  const generate = useCallback(async () => {
    if (!file) return
    setBusy('build')
    setError(null)
    setResult(null)
    setPreviews(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const crop =
        options.fit === 'auto' ? detected?.insets : options.fit === 'manual' ? options.manualInsets : undefined
      const built = await buildBooklet(bytes, {
        sheetsPerSignature: options.mode === 'signatures' ? options.sheetsPerSignature : 0,
        rotation: options.rotation,
        crop,
      })
      setResult(built)
      setBusy('preview')
      const { renderPreviews } = await import('./lib/preview')
      setPreviews(await renderPreviews(built.bytes))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [file, options, detected])

  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
  const share = async () => {
    if (!result || !file) return
    const out = new File([result.bytes as BlobPart], outputName(file.name), { type: 'application/pdf' })
    if (!navigator.canShare({ files: [out] })) {
      setError('Sharing files is not supported in this browser. Use Download instead.')
      return
    }
    try {
      await navigator.share({ files: [out], title: out.name })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const stats = result ? summarize(result.signatures, result.pageCount) : null

  const activeInsets: Insets | null =
    options.fit === 'auto' ? detected?.insets ?? null : options.fit === 'manual' ? options.manualInsets : null
  const fitReadout = (() => {
    if (!detected || !activeInsets) return null
    const { w, h } = detected.pageSizeIn
    const cw = w - activeInsets.left - activeInsets.right
    const ch = h - activeInsets.top - activeInsets.bottom
    if (cw <= 0 || ch <= 0) return 'These margins leave no content. Reduce them.'
    const before = slotScale(w, h)
    const after = slotScale(cw, ch)
    return `Content ${fmtIn(cw)} × ${fmtIn(ch)} in → pages drawn at ${Math.round(after * 100)}% instead of ${Math.round(before * 100)}%`
  })()

  const setInset = (key: keyof Insets, value: string) => {
    const n = Math.max(0, Math.min(20, Number(value) || 0))
    setOptions({ ...options, manualInsets: { ...options.manualInsets, [key]: n } })
  }

  return (
    <main className="app">
      <header>
        <h1>Booklet Generator</h1>
        <p className="tagline">
          Turn a PDF into a fold-in-half booklet, with the back sides pre-rotated for printers
          that flip the wrong way. Everything runs in your browser; nothing is uploaded.
        </p>
      </header>

      <section
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = '' }}
        />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span className="muted">{(file.size / 1024).toFixed(0)} KB · tap to change</span>
          </>
        ) : (
          <>
            <strong>Choose a PDF</strong>
            <span className="muted">tap here, or drag and drop</span>
          </>
        )}
      </section>

      <section className="options">
        <fieldset>
          <legend>Binding</legend>
          <label>
            <input
              type="radio"
              name="mode"
              checked={options.mode === 'single'}
              onChange={() => setOptions({ ...options, mode: 'single' })}
            />
            <span className="grow">Single booklet (all sheets nested and folded together)</span>
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={options.mode === 'signatures'}
              onChange={() => setOptions({ ...options, mode: 'signatures' })}
            />
            Signatures of
            <input
              type="number"
              min={1}
              max={50}
              value={options.sheetsPerSignature}
              disabled={options.mode !== 'signatures'}
              onChange={(e) => {
                const n = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1)))
                setOptions({ ...options, sheetsPerSignature: n })
              }}
              className="num"
            />
            sheets ({options.sheetsPerSignature * 4} pages each)
          </label>
        </fieldset>

        <fieldset>
          <legend>Printer fix</legend>
          <label>
            Rotation
            <select
              value={options.rotation}
              onChange={(e) => setOptions({ ...options, rotation: e.target.value as RotationMode })}
            >
              <option value="back">Rotate back sides 180° (default)</option>
              <option value="front">Rotate front sides 180°</option>
              <option value="none">No rotation (standard booklet)</option>
            </select>
          </label>
          <p className="hint">
            Keep the same double-sided setting you already use when printing. If your printer
            flips the other way, pick the opposite rotation.
          </p>
        </fieldset>

        <fieldset className="fit">
          <legend>Fit to page</legend>
          <label>
            <input type="radio" name="fit" checked={options.fit === 'full'} onChange={() => setOptions({ ...options, fit: 'full' })} />
            <span className="grow">Full page (keep all margins)</span>
          </label>
          <label>
            <input type="radio" name="fit" checked={options.fit === 'auto'} onChange={() => setOptions({ ...options, fit: 'auto' })} />
            Auto-trim whitespace, keeping
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={options.pad}
              disabled={options.fit !== 'auto'}
              onChange={(e) => setPad(e.target.value)}
              className="num"
            />
            in around content
          </label>
          <label>
            <input type="radio" name="fit" checked={options.fit === 'manual'} onChange={() => setOptions({ ...options, fit: 'manual' })} />
            <span className="grow">Manual margins to trim (inches)</span>
          </label>
          <div className="insets">
            {INSET_KEYS.map((key) => (
              <label key={key} className="inset">
                <span>{key}</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={0.05}
                  value={options.manualInsets[key]}
                  disabled={options.fit !== 'manual'}
                  onChange={(e) => setInset(key, e.target.value)}
                  className="num"
                />
              </label>
            ))}
            <button
              type="button"
              className="small"
              disabled={options.fit !== 'manual' || !detected}
              onClick={() => detected && setOptions({ ...options, manualInsets: detected.insets })}
            >
              Use detected
            </button>
          </div>
          <p className="hint">
            {busy === 'detect' && 'Scanning pages for whitespace…'}
            {busy !== 'detect' && detectError && `Could not scan this PDF (${detectError}); trimming is unavailable.`}
            {busy !== 'detect' && !detectError && fitReadout}
            {busy !== 'detect' && !detectError && !fitReadout && !file && 'Choose a PDF to see how much the content can grow.'}
            {busy !== 'detect' && !detectError && !fitReadout && file && options.fit === 'full' && 'Pages are scaled to fit the half-sheet as they are.'}
          </p>
        </fieldset>
      </section>

      <section className="actions">
        <button className="primary" disabled={!file || busy !== null} onClick={generate}>
          {busy === 'detect' ? 'Scanning…' : busy === 'build' ? 'Building…' : busy === 'preview' ? 'Rendering preview…' : 'Generate booklet'}
        </button>
        {result && blobUrl && file && (
          <>
            <a className="button" href={blobUrl} download={outputName(file.name)}>
              Download PDF
            </a>
            {canShare && (
              <button onClick={share}>Share…</button>
            )}
          </>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {result && stats && (
        <section className="summary">
          <p>
            <strong>{result.pageCount}</strong> pages →{' '}
            <strong>{stats.sheets}</strong> sheet{stats.sheets === 1 ? '' : 's'} ({stats.outputPages} sides)
            {stats.signatures > 1 && <> in <strong>{stats.signatures}</strong> signatures</>}
            {stats.blankPages > 0 && <>, {stats.blankPages} blank page{stats.blankPages === 1 ? '' : 's'} added</>}
          </p>
          <p className="hint">
            Print double-sided on Letter, landscape. Then fold each signature in half
            {stats.signatures > 1 ? ' and stack them in order.' : '.'}
          </p>
        </section>
      )}

      {result && (
        <section className="preview">
          <h2>Preview</h2>
          {!previews && busy === 'preview' && <p className="muted">Rendering…</p>}
          {previews && (
            <div className="grid">
              {result.sides.map((side, i) => (
                <figure key={i} className={side.rotated ? 'rotated' : ''}>
                  <img src={previews[i]?.dataUrl} alt={`Output page ${i + 1}`} />
                  <figcaption>
                    {result.signatures.length > 1 && <span>Sig {side.signatureIndex + 1} · </span>}
                    Sheet {side.sheetIndex + 1} · {side.side === 'front' ? 'Front' : 'Back'}
                    <span className="muted"> · pages {side.slots.map((s) => s ?? '—').join(' | ')}</span>
                    {side.rotated && <span className="badge">rotated</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      )}

      <footer>
        <a href="https://github.com/j3cohen/booklet_generator">Source on GitHub</a>
      </footer>
    </main>
  )
}
