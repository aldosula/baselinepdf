import {
  BlendMode, LineCapStyle, PDFDocument, PDFFont, PDFPage, StandardFonts, beginText, degrees,
  endText, popGraphicsState, pushGraphicsState, rgb, setFillingRgbColor, setFontAndSize,
  setTextMatrix, showText,
} from 'pdf-lib'
import { fontThatCanWrite, matchFont, resolvePageFonts, type NativeFont } from './nativefont'
import type { AnyObj, FontKey, PageInfo, Pt, Rect, TextObj } from './types'
import { applyMatrix, centre, invert, rotatePoint } from './geometry'
import { dataUrlToBytes } from './image'

const STANDARD: Record<FontKey, StandardFonts> = {
  'Helvetica': StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  'Times-Italic': StandardFonts.TimesRomanItalic,
  'Times-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  'Courier': StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
  'Courier-Oblique': StandardFonts.CourierOblique,
  'Courier-BoldOblique': StandardFonts.CourierBoldOblique,
}

const hex = (value: string) => {
  const h = value.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full || ' 000000', 16)
  return rgb((((n >> 16) & 255) / 255), (((n >> 8) & 255) / 255), ((n & 255) / 255))
}

/** The 14 standard fonts speak WinAnsi only. Rather than throwing on a curly
 *  quote we fold the usual suspects and report anything genuinely lost. */
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '…': '...', ' ': ' ',
  '•': '∙', 'ˆ': '^', '‹': '<', '›': '>', '€': '€',
  '\t': '    ',
}
function sanitise(text: string, font: PDFFont, warn: (m: string) => void) {
  let lost = 0
  const out = [...text].map(ch => {
    const folded = FOLD[ch] ?? ch
    try {
      font.encodeText(folded)
      return folded
    } catch {
      lost++
      return '?'
    }
  }).join('')
  if (lost) warn(`${lost} character${lost > 1 ? 's' : ''} are outside the standard PDF font set and were written as "?"`)
  return out
}

type PageCtx = {
  page: PDFPage
  info: PageInfo
  /** page space (top-left, y down) -> PDF user space */
  toPdf: (p: Pt) => Pt
  /** page rotation in degrees, needed to keep drawn content upright */
  rot: number
  /** the fonts this page already carries, reused for replacement text */
  fonts: NativeFont[]
}

/** display-space corner of an object, rotated around its own centre */
const corner = (rect: Rect, rotation: number, local: Pt): Pt =>
  rotatePoint({ x: rect.x + local.x, y: rect.y + local.y }, centre(rect), rotation)

function drawRect(ctx: PageCtx, rect: Rect, rotation: number, opts: {
  color?: string; fill?: string | null; width?: number; opacity?: number; blend?: BlendMode
}) {
  const p = ctx.toPdf(corner(rect, rotation, { x: 0, y: rect.h })) // bottom-left as drawn
  ctx.page.drawRectangle({
    x: p.x,
    y: p.y,
    width: rect.w,
    height: rect.h,
    rotate: degrees(ctx.rot - rotation),
    color: opts.fill ? hex(opts.fill) : undefined,
    borderColor: opts.color ? hex(opts.color) : undefined,
    borderWidth: opts.color ? (opts.width ?? 1) : undefined,
    opacity: opts.opacity,
    borderOpacity: opts.opacity,
    blendMode: opts.blend,
  })
}

/** Draws a line in the document's own font, by referencing the font resource
 *  the page already has. Returns false when that font cannot spell the text. */
function drawNativeLine(
  ctx: PageCtx, obj: TextObj, native: NativeFont, line: string, anchor: Pt, size: number,
): boolean {
  const encoded = native.encode(line)
  if (!encoded) return false
  const p = ctx.toPdf(anchor)
  const angle = ((ctx.rot - obj.rotation) * Math.PI) / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const c = hex(obj.color)
  ctx.page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingRgbColor(c.red, c.green, c.blue),
    setFontAndSize(native.resource, size),
    setTextMatrix(cos, sin, -sin, cos, p.x, p.y),
    showText(encoded),
    endText(),
    popGraphicsState(),
  )
  return true
}

function drawTextObject(ctx: PageCtx, obj: TextObj, font: PDFFont, warn: (m: string) => void) {
  if (obj.mask) {
    // the mask travels with the box, so a rotated replacement still covers its
    // original glyphs exactly
    const m = obj.mask
    const p = ctx.toPdf(corner(obj.rect, obj.rotation, { x: m.x - obj.rect.x, y: m.y - obj.rect.y + m.h }))
    ctx.page.drawRectangle({
      x: p.x, y: p.y, width: m.w, height: m.h,
      rotate: degrees(ctx.rot - obj.rotation),
      color: hex(obj.maskColor ?? '#ffffff'),
    })
  }
  const size = obj.size
  // the document's own font is preferred, and its own ascent with it
  const family = obj.source?.fontName
  const hasFace = family ? Boolean(matchFont(ctx.fonts, family)) : false
  const ascent = obj.source ? obj.source.ascentEm * size : font.heightAtSize(size, { descender: false })
  const lineHeight = size * obj.lineGap
  const lines = obj.text.split('\n')

  lines.forEach((raw, i) => {
    // a subset only knows the characters the document already used, so each
    // resource with this face is tried before falling back
    const native = family && raw ? fontThatCanWrite(ctx.fonts, family, raw) : undefined
    if (native) {
      const width = native.widthOf(raw, size)
      const dx = width === null || obj.align === 'left'
        ? 0
        : obj.align === 'center' ? (obj.rect.w - width) / 2 : obj.rect.w - width
      const anchor = corner(obj.rect, obj.rotation, { x: dx, y: ascent + i * lineHeight })
      if (drawNativeLine(ctx, obj, native, raw, anchor, size)) return
    } else if (hasFace && raw) {
      warn(`The document's copy of "${family}" does not carry every character you typed, so that line was written in a standard font instead`)
    }
    const line = sanitise(raw, font, warn)
    if (!line) return
    const width = font.widthOfTextAtSize(line, size)
    const dx = obj.align === 'center' ? (obj.rect.w - width) / 2 : obj.align === 'right' ? obj.rect.w - width : 0
    const anchor = corner(obj.rect, obj.rotation, { x: dx, y: ascent + i * lineHeight })
    const p = ctx.toPdf(anchor)
    ctx.page.drawText(line, {
      x: p.x,
      y: p.y,
      size,
      font,
      color: hex(obj.color),
      opacity: obj.opacity,
      rotate: degrees(ctx.rot - obj.rotation),
    })
  })
}

function drawStrokes(ctx: PageCtx, obj: Extract<AnyObj, { kind: 'draw' }>) {
  const marker = obj.mode === 'marker'
  for (const stroke of obj.strokes) {
    if (stroke.length === 1) {
      const p = ctx.toPdf(rotatePoint(stroke[0], centre(obj.rect), obj.rotation))
      ctx.page.drawCircle({ x: p.x, y: p.y, size: obj.width / 2, color: hex(obj.color), opacity: obj.opacity })
      continue
    }
    for (let i = 1; i < stroke.length; i++) {
      const a = ctx.toPdf(rotatePoint(stroke[i - 1], centre(obj.rect), obj.rotation))
      const b = ctx.toPdf(rotatePoint(stroke[i], centre(obj.rect), obj.rotation))
      ctx.page.drawLine({
        start: a,
        end: b,
        thickness: obj.width,
        color: hex(obj.color),
        opacity: marker ? Math.min(obj.opacity, 0.45) : obj.opacity,
        lineCap: LineCapStyle.Round,
        blendMode: marker ? BlendMode.Multiply : undefined,
      })
    }
  }
}

function drawShape(ctx: PageCtx, obj: Extract<AnyObj, { kind: 'shape' }>) {
  const { rect, rotation } = obj
  if (obj.shape === 'rect') {
    drawRect(ctx, rect, rotation, { color: obj.color, fill: obj.fill, width: obj.width, opacity: obj.opacity })
    return
  }
  if (obj.shape === 'ellipse') {
    const c = ctx.toPdf(corner(rect, rotation, { x: rect.w / 2, y: rect.h / 2 }))
    ctx.page.drawEllipse({
      x: c.x, y: c.y, xScale: rect.w / 2, yScale: rect.h / 2,
      rotate: degrees(ctx.rot - rotation),
      borderColor: hex(obj.color), borderWidth: obj.width,
      color: obj.fill ? hex(obj.fill) : undefined,
      opacity: obj.opacity, borderOpacity: obj.opacity,
    })
    return
  }
  // line and arrow run corner to corner of the box
  const start = ctx.toPdf(corner(rect, rotation, { x: 0, y: 0 }))
  const end = ctx.toPdf(corner(rect, rotation, { x: rect.w, y: rect.h }))
  ctx.page.drawLine({ start, end, thickness: obj.width, color: hex(obj.color), opacity: obj.opacity, lineCap: LineCapStyle.Round })
  if (obj.shape === 'arrow') {
    const ang = Math.atan2(end.y - start.y, end.x - start.x)
    const head = Math.max(6, obj.width * 4)
    for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
      ctx.page.drawLine({
        start: end,
        end: { x: end.x + Math.cos(ang + spread) * head, y: end.y + Math.sin(ang + spread) * head },
        thickness: obj.width,
        color: hex(obj.color),
        opacity: obj.opacity,
        lineCap: LineCapStyle.Round,
      })
    }
  }
}

export type ExportResult = { bytes: Uint8Array; warnings: string[] }

export async function exportPdf(
  source: Uint8Array,
  pages: PageInfo[],
  objects: AnyObj[],
): Promise<ExportResult> {
  const warnings: string[] = []
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m) }

  const original = await PDFDocument.load(source.slice(), { ignoreEncryption: true, updateMetadata: false })
  const kept = pages.filter(p => !p.deleted)
  if (!kept.length) throw new Error('Every page has been deleted, so there is nothing to save')

  const orderChanged = kept.some((p, i) => p.index !== i + 1) || kept.length !== original.getPageCount()
  let doc = original
  if (orderChanged) {
    // a new document is the only safe way to reorder or drop pages
    doc = await PDFDocument.create()
    const copied = await doc.copyPages(original, kept.map(p => p.index - 1))
    copied.forEach(p => doc.addPage(p))
  }

  const fonts = new Map<FontKey, PDFFont>()
  const getFont = async (key: FontKey) => {
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(STANDARD[key]))
    return fonts.get(key)!
  }
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  const getImage = async (src: string, mime: string) => {
    if (!images.has(src)) {
      const bytes = dataUrlToBytes(src)
      images.set(src, mime === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes))
    }
    return images.get(src)!
  }

  for (let i = 0; i < kept.length; i++) {
    const info = kept[i]
    const page = orderChanged ? doc.getPage(i) : doc.getPage(info.index - 1)
    const inv = invert(info.transform)
    const ctx: PageCtx = {
      page,
      info,
      toPdf: (p: Pt) => applyMatrix(inv, p),
      rot: info.rotation,
      fonts: resolvePageFonts(page),
    }

    for (const obj of objects.filter(o => o.page === info.index)) {
      switch (obj.kind) {
        case 'whiteout':
          drawRect(ctx, obj.rect, obj.rotation, { fill: obj.color, opacity: obj.opacity })
          break
        case 'highlight':
          for (const r of obj.rects) {
            if (obj.style === 'highlight') {
              drawRect(ctx, r, 0, { fill: obj.color, opacity: obj.opacity, blend: BlendMode.Multiply })
            } else {
              const y = obj.style === 'underline' ? r.y + r.h * 0.94 : r.y + r.h * 0.58
              const thickness = Math.max(0.8, r.h * 0.07)
              const a = ctx.toPdf({ x: r.x, y })
              const b = ctx.toPdf({ x: r.x + r.w, y })
              page.drawLine({ start: a, end: b, thickness, color: hex(obj.color), opacity: obj.opacity, lineCap: LineCapStyle.Round })
            }
          }
          break
        case 'draw':
          drawStrokes(ctx, obj)
          break
        case 'shape':
          drawShape(ctx, obj)
          break
        case 'image': {
          const embedded = await getImage(obj.src, obj.mime)
          const p = ctx.toPdf(corner(obj.rect, obj.rotation, { x: 0, y: obj.rect.h }))
          page.drawImage(embedded, {
            x: p.x, y: p.y, width: obj.rect.w, height: obj.rect.h,
            rotate: degrees(ctx.rot - obj.rotation),
            opacity: obj.opacity,
          })
          break
        }
        case 'text':
          drawTextObject(ctx, obj, await getFont(obj.font), warn)
          break
      }
    }

    if (info.userRotation) page.setRotation(degrees((info.rotation + info.userRotation) % 360))
  }

  doc.setProducer('PDF Studio')
  doc.setModificationDate(new Date())
  return { bytes: await doc.save({ useObjectStreams: true }), warnings }
}

export function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
