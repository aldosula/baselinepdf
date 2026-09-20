import {
  PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib'

/** Writing replacement text in one of the 14 standard fonts is the fallback,
 *  not the goal. The font the document already uses is sitting in the file, so
 *  this resolves the page's own font resources and encodes text for them: the
 *  replacement is then drawn in the real face, at the real size. */
export type NativeFont = {
  /** the name this font has in the page's resource dictionary, e.g. F1 */
  resource: string
  /** the font's name in the file, normalised for matching */
  key: string
  /** returns null when the font cannot represent the text (subset gaps) */
  encode: (text: string) => PDFHexString | null
  widthOf: (text: string, size: number) => number | null
}

/* ------------------------------------------------------------- encodings */

const WIN_ANSI_EXTRA: Record<number, number> = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021,
  136: 0x02c6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018,
  146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02dc,
  153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153, 158: 0x017e, 159: 0x0178,
}

function winAnsiMap(): Map<number, number> {
  const m = new Map<number, number>()
  for (let c = 32; c <= 126; c++) m.set(c, c)
  for (let c = 160; c <= 255; c++) m.set(c, c)
  for (const [c, u] of Object.entries(WIN_ANSI_EXTRA)) m.set(Number(c), u)
  return m
}

/** Enough of the glyph list to read a /Differences array on a Latin document. */
const GLYPH_NAMES: Record<string, number> = {
  space: 32, exclam: 33, quotedbl: 34, numbersign: 35, dollar: 36, percent: 37, ampersand: 38,
  quotesingle: 39, parenleft: 40, parenright: 41, asterisk: 42, plus: 43, comma: 44, hyphen: 45,
  period: 46, slash: 47, zero: 48, one: 49, two: 50, three: 51, four: 52, five: 53, six: 54,
  seven: 55, eight: 56, nine: 57, colon: 58, semicolon: 59, less: 60, equal: 61, greater: 62,
  question: 63, at: 64, bracketleft: 91, backslash: 92, bracketright: 93, asciicircum: 94,
  underscore: 95, grave: 96, braceleft: 123, bar: 124, braceright: 125, asciitilde: 126,
  quoteleft: 0x2018, quoteright: 0x2019, quotedblleft: 0x201c, quotedblright: 0x201d,
  endash: 0x2013, emdash: 0x2014, bullet: 0x2022, ellipsis: 0x2026, Euro: 0x20ac, euro: 0x20ac,
  agrave: 0xe0, aacute: 0xe1, acircumflex: 0xe2, adieresis: 0xe4, egrave: 0xe8, eacute: 0xe9,
  ecircumflex: 0xea, edieresis: 0xeb, igrave: 0xec, iacute: 0xed, ograve: 0xf2, oacute: 0xf3,
  ocircumflex: 0xf4, odieresis: 0xf6, ugrave: 0xf9, uacute: 0xfa, udieresis: 0xfc, ccedilla: 0xe7,
  ntilde: 0xf1, degree: 0xb0, section: 0xa7, paragraph: 0xb6, sterling: 0xa3, yen: 0xa5,
  cent: 0xa2, copyright: 0xa9, registered: 0xae, plusminus: 0xb1, multiply: 0xd7, divide: 0xf7,
}

const glyphToUnicode = (name: string): number | null => {
  if (name in GLYPH_NAMES) return GLYPH_NAMES[name]
  if (/^[A-Za-z]$/.test(name)) return name.charCodeAt(0)
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (uni) return parseInt(uni[1], 16)
  return null
}

/* ------------------------------------------------------------ ToUnicode */

const hexToString = (hex: string) => {
  let out = ''
  for (let i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  return out
}

/** Every font that can be copied out of a PDF carries a ToUnicode map: code ->
 *  text. Inverted, it is exactly what is needed to write new text in that same
 *  font, and unlike the font program it is always present and always correct
 *  for this document. */
function parseToUnicode(dict: PDFDict): Map<number, number> | null {
  const stream = dict.lookup(PDFName.of('ToUnicode'))
  if (!(stream instanceof PDFRawStream)) return null
  let text: string
  try {
    text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
  } catch {
    return null
  }

  const toCode = new Map<number, number>()
  const remember = (code: number, unicode: string) => {
    const cp = unicode.codePointAt(0)
    // one code per character: the first mapping wins, as the viewer does
    if (unicode.length === 1 && cp !== undefined && !toCode.has(cp)) toCode.set(cp, code)
  }

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      remember(parseInt(pair[1], 16), hexToString(pair[2]))
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1]
    for (const range of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(range[1], 16)
      const hi = parseInt(range[2], 16)
      const start = hexToString(range[3])
      const base = start.codePointAt(0)
      if (base === undefined) continue
      for (let c = lo; c <= hi && c - lo < 4096; c++) remember(c, String.fromCharCode(base + (c - lo)))
    }
    for (const range of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = parseInt(range[1], 16)
      let i = 0
      for (const item of range[3].matchAll(/<([0-9A-Fa-f]*)>/g)) remember(lo + i++, hexToString(item[1]))
    }
  }
  return toCode.size ? toCode : null
}

/** /W in a CIDFont: [ c [w1 w2 ...] cFirst cLast w ] */
function parseCidWidths(descendant: PDFDict): { widths: Map<number, number>; dw: number } {
  const widths = new Map<number, number>()
  const dw = numberAt(descendant, 'DW') ?? 1000
  const w = descendant.lookup(PDFName.of('W'))
  if (w instanceof PDFArray) {
    let i = 0
    while (i < w.size()) {
      const first = w.lookup(i)
      if (!(first instanceof PDFNumber)) break
      const next = w.lookup(i + 1)
      if (next instanceof PDFArray) {
        const start = first.asNumber()
        for (let k = 0; k < next.size(); k++) {
          const value = next.lookup(k)
          if (value instanceof PDFNumber) widths.set(start + k, value.asNumber())
        }
        i += 2
      } else if (next instanceof PDFNumber) {
        const third = w.lookup(i + 2)
        if (third instanceof PDFNumber) {
          for (let c = first.asNumber(); c <= next.asNumber() && c - first.asNumber() < 65536; c++) {
            widths.set(c, third.asNumber())
          }
        }
        i += 3
      } else break
    }
  }
  return { widths, dw }
}

/* --------------------------------------------------------------- helpers */

const normalise = (name: string) =>
  name
    .replace(/^[A-Z]{6}\+/, '')      // subset prefix
    .replace(/-\d+$/, '')            // the suffix pdf.js appends
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()

const lookupDict = (dict: PDFDict, key: string): PDFDict | undefined => {
  const value = dict.lookup(PDFName.of(key))
  return value instanceof PDFDict ? value : undefined
}

const numberAt = (dict: PDFDict, key: string): number | undefined => {
  const value = dict.lookup(PDFName.of(key))
  return value instanceof PDFNumber ? value.asNumber() : undefined
}

/* ------------------------------------------------------- simple fonts */

function simpleFont(resource: string, key: string, dict: PDFDict): NativeFont | null {
  const codes = winAnsiMap()
  const encodingValue = dict.lookup(PDFName.of('Encoding'))

  if (encodingValue instanceof PDFName) {
    const name = encodingValue.asString()
    // MacRoman and Standard differ above 127; the ASCII range is identical and
    // that is the part we can promise
    if (name !== '/WinAnsiEncoding') for (const c of [...codes.keys()]) if (c > 126) codes.delete(c)
  } else if (encodingValue instanceof PDFDict) {
    const base = encodingValue.lookup(PDFName.of('BaseEncoding'))
    if (base instanceof PDFName && base.asString() !== '/WinAnsiEncoding') {
      for (const c of [...codes.keys()]) if (c > 126) codes.delete(c)
    }
    const diffs = encodingValue.lookup(PDFName.of('Differences'))
    if (diffs instanceof PDFArray) {
      let code = 0
      for (let i = 0; i < diffs.size(); i++) {
        const entry = diffs.lookup(i)
        if (entry instanceof PDFNumber) code = entry.asNumber()
        else if (entry instanceof PDFName) {
          const unicode = glyphToUnicode(entry.asString().replace(/^\//, ''))
          if (unicode !== null) codes.set(code, unicode)
          else codes.delete(code)
          code++
        }
      }
    }
  }

  const declared = parseToUnicode(dict)
  const toCode = declared ?? new Map<number, number>()
  if (!declared) for (const [code, unicode] of codes) if (!toCode.has(unicode)) toCode.set(unicode, code)

  const firstChar = numberAt(dict, 'FirstChar') ?? 0
  const widthsArray = dict.lookup(PDFName.of('Widths'))
  const widths = widthsArray instanceof PDFArray
    ? widthsArray.asArray().map((_, i) => {
        const w = widthsArray.lookup(i)
        return w instanceof PDFNumber ? w.asNumber() : 0
      })
    : null
  const descriptor = lookupDict(dict, 'FontDescriptor')
  const missingWidth = descriptor ? numberAt(descriptor, 'MissingWidth') ?? 0 : 0

  return {
    resource,
    key,
    encode(text) {
      const bytes: number[] = []
      for (const ch of text) {
        const code = toCode.get(ch.codePointAt(0)!)
        if (code === undefined) return null
        bytes.push(code)
      }
      return PDFHexString.of(bytes.map(b => b.toString(16).padStart(2, '0')).join(''))
    },
    widthOf(text, size) {
      if (!widths) return null
      let total = 0
      for (const ch of text) {
        const code = toCode.get(ch.codePointAt(0)!)
        if (code === undefined) return null
        const w = widths[code - firstChar]
        total += (typeof w === 'number' && w > 0 ? w : missingWidth) / 1000
      }
      return total * size
    },
  }
}

/* --------------------------------------------------- composite fonts */

function type0Font(resource: string, key: string, dict: PDFDict): NativeFont | null {
  const encoding = dict.lookup(PDFName.of('Encoding'))
  if (!(encoding instanceof PDFName) || encoding.asString() !== '/Identity-H') return null

  const descendants = dict.lookup(PDFName.of('DescendantFonts'))
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) return null
  const descendant = descendants.lookup(0)
  if (!(descendant instanceof PDFDict)) return null

  const cidToGid = descendant.lookup(PDFName.of('CIDToGIDMap'))
  if (cidToGid && !(cidToGid instanceof PDFName)) return null // a mapping stream: not handled

  // subset fonts usually ship without a cmap table, so the font program cannot
  // answer "which glyph is this character"; the file's own ToUnicode can
  const toCode = parseToUnicode(dict)
  if (!toCode) return null
  const { widths, dw } = parseCidWidths(descendant)

  return {
    resource,
    key,
    encode(text) {
      let hex = ''
      for (const ch of text) {
        const code = toCode.get(ch.codePointAt(0)!)
        if (code === undefined) return null
        hex += code.toString(16).padStart(4, '0')
      }
      return PDFHexString.of(hex)
    },
    widthOf(text, size) {
      let total = 0
      for (const ch of text) {
        const code = toCode.get(ch.codePointAt(0)!)
        if (code === undefined) return null
        total += (widths.get(code) ?? dw) / 1000
      }
      return total * size
    },
  }
}

/* ------------------------------------------------------------- the map */

export function resolvePageFonts(page: PDFPage): NativeFont[] {
  const out: NativeFont[] = []
  let fonts: unknown
  try {
    const resources = page.node.Resources()
    fonts = resources ? resources.lookup(PDFName.of('Font')) : undefined
  } catch {
    return out
  }
  if (!(fonts instanceof PDFDict)) return out

  for (const name of fonts.keys()) {
    // one unreadable font must not cost us the others
    try {
      const resource = name.asString().replace(/^\//, '')
      const dict = fonts.lookup(name)
      if (!(dict instanceof PDFDict)) continue
      const baseFont = dict.lookup(PDFName.of('BaseFont'))
      if (!(baseFont instanceof PDFName)) continue
      const key = normalise(baseFont.asString().replace(/^\//, ''))
      const subtype = dict.lookup(PDFName.of('Subtype'))
      const kind = subtype instanceof PDFName ? subtype.asString() : ''

      const font = kind === '/Type0'
        ? type0Font(resource, key, dict)
        : kind === '/Type1' || kind === '/TrueType' || kind === '/MMType1'
          ? simpleFont(resource, key, dict)
          : null
      if (font) out.push(font)
    } catch {
      /* skip this one */
    }
  }
  return out
}

/** Every resource on the page with this face. A document usually embeds the
 *  font as a subset, sometimes several of them, and each subset only knows the
 *  characters it was asked to carry, so the caller tries them in turn and takes
 *  the first that can spell the new text. */
export const matchFonts = (fonts: NativeFont[], name: string): NativeFont[] => {
  const key = normalise(name)
  if (!key) return []
  const exact = fonts.filter(f => f.key === key)
  const near = fonts.filter(f => f.key !== key && (f.key.startsWith(key) || key.startsWith(f.key)))
  return [...exact, ...near]
}

export const matchFont = (fonts: NativeFont[], name: string): NativeFont | undefined => matchFonts(fonts, name)[0]

/** The first of those resources that can write `text`, or nothing. */
export const fontThatCanWrite = (fonts: NativeFont[], name: string, text: string): NativeFont | undefined =>
  matchFonts(fonts, name).find(f => f.encode(text) !== null)
