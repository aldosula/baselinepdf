import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, Loader2, X } from 'lucide-react'
import { useStore } from './lib/store'
import { exportPdf, downloadBytes } from './lib/export'
import { normaliseImage } from './lib/image'
import { renderPage } from './lib/pdf'
import type { AnyObj } from './lib/types'
import { uid } from './lib/id'
import { TopBar } from './components/TopBar'
import { ToolRail } from './components/ToolRail'
import { Thumbnails } from './components/Thumbnails'
import { Inspector } from './components/Inspector'
import { PageView } from './components/PageView'
import { Welcome } from './components/Welcome'
import { SignatureDialog } from './components/SignatureDialog'
import { IconButton } from './components/ui'

type Toast = { kind: 'ok' | 'warn' | 'ask'; title: string; lines?: string[]; action?: { label: string; run: () => void } }

export default function App() {
  const proxy = useStore(s => s.proxy)
  const loading = useStore(s => s.loading)
  const pages = useStore(s => s.pages)
  const zoom = useStore(s => s.zoom)
  const fitMode = useStore(s => s.fitMode)
  const theme = useStore(s => s.theme)
  const store = useStore.getState

  const scrollRef = useRef<HTMLDivElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [signing, setSigning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const pendingRestore = useStore(s => s.pendingRestore)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { void store().loadSignatures() }, [store])
  useEffect(() => { void store().refreshRecents() }, [store])

  /* a small picture of the first page, so the drawer is recognisable */
  useEffect(() => {
    if (!proxy || !pages.length) return
    let alive = true
    void (async () => {
      const page = await proxy.getPage(pages[0].index)
      const result = await renderPage(page, 240 / pages[0].width, pages[0].userRotation)
      if (!result || !alive) return
      const thumb = document.createElement('canvas')
      thumb.width = result.canvas.width
      thumb.height = Math.min(result.canvas.height, Math.round(result.canvas.width * 0.8))
      thumb.getContext('2d')!.drawImage(result.canvas, 0, 0)
      store().setThumb(thumb.toDataURL('image/jpeg', 0.6))
    })()
    return () => { alive = false }
  }, [proxy, pages, store])

  /* edits already held for this file are offered, never applied behind your back */
  useEffect(() => {
    if (!pendingRestore) return
    setToast({
      kind: 'ask',
      title: 'This document has edits saved in this browser',
      lines: [`${pendingRestore.count} object${pendingRestore.count === 1 ? '' : 's'} from your last session. Editing now replaces them.`],
      action: { label: 'Bring them back', run: () => { void store().applyPending(); setToast(null) } },
    })
  }, [pendingRestore, store])

  /* ?open=<url> loads a PDF straight from disk or a local server, which keeps
     bookmarks and quick tests one click away */
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('open')
    if (!url) return
    void (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const blob = await res.blob()
        await store().openFile(new File([blob], url.split('/').pop() || 'document.pdf', { type: 'application/pdf' }))
      } catch { /* a missing file simply leaves the welcome screen up */ }
    })()
  }, [store])

  /* fit to width, recomputed when the window or the document changes */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pages.length) return
    const apply = () => {
      if (useStore.getState().fitMode !== 'width') return
      const widest = Math.max(...pages.filter(p => !p.deleted).map(p => (p.userRotation % 180 ? p.height : p.width)))
      const next = Math.max(0.1, (el.clientWidth - 72) / widest)
      useStore.setState({ zoom: Math.min(next, 3) })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pages, fitMode])

  /* the page under the top of the viewport is the one the toolbar acts on */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pages.length) return
    let raf = 0
    const read = () => {
      const anchor = el.getBoundingClientRect().top + 80
      let best: HTMLElement | null = null
      let bestScore = Infinity
      el.querySelectorAll<HTMLElement>('[data-page]').forEach(node => {
        const r = node.getBoundingClientRect()
        const score = r.bottom < anchor ? Infinity : Math.abs(r.top - anchor)
        if (score < bestScore) { bestScore = score; best = node }
      })
      const index = Number((best as HTMLElement | null)?.dataset.page ?? 0)
      if (index && index !== useStore.getState().activePage) useStore.getState().setActivePage(index)
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read) }
    el.addEventListener('scroll', onScroll, { passive: true })
    read()
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [pages])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const s = useStore.getState()
      const before = s.zoom
      const next = Math.min(6, Math.max(0.1, before * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
      const rect = el.getBoundingClientRect()
      const ax = e.clientX - rect.left + el.scrollLeft
      const ay = e.clientY - rect.top + el.scrollTop
      s.setZoom(next)
      requestAnimationFrame(() => {
        el.scrollLeft += ax * (next / before - 1)
        el.scrollTop += ay * (next / before - 1)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const place = useCallback((src: string, w: number, h: number, role: 'image' | 'signature', mime: 'image/png' | 'image/jpeg' = 'image/png') => {
    const state = useStore.getState()
    const page = state.pages.find(p => p.index === state.activePage && !p.deleted) ?? state.pages.find(p => !p.deleted)
    if (!page) return
    const targetW = role === 'signature' ? Math.min(page.width * 0.34, 190) : page.width * 0.45
    const scale = targetW / w
    const obj: AnyObj = {
      id: uid(role), kind: 'image', page: page.index,
      rect: { x: (page.width - targetW) / 2, y: (page.height - h * scale) / 2, w: targetW, h: h * scale },
      rotation: 0, opacity: 1, src, mime, naturalW: w, naturalH: h, role,
    }
    store().add(obj)
    store().setTool('select')
  }, [store])

  const onSave = useCallback(async () => {
    const { bytes, pages, objects, fileName } = useStore.getState()
    if (!bytes) return
    setSaving(true)
    try {
      const { bytes: out, warnings } = await exportPdf(bytes, pages, objects)
      const stem = fileName.replace(/\.pdf$/i, '')
      downloadBytes(out, `${stem} (edited).pdf`)
      setToast(warnings.length
        ? { kind: 'warn', title: 'Saved, with notes', lines: warnings }
        : { kind: 'ok', title: `Saved as "${stem} (edited).pdf"` })
    } catch (e) {
      setToast({ kind: 'warn', title: 'That file could not be written', lines: [e instanceof Error ? e.message : 'Unknown error'] })
    } finally {
      setSaving(false)
    }
  }, [])

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.matches('input, textarea, select') || target.isContentEditable) return
      const meta = e.metaKey || e.ctrlKey
      const s = useStore.getState()

      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); void onSave(); return }
      if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); pdfInput.current?.click(); return }
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicate(s.selection); return }
      if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); s.setZoom(s.zoom * 1.25); return }
      if (meta && e.key === '-') { e.preventDefault(); s.setZoom(s.zoom / 1.25); return }
      if (meta) return

      if (e.key === 'Escape') { s.select([]); s.setEditingText(null); s.setTool('select'); return }

      if (e.key === 'Tab') {
        const onPage = s.objects.filter(o => o.page === s.activePage)
        if (!onPage.length) return
        e.preventDefault()
        const at = onPage.findIndex(o => s.selection.includes(o.id))
        const next = onPage[(at + (e.shiftKey ? onPage.length - 1 : 1) + onPage.length) % onPage.length]
        s.setTool('select')
        s.select([next.id])
        return
      }

      if (e.key === 'Enter' && s.selection.length === 1) {
        const obj = s.objects.find(o => o.id === s.selection[0])
        if (obj?.kind === 'text') { e.preventDefault(); s.setEditingText(obj.id) }
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) { e.preventDefault(); s.deleteSelection(); return }

      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        s.mutate(d => {
          for (const o of d.objects) if (s.selection.includes(o.id)) { o.rect = { ...o.rect, x: o.rect.x + dx, y: o.rect.y + dy } }
        })
        return
      }

      const map: Record<string, () => void> = {
        v: () => s.setTool('select'),
        t: () => s.setTool('text'),
        h: () => s.setTool('highlight'),
        d: () => s.setTool('draw'),
        r: () => s.setTool('shape'),
        w: () => s.setTool('whiteout'),
        e: () => s.setTool('erase'),
        i: () => imageInput.current?.click(),
        s: () => setSigning(true),
      }
      map[e.key.toLowerCase()]?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSave])

  useEffect(() => {
    if (!toast || toast.action) return // one that asks something waits for an answer
    const t = setTimeout(() => setToast(null), toast.kind === 'ok' ? 4200 : 9000)
    return () => clearTimeout(t)
  }, [toast])

  const live = pages.filter(p => !p.deleted)

  return (
    <div className="flex h-full flex-col">
      <input
        ref={pdfInput} type="file" accept="application/pdf,.pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void store().openFile(f); e.target.value = '' }}
      />
      <input
        ref={imageInput} type="file" accept="image/*" className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const img = await normaliseImage(f)
          place(img.src, img.w, img.h, 'image', img.mime)
        }}
      />

      {proxy ? (
        <>
          <TopBar onSave={() => void onSave()} saving={saving} onOpen={() => pdfInput.current?.click()} />
          <div className="flex min-h-0 flex-1">
            <ToolRail onPickImage={() => imageInput.current?.click()} onSignature={() => setSigning(true)} />
            <Thumbnails />
            <main
              ref={scrollRef}
              className="min-w-0 flex-1 overflow-auto no-scrollbar"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = [...e.dataTransfer.files][0]
                if (!file) return
                if (file.type === 'application/pdf') void store().openFile(file)
                else if (file.type.startsWith('image/')) void normaliseImage(file).then(i => place(i.src, i.w, i.h, 'image', i.mime))
              }}
            >
              <div className="flex flex-col items-center gap-8 px-8 py-10">
                {live.map((p, i) => <PageView key={p.index} info={p} zoom={zoom} order={i} />)}
              </div>
            </main>
            <Inspector />
          </div>
        </>
      ) : (
        <Welcome onOpen={file => void store().openFile(file)} />
      )}

      {loading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--workbench)]/70 backdrop-blur-[1px]">
          <span className="surface flex items-center gap-2.5 rounded-[var(--radius-md)] hairline px-4 py-3 text-sm shadow-lg">
            <Loader2 size={16} className="animate-spin text-brand-600" /> Opening the document
          </span>
        </div>
      ) : null}

      {signing ? (
        <SignatureDialog
          onClose={() => setSigning(false)}
          onInsert={sig => { place(sig.dataUrl, sig.width, sig.height, 'signature'); setSigning(false) }}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="surface fixed right-5 bottom-5 z-50 flex max-w-sm items-start gap-3 rounded-[var(--radius-md)] hairline px-4 py-3 shadow-xl"
        >
          {toast.kind === 'ok'
            ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand-600" />
            : toast.kind === 'ask'
              ? <History size={17} className="mt-0.5 shrink-0 text-brand-600" />
              : <AlertTriangle size={17} className="mt-0.5 shrink-0 text-flare-500" />}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{toast.title}</p>
            {toast.lines?.map(l => <p key={l} className="mt-1 text-[12px] leading-relaxed text-dim">{l}</p>)}
            {toast.action ? (
              <button
                onClick={toast.action.run}
                className="mt-2 h-7 rounded-[var(--radius-sm)] bg-brand-600 px-2.5 text-[12px] font-medium text-white hover:bg-brand-700"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
          <IconButton
            label="Dismiss"
            size="sm"
            className="-mt-1 -mr-2"
            onClick={() => { if (toast.kind === 'ask') store().dismissPending(); setToast(null) }}
          >
            <X size={14} />
          </IconButton>
        </div>
      ) : null}
    </div>
  )
}
