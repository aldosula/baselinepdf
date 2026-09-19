import { memo } from 'react'
import type { AnyObj } from '../lib/types'
import { cssFont, previewTopShift } from '../lib/css'

const px = (v: number) => `${v}px`

/** One editable object, painted to match what the exporter will write. */
export const ObjectView = memo(function ObjectView({
  obj, zoom, muted, draft,
}: { obj: AnyObj; zoom: number; muted?: boolean; draft?: boolean }) {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: px(obj.rect.x * zoom),
    top: px(obj.rect.y * zoom),
    width: px(obj.rect.w * zoom),
    height: px(obj.rect.h * zoom),
    transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
    transformOrigin: 'center center',
    opacity: obj.opacity,
    pointerEvents: 'none',
  }

  switch (obj.kind) {
    case 'whiteout':
      return (
        <div
          style={{
            ...base,
            background: obj.color,
            // paper on paper is invisible, so a draft shows its own edge
            outline: draft ? '1px dashed var(--color-brand-600)' : undefined,
            outlineOffset: '-1px',
          }}
        />
      )

    case 'image':
      return (
        <img
          src={obj.src}
          alt={obj.role === 'signature' ? 'Signature' : 'Inserted image'}
          draggable={false}
          style={{ ...base, objectFit: 'fill', userSelect: 'none' }}
        />
      )

    case 'highlight':
      return (
        <div style={{ ...base, left: 0, top: 0, width: '100%', height: '100%', transform: undefined }}>
          {obj.rects.map((r, i) =>
            obj.style === 'highlight' ? (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: px(r.x * zoom), top: px(r.y * zoom),
                  width: px(r.w * zoom), height: px(r.h * zoom),
                  background: obj.color,
                  mixBlendMode: 'multiply',
                  borderRadius: px(1.5 * zoom),
                }}
              />
            ) : (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: px(r.x * zoom),
                  top: px((r.y + r.h * (obj.style === 'underline' ? 0.94 : 0.58)) * zoom),
                  width: px(r.w * zoom),
                  height: px(Math.max(1, r.h * 0.07 * zoom)),
                  background: obj.color,
                }}
              />
            ),
          )}
        </div>
      )

    case 'draw':
      return (
        <svg
          style={{ ...base, overflow: 'visible', mixBlendMode: obj.mode === 'marker' ? 'multiply' : undefined }}
          viewBox={`${obj.rect.x} ${obj.rect.y} ${obj.rect.w} ${obj.rect.h}`}
          preserveAspectRatio="none"
        >
          {obj.strokes.map((s, i) => (
            <polyline
              key={i}
              points={s.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={obj.color}
              strokeWidth={obj.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={obj.mode === 'marker' ? 0.45 : 1}
            />
          ))}
        </svg>
      )

    case 'shape': {
      const { rect } = obj
      const common = { stroke: obj.color, strokeWidth: obj.width, fill: obj.fill ?? 'none', strokeLinecap: 'round' as const }
      const head = Math.max(6, obj.width * 4)
      const ang = Math.atan2(rect.h, rect.w)
      return (
        <svg style={{ ...base, overflow: 'visible' }} viewBox={`0 0 ${rect.w} ${rect.h}`} preserveAspectRatio="none">
          {obj.shape === 'rect' && <rect x={obj.width / 2} y={obj.width / 2} width={Math.max(0, rect.w - obj.width)} height={Math.max(0, rect.h - obj.width)} {...common} />}
          {obj.shape === 'ellipse' && <ellipse cx={rect.w / 2} cy={rect.h / 2} rx={Math.max(0, rect.w / 2 - obj.width / 2)} ry={Math.max(0, rect.h / 2 - obj.width / 2)} {...common} />}
          {(obj.shape === 'line' || obj.shape === 'arrow') && <line x1={0} y1={0} x2={rect.w} y2={rect.h} {...common} fill="none" />}
          {obj.shape === 'arrow' && [0.82, -0.82].map((s, i) => (
            <line
              key={i}
              x1={rect.w} y1={rect.h}
              x2={rect.w + Math.cos(ang + s * Math.PI) * head}
              y2={rect.h + Math.sin(ang + s * Math.PI) * head}
              {...common}
              fill="none"
            />
          ))}
        </svg>
      )
    }

    case 'text': {
      const size = obj.size * zoom
      const lineHeight = obj.lineGap * size
      const shift = previewTopShift(obj.font, obj.size, obj.lineGap * obj.size) * zoom
      return (
        <div style={{ ...base, overflow: 'visible' }}>
          {obj.mask ? (
            <div
              style={{
                position: 'absolute',
                left: px((obj.mask.x - obj.rect.x) * zoom),
                top: px((obj.mask.y - obj.rect.y) * zoom),
                width: px(obj.mask.w * zoom),
                height: px(obj.mask.h * zoom),
                background: obj.maskColor ?? '#ffffff',
              }}
            />
          ) : null}
          {muted ? null : <div
            style={{
              ...cssFont(obj.font, size),
              position: 'relative',
              top: px(shift),
              lineHeight: px(lineHeight),
              color: obj.color,
              textAlign: obj.align,
              whiteSpace: 'pre',
            }}
          >
            {obj.text || ' '}
          </div>}
        </div>
      )
    }
  }
})
