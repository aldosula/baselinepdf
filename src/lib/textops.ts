import type { FontKey, TextObj } from './types'
import { baselineOffset } from './css'

/** Changing the size or the face must not slide the text off its baseline,
 *  so the box moves by the difference in ascent. Shared by the inspector and
 *  the toolbar that floats above the selection. */
export const retypePatch = (obj: TextObj, next: { size?: number; font?: FontKey }): Partial<TextObj> => {
  const font = next.font ?? obj.font
  const size = Math.min(400, Math.max(3, next.size ?? obj.size))
  const shift = baselineOffset(obj.font, obj.size, obj.source) - baselineOffset(font, size, obj.source)
  return { font, size, rect: { ...obj.rect, y: obj.rect.y + shift } }
}
