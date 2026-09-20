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
