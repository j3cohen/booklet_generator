import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildBooklet, type BuildResult } from './lib/buildBooklet'
import { summarize } from './lib/imposition'
import type { PreviewImage } from './lib/preview'
import type { RotationMode } from './lib/types'

const STORAGE_KEY = 'booklet_generator.options.v1'

interface Options {
  mode: 'single' | 'signatures'
  sheetsPerSignature: number
  rotation: RotationMode
}

const DEFAULT_OPTIONS: Options = { mode: 'single', sheetsPerSignature: 4, rotation: 'back' }

function loadOptions(): Options {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_OPTIONS
    const parsed = JSON.parse(raw) as Partial<Options>
    return {
      mode: parsed.mode === 'signatures' ? 'signatures' : 'single',
      sheetsPerSignature: Number.isInteger(parsed.sheetsPerSignature) && parsed.sheetsPerSignature! > 0 ? parsed.sheetsPerSignature! : 4,
      rotation: parsed.rotation === 'front' || parsed.rotation === 'none' ? parsed.rotation : 'back',
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

export default function App() {
  const [options, setOptions] = useState<Options>(loadOptions)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [previews, setPreviews] = useState<PreviewImage[] | null>(null)
  const [busy, setBusy] = useState<'build' | 'preview' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => saveOptions(options), [options])

  const blobUrl = useMemo(() => {
    if (!result) return null
    return URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }))
  }, [result])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      setError('Please choose a PDF file.')
      return
    }
    setError(null)
    setResult(null)
    setPreviews(null)
    setFile(f)
  }

  const generate = useCallback(async () => {
    if (!file) return
    setBusy('build')
    setError(null)
    setResult(null)
    setPreviews(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const built = await buildBooklet(bytes, {
        sheetsPerSignature: options.mode === 'signatures' ? options.sheetsPerSignature : 0,
        rotation: options.rotation,
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
  }, [file, options])

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
      </section>

      <section className="actions">
        <button className="primary" disabled={!file || busy !== null} onClick={generate}>
          {busy === 'build' ? 'Building…' : busy === 'preview' ? 'Rendering preview…' : 'Generate booklet'}
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
