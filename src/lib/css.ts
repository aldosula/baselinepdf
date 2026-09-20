import type { FontKey } from './types'

/** Ascender / descender of the 14 standard PDF fonts, per 1000 units.
 *  These are the exact numbers pdf-lib lays text out with, so the editor can
 *  put a caret where the glyphs will actually land in the saved file. */
export const METRICS: Record<FontKey, { asc: number; desc: number }> = {
  'Helvetica': { asc: 0.718, desc: 0.207 },
  'Helvetica-Bold': { asc: 0.718, desc: 0.207 },
  'Helvetica-Oblique': { asc: 0.718, desc: 0.207 },
  'Helvetica-BoldOblique': { asc: 0.718, desc: 0.207 },
  'Times-Roman': { asc: 0.683, desc: 0.217 },
  'Times-Bold': { asc: 0.676, desc: 0.205 },
  'Times-Italic': { asc: 0.683, desc: 0.205 },
  'Times-BoldItalic': { asc: 0.669, desc: 0.205 },
  'Courier': { asc: 0.629, desc: 0.157 },
  'Courier-Bold': { asc: 0.629, desc: 0.157 },
  'Courier-Oblique': { asc: 0.629, desc: 0.157 },
  'Courier-BoldOblique': { asc: 0.629, desc: 0.157 },
}

export const FONT_LABELS: Record<FontKey, string> = {
  'Helvetica': 'Helvetica', 'Helvetica-Bold': 'Helvetica Bold',
  'Helvetica-Oblique': 'Helvetica Italic', 'Helvetica-BoldOblique': 'Helvetica Bold Italic',
  'Times-Roman': 'Times', 'Times-Bold': 'Times Bold',
  'Times-Italic': 'Times Italic', 'Times-BoldItalic': 'Times Bold Italic',
  'Courier': 'Courier', 'Courier-Bold': 'Courier Bold',
  'Courier-Oblique': 'Courier Italic', 'Courier-BoldOblique': 'Courier Bold Italic',
}

export type FontSource = { fontId: string; fontName: string; ascentEm: number }

export function cssFont(font: FontKey, sizePx: number, source?: FontSource) {
  const fallback = font.startsWith('Times')
    ? '"Times New Roman", Times, serif'
    : font.startsWith('Courier')
      ? '"Courier New", Courier, monospace'
      : '"Helvetica Neue", Helvetica, Arial, sans-serif'
  // pdf.js installs the document's own fonts under their loaded name, so the
  // preview can use the real face rather than a lookalike
  const family = source?.fontId ? `"${source.fontId}", ${fallback}` : fallback
  const weight = /Bold/.test(font) ? 700 : 400
  const style = /Italic|Oblique/.test(font) ? 'italic' : 'normal'
  return { fontFamily: family, fontWeight: weight, fontStyle: style, fontSize: `${sizePx}px` } as const
}

const boxCache = new Map<string, { asc: number; desc: number }>()

/** Real ascent of the font the screen will actually use, so the preview
 *  baseline can be matched to the PDF baseline instead of drifting. */
export function screenFontBox(font: FontKey, source?: FontSource) {
  const key = source?.fontId ? `src:${source.fontId}` : font
  const cached = boxCache.get(key)
  if (cached) return cached
  const fallback = { asc: 0.9, desc: 0.22 }
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return fallback
    const f = cssFont(font, 100, source)
    ctx.font = `${f.fontStyle} ${f.fontWeight} 100px ${f.fontFamily}`
    const m = ctx.measureText('Hxy')
    const box = {
      asc: (m.fontBoundingBoxAscent || 90) / 100,
      desc: (m.fontBoundingBoxDescent || 22) / 100,
    }
    boxCache.set(key, box)
    return box
  } catch {
    return fallback
  }
}

/** Distance from the top of a text box to the first baseline, in points. The
 *  document's own ascent wins when the document's own font is being used. */
export const baselineOffset = (font: FontKey, size: number, source?: FontSource) =>
  (source ? source.ascentEm : METRICS[font].asc) * size

/** CSS top offset that makes the browser put its first baseline exactly where
 *  the PDF will put it. */
export function previewTopShift(font: FontKey, size: number, lineHeight: number, source?: FontSource) {
  const screen = screenFontBox(font, source)
  const cssBaseline = (lineHeight - (screen.asc + screen.desc) * size) / 2 + screen.asc * size
  return baselineOffset(font, size, source) - cssBaseline
}

/** The document's own font, unless the user has chosen a standard one instead. */
export const activeSource = (obj: { source?: FontSource; sourceOff?: boolean }) =>
  obj.sourceOff ? undefined : obj.source

const ruler = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')

/** Width of `text` as the screen will draw it, in points. */
export function measureText(text: string, font: FontKey, size: number, source?: FontSource) {
  if (!ruler || !text) return 0
  const f = cssFont(font, size, source)
  ruler.font = `${f.fontStyle} ${f.fontWeight} ${size}px ${f.fontFamily}`
  return ruler.measureText(text).width
}

type SpacedText = {
  text: string
  font: FontKey
  size: number
  source?: FontSource
  sourceOff?: boolean
  advance?: number
  hScale?: number
  sourceText?: string
  origin: 'new' | 'replace'
}

/** The same stretch the exporter will apply, expressed as CSS, so what you see
 *  while typing is what the saved file will show. Kept in one place on purpose:
 *  the two must agree or the editor lies. */
export function previewSpacing(obj: SpacedText, zoom: number): React.CSSProperties {
  if (obj.origin !== 'replace' || !obj.advance) return {}
  const first = obj.text.split('\n')[0]
  if (!first) return {}
  const natural = measureText(first, obj.font, obj.size, activeSource(obj)) * (obj.hScale ?? 1)
  if (!natural) return {}
  const delta = obj.advance - natural
  if (Math.abs(delta) < 0.05) return {}

  const spaces = (first.match(/ /g) ?? []).length
  if (spaces > 0) {
    const per = delta / spaces
    // the same ceiling the exporter uses, so the two agree
    const originalSpaces = (obj.sourceText?.match(/ /g) ?? []).length
    const originalNatural = obj.sourceText
      ? measureText(obj.sourceText, obj.font, obj.size, activeSource(obj)) * (obj.hScale ?? 1)
      : 0
    const already = originalSpaces > 0 && originalNatural > 0
      ? ((obj.advance - originalNatural) / originalSpaces) * 1.35
      : 0
    const allowance = Math.max(obj.size * 1.4, already)
    if (per < -obj.size * 0.22 || per > allowance) return {}
    return { wordSpacing: `${per * zoom}px` }
  }
  const gaps = [...first].length - 1
  if (gaps < 1) return {}
  const per = delta / gaps
  if (per < -obj.size * 0.08 || per > obj.size * 0.4) return {}
  return { letterSpacing: `${per * zoom}px` }
}

/** Horizontal glyph scaling, as CSS. */
export const previewScale = (hScale?: number): React.CSSProperties =>
  hScale && Math.abs(hScale - 1) > 0.01
    ? { transform: `scaleX(${hScale})`, transformOrigin: 'left top' }
    : {}
