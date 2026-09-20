import { useEffect, useLayoutEffect, useRef } from 'react'
import type { TextObj } from '../lib/types'
import { useStore } from '../lib/store'
import { activeSource, cssFont, previewSpacing, previewTopShift } from '../lib/css'

const measurer = document.createElement('canvas').getContext('2d')

/** Inline editing of a text box, typed straight onto the page with the
 *  metrics the exporter will use. */
export function TextEditor({ obj, zoom }: { obj: TextObj; zoom: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const dirty = useRef(false)
  const store = useStore.getState

  useEffect(() => {
    store().begin()
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    return () => { if (dirty.current) store().commit() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id])

  const fit = (text: string) => {
    const lines = text.split('\n')
    let width = obj.rect.w
    if (measurer) {
      const f = cssFont(obj.font, obj.size, obj.source)
      measurer.font = `${f.fontStyle} ${f.fontWeight} ${obj.size}px ${f.fontFamily}`
      const longest = Math.max(...lines.map(l => measurer.measureText(l || ' ').width))
      width = Math.max(obj.rect.w, longest + obj.size * 0.6)
    }
    return { w: width, h: Math.max(obj.rect.h, lines.length * obj.size * obj.lineGap) }
  }

  useLayoutEffect(() => {
    const size = fit(obj.text)
    if (size.w !== obj.rect.w || size.h !== obj.rect.h) {
      store().update(obj.id, { rect: { ...obj.rect, ...size } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.text, obj.size, obj.font, obj.lineGap])

  const size = obj.size * zoom
  const lineHeight = obj.lineGap * size

  return (
    <textarea
      ref={ref}
      data-editor
      value={obj.text}
      spellCheck={false}
      onChange={e => {
        dirty.current = true
        store().update(obj.id, { text: e.target.value })
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          store().setEditingText(null)
        }
      }}
      onBlur={() => store().setEditingText(null)}
      style={{
        position: 'absolute',
        left: obj.rect.x * zoom,
        top: obj.rect.y * zoom + previewTopShift(obj.font, obj.size, obj.lineGap * obj.size, activeSource(obj)) * zoom,
        width: obj.rect.w * zoom,
        height: obj.rect.h * zoom,
        // rotation and glyph scaling have to share the one transform
        transform: [
          obj.rotation ? `rotate(${obj.rotation}deg)` : '',
          obj.hScale && Math.abs(obj.hScale - 1) > 0.01 ? `scaleX(${obj.hScale})` : '',
        ].filter(Boolean).join(' ') || undefined,
        transformOrigin: obj.hScale && Math.abs(obj.hScale - 1) > 0.01 ? 'left center' : 'center center',
        ...cssFont(obj.font, size, activeSource(obj)),
        ...previewSpacing(obj, zoom),
        lineHeight: `${lineHeight}px`,
        color: obj.color,
        textAlign: obj.align,
        // the selection frame is the only box drawn: an outline or a tint here
        // would sit a baseline correction away from it and read as a second box
        background: 'transparent',
        caretColor: 'var(--color-brand-600)',
        border: 0,
        outline: 'none',
        padding: 0,
        margin: 0,
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre',
        zIndex: 5,
      }}
    />
  )
}
