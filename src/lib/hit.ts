import type { AnyObj, Pt, Rect } from './types'
import { centre, distToSegment, pointInRect, rotatePoint, toLocal } from './geometry'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** local position of a handle inside its box, 0..1 space */
export const handleAnchor = (h: Handle): Pt => ({
  x: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5,
  y: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5,
})

export const handleCursor = (h: Handle, rotation: number) => {
  if (h === 'rotate') return 'grab'
  const base = { nw: 315, n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270 }[h]
  const a = (((base + rotation) % 360) + 360) % 360
  const dirs = ['ns', 'nesw', 'ew', 'nwse']
  return `${dirs[Math.round(a / 45) % 4]}-resize`
}

const near = (p: Pt, obj: AnyObj, tolerance: number) => {
  if (obj.kind === 'draw') {
    const c = centre(obj.rect)
    const local = rotatePoint(p, c, -obj.rotation)
    return obj.strokes.some(s =>
      s.length === 1
        ? Math.hypot(s[0].x - local.x, s[0].y - local.y) < tolerance + obj.width
        : s.some((pt, i) => i > 0 && distToSegment(local, s[i - 1], pt) < tolerance + obj.width / 2),
    )
  }
  if (obj.kind === 'highlight') return obj.rects.some(r => pointInRect(p, r))
  return true
}

/** Top-most object under a page-space point. */
export function hitTest(objects: AnyObj[], page: number, p: Pt, tolerance = 3): AnyObj | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.page !== page || o.locked) continue
    const local = toLocal(p, o.rect, o.rotation)
    const box: Rect = { x: o.rect.x - tolerance, y: o.rect.y - tolerance, w: o.rect.w + tolerance * 2, h: o.rect.h + tolerance * 2 }
    if (pointInRect(local, box) && near(p, o, tolerance)) return o
  }
  return null
}

/** Resize honouring the object's own rotation: the opposite corner stays put. */
export function resizeRect(rect: Rect, rotation: number, handle: Handle, pointer: Pt, keepAspect: boolean): Rect {
  const anchor = handleAnchor(handle)
  const fixed = { x: 1 - anchor.x, y: 1 - anchor.y }
  const fixedDisplay = rotatePoint(
    { x: rect.x + rect.w * fixed.x, y: rect.y + rect.h * fixed.y },
    centre(rect),
    rotation,
  )
  const local = toLocal(pointer, rect, rotation)
  const min = 4

  let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h
  if (handle.includes('w')) x0 = Math.min(local.x, x1 - min)
  if (handle.includes('e')) x1 = Math.max(local.x, x0 + min)
  if (handle.includes('n')) y0 = Math.min(local.y, y1 - min)
  if (handle.includes('s')) y1 = Math.max(local.y, y0 + min)

  let w = x1 - x0, h = y1 - y0
  if (keepAspect && rect.w > 0 && rect.h > 0 && handle.length === 2) {
    const ratio = rect.w / rect.h
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
    if (handle.includes('w')) x0 = x1 - w
    if (handle.includes('n')) y0 = y1 - h
  }

  // put the fixed corner back exactly where it was on screen
  const next: Rect = { x: x0, y: y0, w, h }
  const fixedLocal = { x: next.x + next.w * fixed.x, y: next.y + next.h * fixed.y }
  const fixedAfter = rotatePoint(fixedLocal, centre(next), rotation)
  return { ...next, x: next.x + (fixedDisplay.x - fixedAfter.x), y: next.y + (fixedDisplay.y - fixedAfter.y) }
}

export const snapAngle = (deg: number, step = 15) => Math.round(deg / step) * step
