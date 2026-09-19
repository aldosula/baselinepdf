import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Eraser, Loader2, Trash2, Upload, X } from 'lucide-react'
import { Button, ColorPicker, Field, IconButton, Segmented, Slider } from './ui'
import { canvasToTrimmedPng, defaultCutout, makeCutout, type Cutout, type CutoutOptions } from '../lib/bgremove'
import { fileToDataUrl } from '../lib/image'
import { useStore } from '../lib/store'

type Tab = 'draw' | 'type' | 'upload'
const INKS = ['#101a33', '#000000', '#1c4ed8', '#7a1220']
const SCRIPTS = [
  { label: 'Flowing', css: '"Dancing Script", cursive' },
  { label: 'Casual', css: '"Caveat", cursive' },
  { label: 'Formal', css: '"Great Vibes", cursive' },
]

export function SignatureDialog({
  onClose, onInsert,
}: { onClose: () => void; onInsert: (sig: Cutout) => void }) {
  const [tab, setTab] = useState<Tab>('draw')
  const [ink, setInk] = useState('#101a33')
  const [result, setResult] = useState<Cutout | null>(null)
  const signatures = useStore(s => s.signatures)
  const saveSignature = useStore(s => s.saveSignature)
  const deleteSignature = useStore(s => s.deleteSignature)
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const insert = (sig: Cutout) => {
    if (remember) saveSignature({ dataUrl: sig.dataUrl, width: sig.width, height: sig.height, label: tab })
    onInsert(sig)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/45 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Signature studio"
        className="surface flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-lg)] hairline shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold">Signature studio</h2>
            <p className="text-[12px] text-dim">Draw it, type it, or lift it off a photo with the paper removed.</p>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-2.5">
          <div className="w-64">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[{ value: 'draw', label: 'Draw' }, { value: 'type', label: 'Type' }, { value: 'upload', label: 'From photo' }]}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-dim uppercase">Ink</span>
            <ColorPicker value={ink} onChange={c => setInk(c ?? '#101a33')} swatches={INKS} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {tab === 'draw' && <DrawPad ink={ink} onResult={setResult} />}
          {tab === 'type' && <TypePad ink={ink} onResult={setResult} />}
          {tab === 'upload' && <UploadPad ink={ink} onResult={setResult} />}

          {signatures.length ? (
            <section className="border-t border-[var(--line)] px-5 py-4">
              <h3 className="mb-2.5 text-[11px] font-bold tracking-[0.08em] text-dim uppercase">Saved signatures</h3>
              <div className="flex flex-wrap gap-2">
                {signatures.map(s => (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => onInsert({ dataUrl: s.dataUrl, width: s.width, height: s.height, paper: 'transparent' })}
                      className="surface-2 flex h-16 w-40 items-center justify-center rounded-[var(--radius-sm)] hairline p-2 transition-colors hover:border-brand-500"
                      title="Insert this signature"
                    >
                      <img src={s.dataUrl} alt="Saved signature" className="max-h-full max-w-full object-contain" />
                    </button>
                    <button
                      onClick={() => deleteSignature(s.id)}
                      aria-label="Delete saved signature"
                      className="absolute -top-1.5 -right-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] hairline text-red-600 group-hover:flex hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-5 py-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-dim">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-[var(--color-brand-600)]" />
            Keep in my signature library
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="solid" disabled={!result} onClick={() => result && insert(result)}>
              <Check size={16} /> Place on page
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ draw */

function DrawPad({ ink, onResult }: { ink: string; onResult: (c: Cutout | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<{ x: number; y: number }[][]>([])
  const drawing = useRef(false)

  const repaint = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = ink
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes.current) {
      if (s.length < 2) {
        if (s.length === 1) { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(s[0].x, s[0].y, 2.4, 0, Math.PI * 2); ctx.fill() }
        continue
      }
      ctx.beginPath()
      ctx.moveTo(s[0].x, s[0].y)
      for (let i = 1; i < s.length - 1; i++) {
        // quadratic smoothing keeps the line from looking like a polygon
        const mid = { x: (s[i].x + s[i + 1].x) / 2, y: (s[i].y + s[i + 1].y) / 2 }
        const width = Math.max(1.4, 4.2 - Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) * 0.18)
        ctx.lineWidth = width
        ctx.quadraticCurveTo(s[i].x, s[i].y, mid.x, mid.y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(mid.x, mid.y)
      }
      ctx.lineTo(s[s.length - 1].x, s[s.length - 1].y)
      ctx.stroke()
    }
    onResult(strokes.current.length ? canvasToTrimmedPng(canvas) : null)
  }, [ink, onResult])

  useEffect(() => { repaint() }, [repaint])

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (ref.current!.width / r.width), y: (e.clientY - r.top) * (ref.current!.height / r.height) }
  }

  return (
    <div className="px-5 py-5">
      <div className="relative">
        <canvas
          ref={ref}
          width={1200}
          height={360}
          className="h-[220px] w-full touch-none rounded-[var(--radius-md)] hairline bg-white"
          onPointerDown={e => { drawing.current = true; strokes.current.push([point(e)]); (e.target as HTMLElement).setPointerCapture(e.pointerId); repaint() }}
          onPointerMove={e => { if (!drawing.current) return; strokes.current[strokes.current.length - 1].push(point(e)); repaint() }}
          onPointerUp={() => { drawing.current = false; repaint() }}
        />
        <div className="pointer-events-none absolute right-0 bottom-9 left-0 mx-8 border-b border-dashed border-ink-300" />
        {!strokes.current.length ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-ink-400">
            Sign here with a trackpad, mouse or finger
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => { strokes.current = []; repaint() }}>
          <Eraser size={14} /> Clear
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ type */

function TypePad({ ink, onResult }: { ink: string; onResult: (c: Cutout | null) => void }) {
  const [name, setName] = useState('')
  const [script, setScript] = useState(SCRIPTS[0].css)
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!name.trim()) { onResult(null); return }
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = ink
      ctx.textBaseline = 'middle'
      let size = 180
      ctx.font = `${size}px ${script}`
      while (ctx.measureText(name).width > canvas.width - 80 && size > 24) {
        size -= 4
        ctx.font = `${size}px ${script}`
      }
      ctx.fillText(name, 40, canvas.height / 2)
      onResult(canvasToTrimmedPng(canvas))
    }
    void (document.fonts?.ready.then(paint) ?? Promise.resolve(paint()))
  }, [name, script, ink, onResult])

  return (
    <div className="space-y-4 px-5 py-5">
      <Field label="Your name">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          className="surface-2 h-10 w-full rounded-[var(--radius-sm)] hairline px-3 text-sm outline-none focus:border-brand-500"
        />
      </Field>
      <div className="flex gap-2">
        {SCRIPTS.map(s => (
          <button
            key={s.label}
            onClick={() => setScript(s.css)}
            style={{ fontFamily: s.css }}
            className={clsx(
              'h-14 flex-1 rounded-[var(--radius-sm)] hairline text-[26px] transition-colors',
              script === s.css ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-white/5',
            )}
          >
            {name.trim() ? name.slice(0, 12) : s.label}
          </button>
        ))}
      </div>
      <canvas ref={ref} width={1200} height={300} className="h-[150px] w-full rounded-[var(--radius-md)] hairline bg-white" />
    </div>
  )
}

/* ---------------------------------------------------------------- upload */

function UploadPad({ ink, onResult }: { ink: string; onResult: (c: Cutout | null) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [opts, setOpts] = useState<CutoutOptions>({ ...defaultCutout, inkColor: ink })
  const [preview, setPreview] = useState<Cutout | null>(null)
  const [busy, setBusy] = useState(false)
  const [onDark, setOnDark] = useState(false)

  useEffect(() => { setOpts(o => ({ ...o, inkColor: o.inkColor === null ? null : ink })) }, [ink])

  useEffect(() => {
    if (!src) return
    let alive = true
    setBusy(true)
    const t = setTimeout(() => {
      void makeCutout(src, opts).then(c => {
        if (!alive) return
        setPreview(c)
        onResult(c)
        setBusy(false)
      }).catch(() => setBusy(false))
    }, 90)
    return () => { alive = false; clearTimeout(t) }
  }, [src, opts, onResult])

  const take = async (file: File | null | undefined) => {
    if (!file) return
    setSrc(await fileToDataUrl(file))
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile()
      if (file) void take(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  if (!src) {
    return (
      <div className="px-5 py-5">
        <label
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); void take(e.dataTransfer.files[0]) }}
          className="flex h-[240px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--line)] text-center transition-colors hover:border-brand-500 hover:bg-brand-50/50 dark:hover:bg-brand-500/5"
        >
          <Upload size={24} className="text-dim" />
          <div>
            <p className="text-sm font-semibold">Drop a photo or scan of your signature</p>
            <p className="mt-1 text-[12px] text-dim">PNG, JPEG or HEIC. You can also paste from the clipboard.</p>
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={e => void take(e.target.files?.[0])} />
        </label>
      </div>
    )
  }

  return (
    <div className="grid gap-5 px-5 py-5 md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        <div
          className={clsx(
            'relative flex h-[260px] items-center justify-center overflow-hidden rounded-[var(--radius-md)] hairline',
            onDark ? 'bg-ink-800' : 'bg-white',
          )}
          style={onDark ? undefined : {
            backgroundImage:
              'linear-gradient(45deg, #eef2f3 25%, transparent 25%), linear-gradient(-45deg, #eef2f3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eef2f3 75%), linear-gradient(-45deg, transparent 75%, #eef2f3 75%)',
            backgroundSize: '18px 18px',
            backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
          }}
        >
          {preview ? <img src={preview.dataUrl} alt="Signature preview" className="max-h-full max-w-full object-contain p-4" /> : null}
          {busy ? <Loader2 size={18} className="absolute top-3 right-3 animate-spin text-dim" /> : null}
        </div>
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-dim">
            <input type="checkbox" checked={onDark} onChange={e => setOnDark(e.target.checked)} className="accent-[var(--color-brand-600)]" />
            Check the edges on a dark background
          </label>
          <Button variant="outline" size="sm" onClick={() => { setSrc(null); setPreview(null); onResult(null) }}>
            Use another photo
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Ink pickup" hint="Raise it if paper texture is showing, lower it if the strokes break up.">
          <Slider value={opts.threshold} min={5} max={90} onChange={v => setOpts(o => ({ ...o, threshold: v }))} suffix="%" />
        </Field>
        <Field label="Edge softness" hint="Keeps the anti-aliased edge of the pen instead of a hard cut.">
          <Slider value={opts.softness} min={0} max={70} onChange={v => setOpts(o => ({ ...o, softness: v }))} suffix="%" />
        </Field>
        <Field label="Recolour">
          <Segmented
            value={opts.inkColor === null ? 'original' : 'ink'}
            onChange={v => setOpts(o => ({ ...o, inkColor: v === 'original' ? null : ink }))}
            options={[{ value: 'ink', label: 'Chosen ink' }, { value: 'original', label: 'As photographed' }]}
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={opts.despeckle}
            onChange={e => setOpts(o => ({ ...o, despeckle: e.target.checked }))}
            className="accent-[var(--color-brand-600)]"
          />
          Remove dust and JPEG specks
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={opts.autoCrop}
            onChange={e => setOpts(o => ({ ...o, autoCrop: e.target.checked }))}
            className="accent-[var(--color-brand-600)]"
          />
          Trim to the ink
        </label>
      </div>
    </div>
  )
}
