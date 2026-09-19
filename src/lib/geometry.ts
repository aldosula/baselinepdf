import type { Pt, Rect } from './types'

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const rectFromPoints = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
})

export const unionRects = (rects: Rect[]): Rect => {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x0 = Math.min(...rects.map(r => r.x))
  const y0 = Math.min(...rects.map(r => r.y))
  const x1 = Math.max(...rects.map(r => r.x + r.w))
  const y1 = Math.max(...rects.map(r => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const padRect = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 })

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const pointInRect = (p: Pt, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

export const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** rotate `p` around `c` by `deg` clockwise in a y-down frame */
export const rotatePoint = (p: Pt, c: Pt, deg: number): Pt => {
  if (!deg) return p
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** point in the object's own un-rotated frame */
export const toLocal = (p: Pt, r: Rect, rotation: number): Pt => rotatePoint(p, centre(r), -rotation)

export const bboxOfStrokes = (strokes: Pt[][], pad = 0): Rect => {
  const pts = strokes.flat()
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  return padRect(
    { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    pad,
  )
}

/** invert a 6-value affine matrix [a b c d e f] */
export const invert = (m: number[]): number[] => {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!det) return [1, 0, 0, 1, 0, 0]
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export const applyMatrix = (m: number[], p: Pt): Pt => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
})

/** distance from point to segment, used by the eraser */
export const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ramer-Douglas-Peucker: keeps ink files small without visible loss */
export const simplify = (pts: Pt[], tol = 0.35): Pt[] => {
  if (pts.length < 3) return pts
  let maxD = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]]
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)]
}
