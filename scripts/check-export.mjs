/**
 * Coordinate check for the exporter, run outside the browser.
 *
 *   node scripts/check-export.mjs [input.pdf] [output.pdf]
 *
 * It places a known object of every kind on an upright page and on a rotated
 * one, writes the file, and prints where the text landed in PDF user space so
 * the numbers can be compared against what the editor showed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const input = process.argv[2] ?? 'public/sample/sample.pdf'
if (!existsSync(input)) {
  console.error(`No such file: ${input}\nUsage: node scripts/check-export.mjs <input.pdf> [output.pdf] [objects.json]`)
  process.exit(1)
}
const output = process.argv[3] ?? 'check-export.pdf'
// optional: a JSON array of objects dumped from the editor, exported as they are
const objectsFile = process.argv[4]

// bundle the exporter as it ships, so this checks the real code
const bundle = join(process.cwd(), 'node_modules', '.cache', 'pdfstudio-export.mjs')
mkdirSync(join(process.cwd(), 'node_modules', '.cache'), { recursive: true })
execFileSync(require.resolve('esbuild/bin/esbuild'), [
  'src/lib/export.ts', '--bundle', '--format=esm', '--platform=node',
  '--external:pdf-lib', `--outfile=${bundle}`, '--log-level=error',
])
const { exportPdf } = await import(bundle)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const bytes = new Uint8Array(readFileSync(input))
const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise

const pages = []
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const vp = page.getViewport({ scale: 1 })
  pages.push({
    index: i, width: vp.width, height: vp.height,
    rotation: page.rotate % 360, transform: Array.from(vp.transform), userRotation: 0,
  })
}

// a 1 x 1 red pixel, enough to prove image placement
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const objects = objectsFile ? JSON.parse(readFileSync(objectsFile, 'utf8')) : []
for (const p of objectsFile ? [] : pages) {
  const tag = `P${p.index}`
  objects.push({
    id: `t${p.index}`, kind: 'text', page: p.index,
    rect: { x: 40, y: 40, w: 300, h: 20 }, rotation: 0, opacity: 1,
    text: `${tag} top-left anchor`, font: 'Helvetica', size: 12,
    color: '#cc0000', align: 'left', lineGap: 1.2, origin: 'new',
  })
  objects.push({
    id: `m${p.index}`, kind: 'text', page: p.index,
    rect: { x: p.width - 220, y: p.height - 60, w: 200, h: 20 }, rotation: 0, opacity: 1,
    text: `${tag} bottom-right`, font: 'Times-Roman', size: 11,
    color: '#0033aa', align: 'right', lineGap: 1.2, origin: 'new',
  })
  objects.push({
    id: `h${p.index}`, kind: 'highlight', page: p.index,
    rect: { x: 40, y: 90, w: 200, h: 14 }, rotation: 0, opacity: 0.55,
    color: '#ffe14d', rects: [{ x: 40, y: 90, w: 200, h: 14 }], style: 'highlight',
  })
  objects.push({
    id: `d${p.index}`, kind: 'draw', page: p.index,
    rect: { x: 40, y: 120, w: 120, h: 40 }, rotation: 0, opacity: 1,
    strokes: [[{ x: 40, y: 120 }, { x: 100, y: 160 }, { x: 160, y: 120 }]],
    color: '#d63b2f', width: 2, mode: 'pen',
  })
  objects.push({
    id: `i${p.index}`, kind: 'image', page: p.index,
    rect: { x: 40, y: 180, w: 60, h: 30 }, rotation: 0, opacity: 1,
    src: PNG, mime: 'image/png', naturalW: 1, naturalH: 1, role: 'image',
  })
}

const { bytes: out, warnings } = await exportPdf(bytes, pages, objects)
writeFileSync(output, out)

console.log(`pages: ${pages.map(p => `${p.index} ${p.width}x${p.height} rot ${p.rotation}`).join(' | ')}`)
console.log(`warnings: ${warnings.length ? warnings.join('; ') : 'none'}`)
console.log(`written: ${output} (${out.length} bytes)`)

// where did the text actually land?
const checkDoc = await pdfjs.getDocument({ data: out.slice() }).promise
for (let i = 1; i <= checkDoc.numPages; i++) {
  const page = await checkDoc.getPage(i)
  const vp = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  for (const item of content.items) {
    if (!item.str?.startsWith('P')) continue
    const t = pdfjs.Util.transform(vp.transform, item.transform)
    console.log(`  page ${i}: "${item.str}" -> page space x ${t[4].toFixed(1)} y ${t[5].toFixed(1)} (page is ${vp.width.toFixed(0)}x${vp.height.toFixed(0)})`)
  }
}
