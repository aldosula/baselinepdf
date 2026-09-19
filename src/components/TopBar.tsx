import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, History, Loader2, Maximize2, Minus, Moon, Plus, Redo2, Sun, Undo2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { whenText } from '../lib/recents'
import { Button, IconButton } from './ui'

export function TopBar({ onSave, saving, onOpen }: { onSave: () => void; saving: boolean; onOpen: () => void }) {
  const { fileName, pages, activePage, zoom, theme, past, future } = useStore()
  const setZoom = useStore(s => s.setZoom)
  const setTheme = useStore(s => s.setTheme)
  const undo = useStore(s => s.undo)
  const redo = useStore(s => s.redo)
  const live = pages.filter(p => !p.deleted)
  const position = Math.max(1, live.findIndex(p => p.index === activePage) + 1)

  const goto = (delta: number) => {
    const next = live[Math.min(live.length - 1, Math.max(0, position - 1 + delta))]
    if (next) document.querySelector(`[data-page="${next.index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <header className="surface z-20 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3">
      <div className="flex min-w-0 items-center gap-2.5 pr-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand-600 text-white">
          <FileText size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-tight font-semibold">{fileName || 'PDF Studio'}</p>
          <p className="text-[11px] leading-tight text-dim">{live.length} page{live.length === 1 ? '' : 's'} · edits stay on this machine</p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-[var(--line)]" />

      <IconButton label="Undo (Cmd Z)" size="sm" disabled={!past.length} onClick={undo}><Undo2 size={16} /></IconButton>
      <IconButton label="Redo (Shift Cmd Z)" size="sm" disabled={!future.length} onClick={redo}><Redo2 size={16} /></IconButton>

      <div className="mx-1 h-6 w-px bg-[var(--line)]" />

      <IconButton label="Previous page" size="sm" className="hidden md:inline-flex" onClick={() => goto(-1)}><ChevronLeft size={16} /></IconButton>
      <span className="hidden min-w-[68px] text-center md:inline font-mono text-[12px] text-dim tabular-nums">{position} / {live.length}</span>
      <IconButton label="Next page" size="sm" className="hidden md:inline-flex" onClick={() => goto(1)}><ChevronRight size={16} /></IconButton>

      <div className="mx-1 h-6 w-px bg-[var(--line)]" />

      <IconButton label="Zoom out" size="sm" onClick={() => setZoom(zoom / 1.25)}><Minus size={16} /></IconButton>
      <button
        onClick={() => setZoom(1)}
        className="min-w-[52px] rounded-[var(--radius-xs)] px-1 py-1 font-mono text-[12px] text-dim tabular-nums hover:bg-ink-100 dark:hover:bg-white/10"
        title="Reset to 100 %"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in" size="sm" onClick={() => setZoom(zoom * 1.25)}><Plus size={16} /></IconButton>
      <IconButton label="Fit to width" size="sm" onClick={() => setZoom(zoom, 'width')}><Maximize2 size={16} /></IconButton>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <IconButton
          label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          size="sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <RecentMenu />
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={onOpen}>Open another</Button>
        <Button variant="flare" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {saving ? 'Writing' : 'Save PDF'}
        </Button>
      </div>
    </header>
  )
}

/** The last few documents, one click away without leaving the one you are in. */
function RecentMenu() {
  const recents = useStore(s => s.recents)
  const docId = useStore(s => s.docId)
  const store = useStore.getState
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  if (!recents.length) return null

  return (
    <div ref={box} className="relative">
      <IconButton label="Recent documents" size="sm" active={open} onClick={() => { void store().refreshRecents(); setOpen(o => !o) }}>
        <History size={16} />
      </IconButton>
      {open ? (
        <div className="surface absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-[var(--radius-md)] hairline py-1 shadow-xl">
          <p className="px-3 py-1.5 text-[11px] font-bold tracking-[0.08em] text-dim uppercase">Recent</p>
          {recents.map(doc => (
            <button
              key={doc.id}
              disabled={doc.id === docId || doc.bytesDropped}
              onClick={() => { void store().openRecent(doc.id); setOpen(false) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink-100 disabled:opacity-45 dark:hover:bg-white/10"
            >
              {doc.thumb
                ? <img src={doc.thumb} alt="" className="h-9 w-7 shrink-0 rounded-[3px] object-cover object-top hairline" />
                : <FileText size={16} className="shrink-0 text-dim" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{doc.name}</span>
                <span className="block text-[11px] text-dim">
                  {doc.id === docId ? 'open now' : `${doc.edits} edit${doc.edits === 1 ? '' : 's'} · ${whenText(doc.updatedAt)}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
