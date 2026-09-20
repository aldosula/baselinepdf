import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnyObj, FontKey, PageImage, PageInfo, Rect, TextLine, ToolId } from './types'
import { loadPdf } from './pdf'
import { idbGet, idbSet } from './idb'
import { forgetRecent, keepBytes, keepEdits, listRecents, readBytes, readEdits, recentId, touchRecent, type RecentDoc } from './recents'
import { uid } from './id'

export type SavedSignature = { id: string; dataUrl: string; width: number; height: number; label: string }

type Snapshot = { objects: AnyObj[]; pages: PageInfo[] }

export type ToolOptions = {
  textColor: string
  textSize: number
  textFont: FontKey
  highlightColor: string
  highlightStyle: 'highlight' | 'underline' | 'strike'
  drawColor: string
  drawWidth: number
  drawMode: 'pen' | 'marker'
  shape: 'rect' | 'ellipse' | 'line' | 'arrow'
  shapeColor: string
  shapeFill: string | null
  shapeWidth: number
  whiteoutColor: string
}

type State = {
  proxy: PDFDocumentProxy | null
  bytes: Uint8Array | null
  fileName: string
  docId: string
  recents: RecentDoc[]
  /** edits found in the drawer for the file just opened, not yet applied */
  pendingRestore: { count: number; updatedAt: number } | null
  loading: boolean
  error: string | null

  pages: PageInfo[]
  objects: AnyObj[]
  lines: Record<number, TextLine[]>
  linesLoading: Record<number, boolean>
  images: Record<number, PageImage[]>

  tool: ToolId
  options: ToolOptions
  selection: string[]
  editingTextId: string | null
  zoom: number
  fitMode: 'width' | 'page' | 'custom'
  activePage: number
  theme: 'light' | 'dark'
  signatures: SavedSignature[]
  dirty: boolean

  past: Snapshot[]
  future: Snapshot[]
  pending: Snapshot | null
}

type Actions = {
  openFile: (file: File) => Promise<void>
  closeDoc: () => void
  openRecent: (id: string) => Promise<boolean>
  forget: (id: string) => Promise<void>
  refreshRecents: () => Promise<void>
  applyPending: () => Promise<void>
  dismissPending: () => void
  setThumb: (dataUrl: string) => void

  setTool: (t: ToolId) => void
  setOption: <K extends keyof ToolOptions>(k: K, v: ToolOptions[K]) => void
  setZoom: (z: number, fit?: State['fitMode']) => void
  setActivePage: (i: number) => void
  setTheme: (t: 'light' | 'dark') => void
  setLines: (page: number, lines: TextLine[]) => void
  setImages: (page: number, images: PageImage[]) => void
  markLinesLoading: (page: number) => void

  select: (ids: string[]) => void
  toggleSelect: (id: string) => void
  setEditingText: (id: string | null) => void

  begin: () => void
  commit: () => void
  mutate: (fn: (draft: { objects: AnyObj[]; pages: PageInfo[] }) => void, options?: { history?: boolean }) => void
  add: (obj: AnyObj) => void
  update: (id: string, patch: Partial<AnyObj>) => void
  remove: (ids: string[]) => void
  deleteSelection: () => void
  duplicate: (ids: string[]) => void
  bring: (id: string, dir: 'front' | 'back') => void
  undo: () => void
  redo: () => void

  rotatePage: (index: number, delta: number) => void
  deletePage: (index: number) => void
  movePage: (from: number, to: number) => void

  saveSignature: (sig: Omit<SavedSignature, 'id'>) => SavedSignature
  deleteSignature: (id: string) => void
  loadSignatures: () => Promise<void>
}

const snapshot = (s: State): Snapshot => ({
  objects: structuredClone(s.objects),
  pages: structuredClone(s.pages),
})

const LIMIT = 80

export const useStore = create<State & Actions>((set, get) => ({
  proxy: null,
  bytes: null,
  fileName: '',
  docId: '',
  recents: [],
  pendingRestore: null,
  loading: false,
  error: null,
  pages: [],
  objects: [],
  lines: {},
  linesLoading: {},
  images: {},

  tool: 'select',
  options: {
    textColor: '#16202a',
    textSize: 12,
    textFont: 'Helvetica',
    highlightColor: '#ffe14d',
    highlightStyle: 'highlight',
    drawColor: '#d63b2f',
    drawWidth: 2.4,
    drawMode: 'pen',
    shape: 'rect',
    shapeColor: '#d63b2f',
    shapeFill: null,
    shapeWidth: 1.8,
    whiteoutColor: 'auto',
  },
  selection: [],
  editingTextId: null,
  zoom: 1,
  fitMode: 'width',
  activePage: 1,
  theme: (localStorage.getItem('pdfstudio.theme') as 'light' | 'dark') ?? 'light',
  signatures: [],
  dirty: false,
  past: [],
  future: [],
  pending: null,

  async openFile(file) {
    flushEdits()
    set({ loading: true, error: null })
    try {
      const doc = await loadPdf(file)
      const id = recentId(doc.name, doc.bytes.length)
      // edits already in the drawer for this exact file are offered, not forced
      const stored = await readEdits(id)
      set({
        proxy: doc.proxy,
        bytes: doc.bytes,
        fileName: doc.name,
        docId: id,
        pages: doc.pages,
        objects: [],
        lines: {},
        linesLoading: {},
        images: {},
        past: [],
        future: [],
        selection: [],
        activePage: 1,
        loading: false,
        dirty: false,
        pendingRestore: stored?.objects?.length
          ? { count: stored.objects.length, updatedAt: Date.now() }
          : null,
      })
      const kept = await keepBytes(id, doc.bytes)
      await touchRecent({
        id, name: doc.name, pageCount: doc.pages.length, size: doc.bytes.length,
        edits: stored?.objects?.length ?? 0, bytesDropped: !kept,
      })
      void get().refreshRecents()
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'That file could not be opened' })
    }
  },

  closeDoc() {
    flushEdits()
    set({
      proxy: null, bytes: null, fileName: '', docId: '', pages: [], objects: [],
      lines: {}, past: [], future: [], selection: [], error: null, pendingRestore: null,
    })
    void get().refreshRecents()
  },

  async openRecent(id) {
    flushEdits()
    const bytes = await readBytes(id)
    if (!bytes?.length) return false
    const entry = (await listRecents()).find(d => d.id === id)
    set({ loading: true, error: null })
    try {
      const doc = await loadPdf(new Uint8Array(bytes), entry?.name ?? 'document.pdf')
      const stored = await readEdits(id)
      set({
        proxy: doc.proxy,
        bytes: doc.bytes,
        fileName: entry?.name ?? doc.name,
        docId: id,
        pages: stored?.pages?.length ? stored.pages : doc.pages,
        objects: stored?.objects ?? [],
        lines: {},
        linesLoading: {},
        images: {},
        past: [],
        future: [],
        selection: [],
        activePage: 1,
        loading: false,
        dirty: false,
        pendingRestore: null,
      })
      return true
    } catch {
      set({ loading: false, error: 'That document could not be reopened' })
      return false
    }
  },

  async forget(id) {
    const list = await forgetRecent(id)
    set({ recents: list })
  },

  async refreshRecents() {
    set({ recents: await listRecents() })
  },

  async applyPending() {
    const stored = await readEdits(get().docId)
    if (!stored?.objects?.length) { set({ pendingRestore: null }); return }
    set({
      objects: stored.objects,
      pages: stored.pages?.length ? stored.pages : get().pages,
      past: [], future: [], selection: [], editingTextId: null,
      pendingRestore: null,
    })
  },

  dismissPending() { set({ pendingRestore: null }) },

  setThumb(thumb) {
    const { docId, fileName, pages, bytes, objects } = get()
    if (!docId) return
    void touchRecent({
      id: docId, name: fileName, pageCount: pages.length,
      size: bytes?.length ?? 0, edits: objects.length, thumb,
    }).then(list => set({ recents: list }))
  },

  setTool(tool) {
    set(s => ({ tool, selection: tool === 'select' ? s.selection : [], editingTextId: null }))
  },
  setOption(k, v) {
    set(s => ({ options: { ...s.options, [k]: v } }))
    const { selection, objects } = get()
    if (!selection.length) return
    // editing a live selection should show the change immediately
    const map: Partial<Record<keyof ToolOptions, [AnyObj['kind'], string]>> = {
      textColor: ['text', 'color'], textSize: ['text', 'size'], textFont: ['text', 'font'],
      highlightColor: ['highlight', 'color'], highlightStyle: ['highlight', 'style'],
      drawColor: ['draw', 'color'], drawWidth: ['draw', 'width'], drawMode: ['draw', 'mode'],
      shapeColor: ['shape', 'color'], shapeFill: ['shape', 'fill'], shapeWidth: ['shape', 'width'],
      whiteoutColor: ['whiteout', 'color'],
    }
    const target = map[k]
    if (!target) return
    const [kind, prop] = target
    if (!objects.some(o => selection.includes(o.id) && o.kind === kind)) return
    get().mutate(d => {
      for (const o of d.objects) if (selection.includes(o.id) && o.kind === kind) (o as Record<string, unknown>)[prop] = v
    })
  },
  setZoom(zoom, fit) { set({ zoom: Math.min(6, Math.max(0.1, zoom)), fitMode: fit ?? 'custom' }) },
  setActivePage(activePage) { set({ activePage }) },
  setTheme(theme) {
    localStorage.setItem('pdfstudio.theme', theme)
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  setLines(page, lines) {
    set(s => ({ lines: { ...s.lines, [page]: lines }, linesLoading: { ...s.linesLoading, [page]: false } }))
  },
  setImages(page, images) {
    set(s => ({ images: { ...s.images, [page]: images } }))
  },
  markLinesLoading(page) { set(s => ({ linesLoading: { ...s.linesLoading, [page]: true } })) },

  select(selection) { set({ selection }) },
  toggleSelect(id) {
    set(s => ({ selection: s.selection.includes(id) ? s.selection.filter(x => x !== id) : [...s.selection, id] }))
  },
  setEditingText(editingTextId) { set({ editingTextId }) },

  begin() { if (!get().pending) set(s => ({ pending: snapshot(s) })) },
  commit() {
    const { pending } = get()
    if (!pending) return
    set(s => ({ past: [...s.past, pending].slice(-LIMIT), future: [], pending: null, dirty: true }))
  },

  mutate(fn, options) {
    const useHistory = options?.history !== false
    set(s => {
      const before = useHistory ? snapshot(s) : null
      const draft = { objects: [...s.objects], pages: [...s.pages] }
      fn(draft)
      return {
        objects: draft.objects,
        pages: draft.pages,
        dirty: true,
        past: before ? [...s.past, before].slice(-LIMIT) : s.past,
        future: before ? [] : s.future,
      }
    })
  },

  add(obj) {
    get().mutate(d => { d.objects.push(obj) })
    set({ selection: [obj.id] })
  },
  update(id, patch) {
    set(s => ({
      objects: s.objects.map(o => (o.id === id ? ({ ...o, ...patch } as AnyObj) : o)),
      dirty: true,
    }))
  },
  remove(ids) {
    if (!ids.length) return
    get().mutate(d => { d.objects = d.objects.filter(o => !ids.includes(o.id)) })
    set({ selection: [], editingTextId: null })
  },
  /** Delete on a replaced line means "make this text go away", so the first
   *  press empties it and leaves the patch covering the original. Press again
   *  and the patch goes too, which brings the original text back. */
  deleteSelection() {
    const { objects, selection } = get()
    const chosen = objects.filter(o => selection.includes(o.id))
    const clearable = chosen.filter(o => o.kind === 'text' && o.origin === 'replace' && o.text !== '')
    if (clearable.length) {
      const ids = clearable.map(o => o.id)
      get().mutate(d => {
        for (const o of d.objects) if (ids.includes(o.id) && o.kind === 'text') o.text = ''
      })
      set({ editingTextId: null })
      return
    }
    get().remove(selection)
  },

  duplicate(ids) {
    const copies = get().objects.filter(o => ids.includes(o.id)).map(o => ({
      ...structuredClone(o),
      id: uid(o.kind),
      rect: { ...o.rect, x: o.rect.x + 12, y: o.rect.y + 12 },
    }))
    if (!copies.length) return
    get().mutate(d => { d.objects.push(...copies) })
    set({ selection: copies.map(c => c.id) })
  },
  bring(id, dir) {
    get().mutate(d => {
      const i = d.objects.findIndex(o => o.id === id)
      if (i < 0) return
      const [obj] = d.objects.splice(i, 1)
      if (dir === 'front') d.objects.push(obj)
      else d.objects.unshift(obj)
    })
  },

  undo() {
    const { past, objects, pages } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set(s => ({
      objects: prev.objects,
      pages: prev.pages,
      past: past.slice(0, -1),
      future: [...s.future, { objects, pages }].slice(-LIMIT),
      selection: [],
      editingTextId: null,
      dirty: true,
    }))
  },
  redo() {
    const { future, objects, pages } = get()
    if (!future.length) return
    const next = future[future.length - 1]
    set(s => ({
      objects: next.objects,
      pages: next.pages,
      future: future.slice(0, -1),
      past: [...s.past, { objects, pages }].slice(-LIMIT),
      selection: [],
      dirty: true,
    }))
  },

  rotatePage(index, delta) {
    get().mutate(d => {
      const p = d.pages.find(p => p.index === index)
      if (p) p.userRotation = (((p.userRotation + delta) % 360) + 360) % 360
    })
  },
  deletePage(index) {
    if (get().pages.filter(p => !p.deleted).length <= 1) return
    get().mutate(d => {
      const p = d.pages.find(p => p.index === index)
      if (p) p.deleted = true
    })
  },
  movePage(from, to) {
    get().mutate(d => {
      const [p] = d.pages.splice(from, 1)
      d.pages.splice(to, 0, p)
    })
  },

  saveSignature(sig) {
    const full = { ...sig, id: uid('sig') }
    const signatures = [full, ...get().signatures].slice(0, 12)
    set({ signatures })
    void idbSet('signatures', signatures)
    return full
  },
  deleteSignature(id) {
    const signatures = get().signatures.filter(s => s.id !== id)
    set({ signatures })
    void idbSet('signatures', signatures)
  },
  async loadSignatures() {
    const sigs = await idbGet<SavedSignature[]>('signatures')
    if (sigs?.length) set({ signatures: sigs })
  },
}))

if (import.meta.env.DEV) {
  ;(window as unknown as { store: typeof useStore }).store = useStore
}

/** Autosave: debounced, silent, never blocks a keystroke, and flushed the
 *  moment the tab is hidden or another document is opened, so work is not lost
 *  in the gap between the last keystroke and the timer. */
let timer: number | undefined

function persist() {
  const { docId, fileName, objects, pages, bytes, pendingRestore } = useStore.getState()
  if (!docId) return
  // the first edit supersedes whatever the drawer was holding for this file
  if (pendingRestore) useStore.setState({ pendingRestore: null })
  void keepEdits(docId, { objects, pages })
  void touchRecent({
    id: docId, name: fileName, pageCount: pages.length,
    size: bytes?.length ?? 0, edits: objects.length,
  }).then(list => useStore.setState({ recents: list }))
}

export function flushEdits() {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
  persist()
}

useStore.subscribe(s => {
  if (!s.docId || !s.dirty) return
  clearTimeout(timer)
  timer = window.setTimeout(() => { timer = undefined; persist() }, 700)
})

window.addEventListener('pagehide', flushEdits)
window.addEventListener('beforeunload', flushEdits)
document.addEventListener('visibilitychange', () => { if (document.hidden) flushEdits() })

export const objectsOnPage = (objects: AnyObj[], page: number) => objects.filter(o => o.page === page)

export const selectionRect = (objects: AnyObj[], ids: string[]): Rect | null => {
  const sel = objects.filter(o => ids.includes(o.id))
  if (!sel.length) return null
  const x0 = Math.min(...sel.map(o => o.rect.x))
  const y0 = Math.min(...sel.map(o => o.rect.y))
  const x1 = Math.max(...sel.map(o => o.rect.x + o.rect.w))
  const y1 = Math.max(...sel.map(o => o.rect.y + o.rect.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
