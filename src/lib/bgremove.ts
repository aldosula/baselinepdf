import { loadImage } from './image'

export type CutoutOptions = {
  /** 0-100. How far a pixel must sit from the paper colour to count as ink. */
  threshold: number
  /** 0-100. Width of the soft edge; keeps anti-aliasing instead of jaggies. */
  softness: number
  /** Repaint the ink in one colour, or keep the original pen colour. */
  inkColor: string | null
  autoCrop: boolean
  despeckle: boolean
}

export const defaultCutout: CutoutOptions = {
  threshold: 42,
  softness: 26,
  inkColor: '#101a33',
  autoCrop: true,
  despeckle: true,
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Paper colour: the dominant colour of the outer frame of the photo. */
function estimatePaper(data: Uint8ClampedArray, w: number, h: number) {
  const bins = new Map<number, number>()
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.06))
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4
    if (data[i + 3] < 12) return
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < band || y < band || x >= w - band || y >= h - band) add(x, y)

  let key = 0, best = -1
  for (const [k, c] of bins) if (c > best) { best = c; key = k }
  return { r: ((key >> 10) & 31) * 8 + 4, g: ((key >> 5) & 31) * 8 + 4, b: (key & 31) * 8 + 4 }
}

/** Drops specks (dust, JPEG blocks) that have almost no opaque neighbours. */
function despeckle(alpha: Float32Array, w: number, h: number) {
  const out = new Float32Array(alpha)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (alpha[i] < 0.08) continue
      let sum = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) sum += alpha[i + dy * w + dx]
      if (sum < 0.55) out[i] = 0
    }
  }
  return out
}

export type Cutout = { dataUrl: string; width: number; height: number; paper: string }

/** Turns a photo or scan of a signature into a transparent PNG.
 *  Works on the distance from the estimated paper colour, so it copes with
 *  grey phone photos, yellowed paper and blue ink alike. */
export async function makeCutout(src: string, opts: CutoutOptions): Promise<Cutout> {
  const img = await loadImage(src)
  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const src2d = document.createElement('canvas')
  src2d.width = w; src2d.height = h
  const sctx = src2d.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(img, 0, 0, w, h)
  const image = sctx.getImageData(0, 0, w, h)
  const data = image.data

  const paper = estimatePaper(data, w, h)
  const paperLum = 0.299 * paper.r + 0.587 * paper.g + 0.114 * paper.b
  // distances are measured against the strongest ink present, not against pure
  // black, so a faint pencil signature lifts as well as a bold marker one
  let maxDist = 1
  const dist = new Float32Array(w * h)
  for (let p = 0, i = 0; p < dist.length; p++, i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const chroma = Math.abs(data[i] - paper.r) + Math.abs(data[i + 1] - paper.g) + Math.abs(data[i + 2] - paper.b)
    const d = Math.max(paperLum - lum, chroma * 0.34)
    dist[p] = d
    if (d > maxDist) maxDist = d
  }

  const lo = (opts.threshold / 100) * maxDist * 0.9
  const hi = lo + Math.max(4, (opts.softness / 100) * maxDist * 0.75)
  let alpha = new Float32Array(w * h)
  for (let p = 0; p < alpha.length; p++) {
    const t = (dist[p] - lo) / Math.max(1e-6, hi - lo)
    alpha[p] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t) // smoothstep
  }
  if (opts.despeckle) alpha = despeckle(alpha, w, h)

  const ink = opts.inkColor ? hexToRgb(opts.inkColor) : null
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      const a = alpha[p]
      if (a > 0.12) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      if (ink) { data[i] = ink.r; data[i + 1] = ink.g; data[i + 2] = ink.b }
      else if (a > 0) {
        // un-multiply the paper out of semi-transparent edge pixels
        const k = Math.min(1, a + 0.15)
        data[i] = Math.max(0, Math.min(255, (data[i] - paper.r * (1 - k)) / k))
        data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - paper.g * (1 - k)) / k))
        data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - paper.b * (1 - k)) / k))
      }
      data[i + 3] = Math.round(a * 255)
    }
  }

  const pad = 4
  const crop = opts.autoCrop && maxX >= minX
    ? {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        w: Math.min(w, maxX + pad) - Math.max(0, minX - pad) + 1,
        h: Math.min(h, maxY + pad) - Math.max(0, minY - pad) + 1,
      }
    : { x: 0, y: 0, w, h }

  sctx.putImageData(image, 0, 0)
  const out = document.createElement('canvas')
  out.width = Math.max(1, crop.w)
  out.height = Math.max(1, crop.h)
  out.getContext('2d')!.drawImage(src2d, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)

  return {
    dataUrl: out.toDataURL('image/png'),
    width: out.width,
    height: out.height,
    paper: `rgb(${paper.r}, ${paper.g}, ${paper.b})`,
  }
}

/** Ink path -> transparent PNG, shared by the draw pad and the typed name. */
export function canvasToTrimmedPng(canvas: HTMLCanvasElement, pad = 6): Cutout | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) return null
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad)
  const w = Math.min(canvas.width, maxX + pad) - x + 1
  const h = Math.min(canvas.height, maxY + pad) - y + 1
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  out.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h)
  return { dataUrl: out.toDataURL('image/png'), width: w, height: h, paper: 'transparent' }
}
