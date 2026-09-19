import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { FontKey, PageInfo, Rect, TextLine, TextRun } from './types'
import { uid } from './id'
import { unionRects } from './geometry'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type LoadedDoc = {
  proxy: PDFDocumentProxy
  pages: PageInfo[]
  /** original bytes, kept pristine for export */
  bytes: Uint8Array
  name: string
}

export async function loadPdf(file: File | Uint8Array, name = 'document.pdf'): Promise<LoadedDoc> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const fileName = file instanceof Uint8Array ? name : file.name
  // pdf.js transfers (and detaches) the buffer it is given, so it gets a copy
  const proxy = await pdfjs.getDocument({ data: bytes.slice(), enableXfa: true }).promise
  const pages: PageInfo[] = []
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    pages.push({
      index: i,
      width: vp.width,
      height: vp.height,
      rotation: page.rotate % 360,
      transform: Array.from(vp.transform),
      userRotation: 0,
    })
  }
  return { proxy, pages, bytes, name: fileName }
}

export type RenderResult = { canvas: HTMLCanvasElement; scale: number }

/** Renders a page into an offscreen canvas at `scale` CSS units per page unit. */
export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  extraRotation = 0,
  signal?: { cancelled: boolean },
): Promise<RenderResult | null> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + extraRotation) % 360 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const task = page.render({ canvas, canvasContext: ctx, viewport })
  try {
    await task.promise
  } catch {
    return null
  }
  if (signal?.cancelled) return null
  return { canvas, scale: scale * dpr }
}

const FONT_TABLE: Record<string, FontKey> = {
  'serif|0|0': 'Times-Roman', 'serif|1|0': 'Times-Bold', 'serif|0|1': 'Times-Italic', 'serif|1|1': 'Times-BoldItalic',
  'mono|0|0': 'Courier', 'mono|1|0': 'Courier-Bold', 'mono|0|1': 'Courier-Oblique', 'mono|1|1': 'Courier-BoldOblique',
  'sans|0|0': 'Helvetica', 'sans|1|0': 'Helvetica-Bold', 'sans|0|1': 'Helvetica-Oblique', 'sans|1|1': 'Helvetica-BoldOblique',
}

export const pickFont = (opts: { serif: boolean; mono: boolean; bold: boolean; italic: boolean }): FontKey =>
  FONT_TABLE[`${opts.mono ? 'mono' : opts.serif ? 'serif' : 'sans'}|${opts.bold ? 1 : 0}|${opts.italic ? 1 : 0}`]

export const fontTraits = (f: FontKey) => ({
  bold: /Bold/.test(f),
  italic: /Italic|Oblique/.test(f),
  serif: f.startsWith('Times'),
  mono: f.startsWith('Courier'),
})

/** Extracts every text run of a page, already converted to page space. */
export async function extractRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const styles = content.styles as Record<string, { fontFamily?: string; ascent?: number; descent?: number }>
  const runs: TextRun[] = []

  for (const raw of content.items) {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number; fontName?: string }
    if (!item.str || !item.transform || !item.str.trim()) continue
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const fontSize = Math.hypot(tx[2], tx[3]) || item.height || 10
    const angle = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI
    const style = (item.fontName && styles[item.fontName]) || {}
    const ascent = typeof style.ascent === 'number' && style.ascent > 0 ? style.ascent : 0.78
    const descent = typeof style.descent === 'number' ? Math.abs(style.descent) : 0.22

    let name = String(style.fontFamily ?? '')
    try {
      const obj = item.fontName ? (page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null) : null
      if (obj && typeof obj === 'object' && 'name' in obj) name = `${(obj as { name?: string }).name ?? ''} ${name}`
    } catch { /* font not resolved yet: the family name alone is enough */ }

    runs.push({
      id: uid('run'),
      page: page.pageNumber,
      str: item.str,
      x: tx[4],
      y: tx[5],
      width: item.width ?? 0,
      height: fontSize * (ascent + descent),
      fontSize,
      ascent: fontSize * ascent,
      angle,
      fontFamily: name,
      bold: /bold|black|heavy|semibold|600|700|800|900/i.test(name),
      italic: /italic|oblique/i.test(name),
      serif: /times|serif|georgia|garamond|book|roman|minion|cambria/i.test(name) && !/sans/i.test(name),
      mono: /mono|courier|consol/i.test(name),
    })
  }
  return runs
}

const runRect = (r: TextRun): Rect => ({ x: r.x, y: r.y - r.ascent, w: r.width, h: r.height })

/** Distance from the end of `prev` to the start of `run`, measured along the
 *  direction the text advances in, so slanted rows work like flat ones. */
function advanceGap(prev: TextRun, run: TextRun): number {
  const rad = (prev.angle * Math.PI) / 180
  const dx = Math.cos(rad), dy = Math.sin(rad)
  const endX = prev.x + prev.width * dx
  const endY = prev.y + prev.width * dy
  return (run.x - endX) * dx + (run.y - endY) * dy
}

/** Column starts of the page: an x that several different rows begin a run at
 *  is a column edge, not a coincidence. Used to catch narrow table gutters
 *  that the width test alone would read as a word space. */
function detectColumns(rows: TextRun[][]): number[] {
  const tally = new Map<number, Set<number>>()
  rows.forEach((row, i) => {
    if (Math.abs(row[0]?.angle ?? 0) > 0.5) return
    for (const run of row) {
      const key = Math.round(run.x)
      for (const k of [key - 1, key, key + 1]) {
        if (!tally.has(k)) tally.set(k, new Set())
        tally.get(k)!.add(i)
      }
    }
  })
  return [...tally.entries()].filter(([, seen]) => seen.size >= 3).map(([x]) => x).sort((a, b) => a - b)
}

/** Splits one row at its column gutters. */
function splitCells(ordered: TextRun[], columns: number[]): TextRun[][] {
  const cells: TextRun[][] = []
  let current: TextRun[] = []
  for (const run of ordered) {
    const prev = current[current.length - 1]
    if (prev) {
      const gap = advanceGap(prev, run)
      const em = Math.max(prev.fontSize, run.fontSize, 1)
      // a word space is about a quarter of an em, and justification stretches
      // it; a gutter is far wider than anything justification produces
      const onColumn = columns.some(c => Math.abs(run.x - c) <= 1.2)
      if (gap > em * 1.1 || (onColumn && gap > em * 0.5)) {
        cells.push(current)
        current = []
      }
    }
    current.push(run)
  }
  if (current.length) cells.push(current)
  return cells
}

/** The run that carries most of the characters decides the font and the size,
 *  so a stray superscript cannot change how the replacement is typed. */
function dominant(runs: TextRun[]): TextRun {
  return runs.reduce((best, r) => (r.str.length > best.str.length ? r : best), runs[0])
}

function lineFrom(ordered: TextRun[], padLeft: number, padRight: number): TextLine {
  const parts: string[] = []
  ordered.forEach((run, i) => {
    const prev = ordered[i - 1]
    if (prev) {
      // a gap wider than a quarter em is a real space the extractor dropped
      const gap = advanceGap(prev, run)
      if (gap > run.fontSize * 0.22 && !/\s$/.test(parts[parts.length - 1] ?? '')) parts.push(' ')
    }
    parts.push(run.str)
  })
  const lead = dominant(ordered)
  return {
    id: uid('line'),
    page: ordered[0].page,
    runs: ordered,
    rect: unionRects(ordered.map(runRect)),
    baseline: ordered[0].y,
    fontSize: lead.fontSize,
    angle: ordered[0].angle,
    text: parts.join('').replace(/\s+$/, ''),
    font: pickFont(lead),
    cells: [],
    padLeft,
    padRight,
  }
}

/** Merges runs that sit on one baseline into a row, and splits that row into
 *  the cells the text tool edits. */
export function buildLines(runs: TextRun[]): TextLine[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: TextRun[][] = []
  let bucket: TextRun[] = []

  for (const run of sorted) {
    const head = bucket[0]
    const sameLine =
      head &&
      Math.abs(run.y - head.y) < Math.max(2, head.fontSize * 0.34) &&
      Math.abs(run.angle - head.angle) < 1 &&
      run.x > head.x - head.fontSize * 8
    if (!sameLine && bucket.length) { rows.push([...bucket].sort((a, b) => a.x - b.x)); bucket = [] }
    bucket.push(run)
  }
  if (bucket.length) rows.push([...bucket].sort((a, b) => a.x - b.x))

  const columns = detectColumns(rows)

  return rows
    .map(ordered => {
      const groups = splitCells(ordered, columns)
      const row = lineFrom(ordered, 0, 0)
      if (groups.length > 1) {
        row.cells = groups.map((group, i) => {
          // the patch may claim half of the gutter on each side, never more
          const before = groups[i - 1]
          const after = groups[i + 1]
          const em = group[0].fontSize
          const left = before ? advanceGap(before[before.length - 1], group[0]) / 2 : em * 0.14
          const right = after ? advanceGap(group[group.length - 1], after[0]) / 2 : em * 0.14
          return lineFrom(group, Math.min(left, em * 0.2), Math.min(right, em * 0.2))
        })
      }
      return row
    })
    .filter(l => l.text.length > 0)
}

export type Sampled = { ink: string; background: string }

/** Reads the real colours off the rendered page: glyph colour and the paper
 *  behind it, so a replaced line keeps its look on tinted or scanned pages. */
export function sampleColors(canvas: HTMLCanvasElement, scale: number, rect: Rect): Sampled {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const fallback = { ink: '#111111', background: '#ffffff' }
  if (!ctx) return fallback
  const x = Math.max(0, Math.floor(rect.x * scale) - 1)
  const y = Math.max(0, Math.floor(rect.y * scale) - 1)
  const w = Math.min(canvas.width - x, Math.ceil(rect.w * scale) + 2)
  const h = Math.min(canvas.height - y, Math.ceil(rect.h * scale) + 2)
  if (w <= 0 || h <= 0) return fallback

  const { data } = ctx.getImageData(x, y, w, h)
  const bins = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    // 5 bits per channel: tolerant of JPEG noise on scans, still colour-aware
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  let bgKey = 0, bgCount = -1
  for (const [key, count] of bins) if (count > bgCount) { bgCount = count; bgKey = key }
  // average the true pixels of the winning bin: quantised midpoints would put
  // an off-white patch on white paper
  const sum = { r: 0, g: 0, b: 0, n: 0 }
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    if (key !== bgKey) continue
    sum.r += data[i]; sum.g += data[i + 1]; sum.b += data[i + 2]; sum.n++
  }
  const bg = sum.n
    ? { r: sum.r / sum.n, g: sum.g / sum.n, b: sum.b / sum.n }
    : { r: ((bgKey >> 10) & 31) * 8, g: ((bgKey >> 5) & 31) * 8, b: (bgKey & 31) * 8 }

  let ink = { r: 17, g: 17, b: 17 }, far = -1
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b)
    if (d > far) { far = d; ink = { r: data[i], g: data[i + 1], b: data[i + 2] } }
  }
  const hex = (c: { r: number; g: number; b: number }) =>
    '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
  return { ink: far > 40 ? hex(ink) : fallback.ink, background: hex(bg) }
}
