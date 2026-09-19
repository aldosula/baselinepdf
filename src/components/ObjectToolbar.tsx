import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine, ArrowUpToLine, Copy, Highlighter, Minus, Plus,
  RotateCcw, RotateCw, Strikethrough, Trash2, Underline, Eraser,
} from 'lucide-react'
import type { AnyObj, Rect } from '../lib/types'
import { centre } from '../lib/geometry'
import { rotatedBounds } from '../lib/bounds'
import { useStore } from '../lib/store'
import { retypePatch } from '../lib/textops'

const Btn = ({
  label, onClick, children, active, danger,
}: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; danger?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onPointerDown={e => e.stopPropagation()}
    onClick={onClick}
    className={clsx(
      'flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors',
      danger ? 'text-red-600 hover:bg-red-500/12' : active ? 'bg-brand-600 text-white' : 'hover:bg-ink-100 dark:hover:bg-white/12',
    )}
  >
    {children}
  </button>
)

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--line)]" />

const Swatch = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label
    title="Colour"
    onPointerDown={e => e.stopPropagation()}
    className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-[5px] hover:bg-ink-100 dark:hover:bg-white/12"
  >
    <span className="h-4 w-4 rounded-full hairline" style={{ background: value }} />
    <input
      type="color"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="absolute inset-0 cursor-pointer opacity-0"
      aria-label="Colour"
    />
  </label>
)

/** The handful of actions worth having under your thumb, floating just above
 *  the selection instead of only in the right-hand panel. */
export function ObjectToolbar({
  obj, zoom, pageRotation, pageWidth,
}: { obj: AnyObj; zoom: number; pageRotation: number; pageWidth: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => { setWidth(ref.current?.offsetWidth ?? 0) })

  const store = useStore.getState
  const patch = (p: Partial<AnyObj>) => store().mutate(d => {
    const target = d.objects.find(o => o.id === obj.id)
    if (target) Object.assign(target, p)
  })

  const bounds: Rect = rotatedBounds(obj.rect, centre(obj.rect), obj.rotation)
  const above = bounds.y * zoom > 46
  const top = above ? bounds.y * zoom - 42 : (bounds.y + bounds.h) * zoom + 10
  // keep the bar on the page rather than hanging off the paper
  const half = width / 2
  const wanted = (bounds.x + bounds.w / 2) * zoom
  const left = width && width < pageWidth
    ? Math.min(Math.max(wanted, half + 6), pageWidth - half - 6)
    : wanted

  return (
    <div
      ref={ref}
      data-ui
      className="surface absolute z-10 flex items-center gap-0.5 rounded-[var(--radius-md)] hairline px-1 py-1 shadow-lg"
      style={{
        left,
        top,
        transform: `translateX(-50%) rotate(${-pageRotation}deg)`,
        transformOrigin: 'center center',
        whiteSpace: 'nowrap',
      }}
    >
      {obj.kind === 'text' ? (
        <>
          <Btn label="Smaller" onClick={() => patch(retypePatch(obj, { size: Math.round((obj.size - 0.5) * 10) / 10 }) as Partial<AnyObj>)}>
            <Minus size={14} />
          </Btn>
          <span className="w-9 text-center font-mono text-[11px] text-dim tabular-nums">{obj.size}</span>
          <Btn label="Bigger" onClick={() => patch(retypePatch(obj, { size: Math.round((obj.size + 0.5) * 10) / 10 }) as Partial<AnyObj>)}>
            <Plus size={14} />
          </Btn>
          <Swatch value={obj.color} onChange={v => patch({ color: v } as Partial<AnyObj>)} />
          <Btn
            label={obj.origin === 'replace' ? 'Clear the text, keep the cover' : 'Clear the text'}
            onClick={() => { patch({ text: '' } as Partial<AnyObj>); store().setEditingText(obj.id) }}
          >
            <Eraser size={14} />
          </Btn>
          <Divider />
        </>
      ) : null}

      {obj.kind === 'highlight' ? (
        <>
          {([['highlight', <Highlighter key="h" size={14} />], ['underline', <Underline key="u" size={14} />], ['strike', <Strikethrough key="s" size={14} />]] as const).map(([style, icon]) => (
            <Btn
              key={style}
              label={style === 'highlight' ? 'Highlight' : style === 'underline' ? 'Underline' : 'Strike through'}
              active={obj.style === style}
              onClick={() => patch({ style, opacity: style === 'highlight' ? 0.55 : 1 } as Partial<AnyObj>)}
            >
              {icon}
            </Btn>
          ))}
          <Swatch value={obj.color} onChange={v => patch({ color: v } as Partial<AnyObj>)} />
          <Divider />
        </>
      ) : null}

      {obj.kind === 'draw' || obj.kind === 'shape' ? (
        <>
          <Btn label="Thinner" onClick={() => patch({ width: Math.max(0.5, obj.width - 0.5) } as Partial<AnyObj>)}><Minus size={14} /></Btn>
          <span className="w-9 text-center font-mono text-[11px] text-dim tabular-nums">{obj.width}</span>
          <Btn label="Thicker" onClick={() => patch({ width: Math.min(40, obj.width + 0.5) } as Partial<AnyObj>)}><Plus size={14} /></Btn>
          <Swatch value={obj.color} onChange={v => patch({ color: v } as Partial<AnyObj>)} />
          <Divider />
        </>
      ) : null}

      {obj.kind === 'whiteout' ? (
        <>
          <Swatch value={obj.color} onChange={v => patch({ color: v } as Partial<AnyObj>)} />
          <Divider />
        </>
      ) : null}

      {obj.kind === 'image' || obj.kind === 'text' ? (
        <>
          <Btn label="Rotate left" onClick={() => patch({ rotation: Math.round(obj.rotation) - 90 })}><RotateCcw size={14} /></Btn>
          <Btn label="Rotate right" onClick={() => patch({ rotation: Math.round(obj.rotation) + 90 })}><RotateCw size={14} /></Btn>
          {obj.kind === 'text' ? null : <Divider />}
        </>
      ) : null}

      {obj.kind === 'text' ? <Divider /> : null}

      <Btn label="Bring to front" onClick={() => store().bring(obj.id, 'front')}><ArrowUpToLine size={14} /></Btn>
      <Btn label="Send to back" onClick={() => store().bring(obj.id, 'back')}><ArrowDownToLine size={14} /></Btn>
      <Btn label="Duplicate" onClick={() => store().duplicate([obj.id])}><Copy size={14} /></Btn>
      <Btn label="Delete" danger onClick={() => store().remove([obj.id])}><Trash2 size={14} /></Btn>
    </div>
  )
}
