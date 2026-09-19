import type { Pt, Rect } from './types'
import { rotatePoint } from './geometry'

/** Axis-aligned bounds of a rect once it is rotated about `c`, page space. */
export const rotatedBounds = (r: Rect, c: Pt, deg: number): Rect => {
  if (!deg) return r
  const pts = [
    rotatePoint({ x: r.x, y: r.y }, c, deg),
    rotatePoint({ x: r.x + r.w, y: r.y }, c, deg),
    rotatePoint({ x: r.x + r.w, y: r.y + r.h }, c, deg),
    rotatePoint({ x: r.x, y: r.y + r.h }, c, deg),
  ]
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}
