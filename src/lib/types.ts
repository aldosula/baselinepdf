/** All object geometry lives in PAGE SPACE:
 *  PDF user units, origin at the TOP-LEFT of the page as displayed
 *  (i.e. /Rotate already applied), y growing downwards, 1 unit = 1/72 inch.
 *  Zoom never touches the model; it is applied at paint time only. */
export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export type FontKey =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique'

export type ToolId =
  | 'select' | 'text' | 'highlight' | 'draw' | 'image'
  | 'signature' | 'shape' | 'whiteout' | 'erase'

type Base = {
  id: string
  page: number
  /** bounding box, page space, before `rotation` is applied around its centre */
  rect: Rect
  /** clockwise degrees, as seen on screen */
  rotation: number
  opacity: number
  locked?: boolean
}

/** Text. `origin: 'replace'` also paints a mask over the original glyphs. */
export type TextObj = Base & {
  kind: 'text'
  text: string
  font: FontKey
  size: number
  color: string
  align: 'left' | 'center' | 'right'
  lineGap: number
  origin: 'new' | 'replace'
  /** when set, the text is written in the document's own font rather than in
   *  one of the 14 standard ones */
  source?: { fontId: string; fontName: string; ascentEm: number }
  /** the user picked a standard font by hand, so the document's own is ignored */
  sourceOff?: boolean
  /** the width the original line ran to; spacing is stretched to match it, so
   *  a justified paragraph stays justified */
  advance?: number
  /** the text that was there before, which says how much the file itself had
   *  already stretched the spaces */
  sourceText?: string
  /** horizontal glyph scaling of the original line */
  hScale?: number
  /** the original glyph box that must be covered, page space */
  mask?: Rect
  maskColor?: string
}

export type ImageObj = Base & {
  kind: 'image'
  /** data URL; PNG keeps alpha (signatures), JPEG stays JPEG */
  src: string
  mime: 'image/png' | 'image/jpeg'
  naturalW: number
  naturalH: number
  role: 'image' | 'signature'
}

export type HighlightObj = Base & {
  kind: 'highlight'
  color: string
  /** one rect per text line, page space */
  rects: Rect[]
  style: 'highlight' | 'underline' | 'strike'
}

export type DrawObj = Base & {
  kind: 'draw'
  /** polylines in page space */
  strokes: Pt[][]
  color: string
  width: number
  /** marker multiplies, pen paints solid */
  mode: 'pen' | 'marker'
}

export type ShapeObj = Base & {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line' | 'arrow'
  color: string
  fill: string | null
  width: number
}

export type WhiteoutObj = Base & { kind: 'whiteout'; color: string }

export type AnyObj = TextObj | ImageObj | HighlightObj | DrawObj | ShapeObj | WhiteoutObj

export type PageInfo = {
  index: number
  /** displayed size at 100 %, page space units */
  width: number
  height: number
  /** /Rotate of the page, 0 | 90 | 180 | 270 */
  rotation: number
  /** pdf.js viewport transform at scale 1 (pdf space -> page space) */
  transform: number[]
  /** deleted pages stay in the model so undo is cheap */
  deleted?: boolean
  /** extra rotation the user applied, added to `rotation` on export */
  userRotation: number
}

/** A picture already in the document, located in page space. */
export type PageImage = {
  id: string
  page: number
  rect: Rect
  /** area in square points, used to pick the most specific one under a click */
  area: number
}

/** One extracted run of existing PDF text, page space. */
export type TextRun = {
  id: string
  page: number
  str: string
  /** pdf.js loaded name, which is also the CSS family it installs */
  fontId: string
  /** the font's real name in the file, e.g. Arial-BoldMT */
  fontName: string
  /** ascent as a fraction of the em, straight from the file */
  ascentEm: number
  /** baseline start */
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  ascent: number
  angle: number
  /** horizontal scaling of the glyphs, 1 unless the file squeezes the text */
  hScale: number
  fontFamily: string
  bold: boolean
  italic: boolean
  serif: boolean
  mono: boolean
}

/** Runs merged into a visual line.
 *  A row is what a highlight snaps to. Its `cells` are what the text tool
 *  edits: the row split wherever a gap is too wide to be a word space, so a
 *  table cell can be rewritten without dragging its neighbours along. */
export type TextLine = {
  id: string
  page: number
  runs: TextRun[]
  rect: Rect
  baseline: number
  fontSize: number
  angle: number
  text: string
  font: FontKey
  /** the document's own font for this line, used to keep it on export */
  source: { fontId: string; fontName: string; ascentEm: number }
  /** how wide the original line actually ran, which is what justification set */
  advance: number
  hScale: number
  /** empty on a cell, one entry per column on a row that was split */
  cells: TextLine[]
  /** how far the cover patch may spread before it touches the next cell */
  padLeft: number
  padRight: number
}
