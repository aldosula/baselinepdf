import { useEffect, useState } from 'react'
import { FileText, Highlighter, Image as ImageIcon, PenTool, ShieldCheck, Type, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { whenText } from '../lib/recents'

const FEATURES = [
  { icon: <Type size={16} />, title: 'Rewrite existing text', body: 'Click any line. It is patched with the paper colour and retyped on the same baseline.' },
  { icon: <PenTool size={16} />, title: 'Sign it properly', body: 'Draw, type or photograph a signature. The paper behind it is removed, not faked with white.' },
  { icon: <ImageIcon size={16} />, title: 'Images and stamps', body: 'Drop in a logo or a scan, move it, scale it, rotate it, delete it.' },
  { icon: <Highlighter size={16} />, title: 'Markup that snaps', body: 'Highlight, underline and strike follow the text lines underneath.' },
]

export function Welcome({ onOpen }: { onOpen: (file: File) => void }) {
  const recents = useStore(s => s.recents)
  const error = useStore(s => s.error)
  const store = useStore.getState
  const [over, setOver] = useState(false)

  useEffect(() => { void store().refreshRecents() }, [store])

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-brand-600 text-white">
            <FileText size={22} />
          </span>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.01em]">Edit a PDF without sending it anywhere</h1>
          <p className="mt-2 text-[14px] text-dim">
            Everything runs in this window: no upload, no account, no server. Your file never leaves the machine.
          </p>
        </div>

        <label
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => {
            e.preventDefault()
            setOver(false)
            const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
            if (file) onOpen(file)
          }}
          className={[
            'surface flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-12 text-center transition-colors',
            over ? 'border-brand-600 bg-brand-50 dark:bg-brand-500/10' : 'border-[var(--line)] hover:border-brand-500',
          ].join(' ')}
        >
          <p className="text-[15px] font-semibold">Drop a PDF here, or choose one</p>
          <p className="text-[12px] text-dim">Large scans are fine. Pages render as you reach them.</p>
          <span className="mt-1 inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-brand-600 px-4 text-sm font-medium text-white">
            Choose a PDF
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onOpen(f) }}
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-red-500/10 px-3 py-2 text-center text-[13px] text-red-600">{error}</p>
        ) : null}

        {recents.length ? (
          <section className="mt-6">
            <h2 className="mb-2.5 px-0.5 text-[11px] font-bold tracking-[0.08em] text-dim uppercase">
              Carry on with
            </h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {recents.map(doc => (
                <li key={doc.id} className="group relative">
                  <button
                    onClick={() => void store().openRecent(doc.id)}
                    disabled={doc.bytesDropped}
                    className="surface flex w-full flex-col overflow-hidden rounded-[var(--radius-md)] hairline text-left transition-colors hover:border-brand-500 disabled:opacity-50"
                  >
                    <span className="flex h-[104px] items-center justify-center overflow-hidden bg-[var(--surface-2)]">
                      {doc.thumb
                        ? <img src={doc.thumb} alt="" className="h-full w-full object-cover object-top" />
                        : <FileText size={20} className="text-dim" />}
                    </span>
                    <span className="flex flex-col gap-0.5 px-3 py-2.5">
                      <span className="truncate text-[13px] font-semibold">{doc.name}</span>
                      <span className="text-[11px] text-dim">
                        {doc.bytesDropped
                          ? 'too large to keep here'
                          : `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · ${doc.edits} edit${doc.edits === 1 ? '' : 's'} · ${whenText(doc.updatedAt)}`}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => void store().forget(doc.id)}
                    aria-label={`Forget ${doc.name}`}
                    title="Forget this document"
                    className="absolute top-1.5 right-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)]/95 hairline text-dim shadow-sm group-hover:flex hover:text-red-600"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-0.5 text-[11px] text-dim">
              The last {recents.length === 1 ? 'document' : `${recents.length} documents`} you edited, kept in this
              browser with your edits. Nothing was uploaded.
            </p>
          </section>
        ) : null}

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(f => (
            <li key={f.title} className="surface rounded-[var(--radius-md)] hairline p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-brand-600">{f.icon}</span>
                <h2 className="text-[13px] font-semibold">{f.title}</h2>
              </div>
              <p className="text-[12px] leading-relaxed text-dim">{f.body}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 flex items-center justify-center gap-2 text-[12px] text-dim">
          <ShieldCheck size={14} className="text-brand-600" />
          Your work is kept in this browser only, so you can close the tab and come back to it.
        </p>
      </div>
    </div>
  )
}
