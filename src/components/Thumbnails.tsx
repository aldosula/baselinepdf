import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp, ChevronDown, RotateCw, Trash2 } from 'lucide-react'
import type { PageInfo } from '../lib/types'
import { useStore } from '../lib/store'
import { renderPage } from '../lib/pdf'

export function Thumbnails() {
  const pages = useStore(s => s.pages)
  const activePage = useStore(s => s.activePage)
  const store = useStore.getState
  const live = pages.filter(p => !p.deleted)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= pages.length || from === to) return
    store().movePage(from, to)
  }

  return (
    <aside className="surface-2 hidden w-[164px] shrink-0 flex-col overflow-y-auto border-r border-[var(--line)] p-3 no-scrollbar lg:flex">
      <h2 className="mb-2 px-0.5 text-[11px] font-bold tracking-[0.08em] text-dim uppercase">Pages</h2>
      <ol className="space-y-2">
        {live.map(page => {
          const realIndex = pages.indexOf(page)
          return (
            <li
              key={page.index}
              draggable
              onDragStart={() => setDragIndex(realIndex)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIndex !== null) move(dragIndex, realIndex); setDragIndex(null) }}
              className={clsx('group relative', dragIndex === realIndex && 'opacity-40')}
            >
              <button
                onClick={() => document.querySelector(`[data-page="${page.index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={clsx(
                  'block w-full overflow-hidden rounded-[var(--radius-sm)] border-2 bg-white transition-colors',
                  activePage === page.index ? 'border-brand-600' : 'border-transparent hover:border-ink-300',
                )}
              >
                <Thumb page={page} />
              </button>
              <span className="mt-1 block text-center text-[11px] text-dim">{live.indexOf(page) + 1}</span>

              <div className="absolute top-1 right-1 hidden flex-col gap-1 group-hover:flex group-focus-within:flex">
                <ThumbAction label="Move up" onClick={() => move(realIndex, realIndex - 1)}><ChevronUp size={13} /></ThumbAction>
                <ThumbAction label="Move down" onClick={() => move(realIndex, realIndex + 1)}><ChevronDown size={13} /></ThumbAction>
                <ThumbAction label="Rotate page" onClick={() => store().rotatePage(page.index, 90)}><RotateCw size={13} /></ThumbAction>
                {live.length > 1 ? (
                  <ThumbAction label="Delete page" danger onClick={() => store().deletePage(page.index)}><Trash2 size={13} /></ThumbAction>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

const ThumbAction = ({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
  <button
    aria-label={label}
    title={label}
    onClick={onClick}
    className={clsx(
      'flex h-6 w-6 items-center justify-center rounded-[4px] bg-[var(--surface)]/95 hairline shadow-sm transition-colors',
      danger ? 'text-red-600 hover:bg-red-500/10' : 'hover:bg-ink-100 dark:hover:bg-white/10',
    )}
  >
    {children}
  </button>
)

function Thumb({ page }: { page: PageInfo }) {
  const proxy = useStore(s => s.proxy)
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const width = 132

  // a long document should not render 200 thumbnails before showing page one
  useEffect(() => {
    const el = host.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setVisible(true) },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!proxy || !visible) return
    const signal = { cancelled: false }
    void (async () => {
      const p = await proxy.getPage(page.index)
      const result = await renderPage(p, width / page.width, page.userRotation, signal)
      if (!result || signal.cancelled || !host.current) return
      result.canvas.style.width = '100%'
      result.canvas.style.height = 'auto'
      result.canvas.style.display = 'block'
      host.current.replaceChildren(result.canvas)
    })()
    return () => { signal.cancelled = true }
  }, [proxy, page.index, page.width, page.userRotation, visible])

  const ratio = page.userRotation % 180 ? page.width / page.height : page.height / page.width
  return <div ref={host} style={{ width: '100%', aspectRatio: `1 / ${ratio}` }} className="bg-white" />
}
