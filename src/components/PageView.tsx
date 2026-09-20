import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnyObj, PageImage, PageInfo, Pt, Rect, TextLine } from '../lib/types'
import { useStore } from '../lib/store'
import { buildLines, cropRegion, extractImages, extractRuns, renderPage, sampleColors } from '../lib/pdf'
import { HANDLES, type Handle, handleAnchor, hitTest, resizeRect, snapAngle } from '../lib/hit'
import { bboxOfStrokes, centre, clamp, padRect, pointInRect, rectFromPoints, rectsIntersect, rotatePoint, simplify, unionRects } from '../lib/geometry'
import { baselineOffset } from '../lib/css'
import { rotatedBounds } from '../lib/bounds'
import { uid } from '../lib/id'
import { ObjectView } from './ObjectView'
import { TextEditor } from './TextEditor'
import { ObjectToolbar } from './ObjectToolbar'

type Drag =
  | { mode: 'move'; ids: string[]; start: Pt; origins: Record<string, Pt> }
  | { mode: 'resize'; id: string; handle: Handle; rect: Rect; rotation: number }
  | { mode: 'rotate'; id: string; c: Pt; start: number; base: number }
  | { mode: 'create'; start: Pt; kind: 'highlight' | 'whiteout' | 'shape' | 'text' | 'marquee'; paper?: string }
  | { mode: 'draw'; points: Pt[] }
  | { mode: 'erase' }

export function PageView({ info, zoom, order }: { info: PageInfo; zoom: number; order: number }) {
  const proxy = useStore(s => s.proxy)
  const tool = useStore(s => s.tool)
  const options = useStore(s => s.options)
  const objects = useStore(s => s.objects)
  const selection = useStore(s => s.selection)
  const editingTextId = useStore(s => s.editingTextId)
  const lines = useStore(s => s.lines[info.index])
  const images = useStore(s => s.images[info.index])
  const store = useStore.getState

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasScale = useRef(1)
  const dragRef = useRef<Drag | null>(null)
  const linesJob = useRef<Promise<TextLine[]> | null>(null)
  const imagesJob = useRef<Promise<PageImage[]> | null>(null)

  const [visible, setVisible] = useState(order < 2)
  const [renderScale, setRenderScale] = useState(zoom)
  const [draft, setDraft] = useState<AnyObj | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [hoverLine, setHoverLine] = useState<TextLine | null>(null)
  const [hoverImage, setHoverImage] = useState<PageImage | null>(null)

  const rot = info.userRotation % 360
  const swap = rot === 90 || rot === 270
  const cssW = info.width * zoom
  const cssH = info.height * zoom
  const outerW = swap ? cssH : cssW
  const outerH = swap ? cssW : cssH

  const mine = useMemo(() => objects.filter(o => o.page === info.index), [objects, info.index])
  const needsText = tool === 'text' || tool === 'highlight' || tool === 'erase'

  /* ---------------------------------------------------------------- render */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) setVisible(true) },
      { root: null, rootMargin: '500px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [info.index])

  useEffect(() => {
    const t = setTimeout(() => setRenderScale(zoom), 180)
    return () => clearTimeout(t)
  }, [zoom])

  useEffect(() => {
    if (!proxy || !visible) return
    const signal = { cancelled: false }
    void (async () => {
      const page = await proxy.getPage(info.index)
      const result = await renderPage(page, Math.min(renderScale, 3), 0, signal)
      if (!result || signal.cancelled || !canvasHost.current) return
      result.canvas.style.width = '100%'
      result.canvas.style.height = '100%'
      result.canvas.style.display = 'block'
      canvasHost.current.replaceChildren(result.canvas)
      canvasRef.current = result.canvas
      canvasScale.current = result.scale
    })()
    return () => { signal.cancelled = true }
  }, [proxy, info.index, renderScale, visible])

  useEffect(() => {
    if (!proxy || !needsText || lines || !visible) return
    let alive = true
    void (async () => {
      useStore.getState().markLinesLoading(info.index)
      const page = await proxy.getPage(info.index)
      const runs = await extractRuns(page)
      if (alive) useStore.getState().setLines(info.index, buildLines(runs))
    })()
    return () => { alive = false }
  }, [proxy, needsText, lines, visible, info.index])

  /* ------------------------------------------------------------ geometry */
  const toPage = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const box = hostRef.current!.getBoundingClientRect()
    const ox = e.clientX - box.left
    const oy = e.clientY - box.top
    let ix = ox, iy = oy
    if (rot === 90) { ix = oy; iy = outerW - ox }
    else if (rot === 180) { ix = outerW - ox; iy = outerH - oy }
    else if (rot === 270) { ix = outerH - oy; iy = ox }
    return { x: ix / zoom, y: iy / zoom }
  }, [rot, outerW, outerH, zoom])

  const handleAt = useCallback((p: Pt): { id: string; handle: Handle } | null => {
    if (tool !== 'select' || selection.length !== 1) return null
    const obj = mine.find(o => o.id === selection[0])
    if (!obj) return null
    const r = 7 / zoom
    for (const h of [...HANDLES, 'rotate' as Handle]) {
      const anchor = h === 'rotate' ? { x: 0.5, y: 0 } : handleAnchor(h)
      const offset = h === 'rotate' ? -22 / zoom : 0
      const point = rotatePoint(
        { x: obj.rect.x + obj.rect.w * anchor.x, y: obj.rect.y + obj.rect.h * anchor.y + offset },
        centre(obj.rect),
        obj.rotation,
      )
      if (Math.hypot(point.x - p.x, point.y - p.y) <= r) return { id: obj.id, handle: h }
    }
    return null
  }, [tool, selection, mine, zoom])

  const lineAt = useCallback((p: Pt, wholeRow = false) => pickLine(lines, p, wholeRow), [lines])

  /** Text extraction is lazy, so a click may arrive before the index exists.
   *  This resolves it once and shares the same promise with every caller. */
  const ensureLines = useCallback(async (): Promise<TextLine[]> => {
    const cached = useStore.getState().lines[info.index]
    if (cached) return cached
    if (!linesJob.current && proxy) {
      linesJob.current = (async () => {
        useStore.getState().markLinesLoading(info.index)
        const page = await proxy.getPage(info.index)
        const built = buildLines(await extractRuns(page))
        useStore.getState().setLines(info.index, built)
        return built
      })()
    }
    return (await linesJob.current) ?? []
  }, [proxy, info.index])

  /* ------------------------------------------------------ object creation */
  /** The paper colour right under a point, used for previews and patches. */
  const paperAt = useCallback((p: Pt) => {
    if (!canvasRef.current) return '#ffffff'
    return sampleColors(canvasRef.current, canvasScale.current, { x: p.x - 8, y: p.y - 8, w: 16, h: 16 }).background
  }, [])

  /** Erasing on empty paper means the text of the document itself: the cell
   *  under the pointer is covered with a patch of its own paper colour. */
  const eraseDocumentText = useCallback(async (p: Pt) => {
    const line = pickLine(await ensureLines(), p)
    if (!line || !canvasRef.current) return
    const pad = Math.max(0.6, line.fontSize * 0.14)
    const rect: Rect = {
      x: line.rect.x - Math.max(0.4, line.padLeft),
      y: line.rect.y - pad,
      w: line.rect.w + Math.max(0.4, line.padLeft) + Math.max(0.4, line.padRight),
      h: line.rect.h + pad * 2,
    }
    const color = sampleColors(canvasRef.current, canvasScale.current, rotatedBounds(rect, centre(rect), line.angle)).background
    store().add({
      id: uid('wo'), kind: 'whiteout', page: info.index,
      rect, rotation: line.angle, opacity: 1, color,
    })
    store().setTool('erase')
  }, [ensureLines, info.index, store])

  const ensureImages = useCallback(async (): Promise<PageImage[]> => {
    const cached = useStore.getState().images[info.index]
    if (cached) return cached
    if (!imagesJob.current && proxy) {
      imagesJob.current = (async () => {
        const page = await proxy.getPage(info.index)
        const found = await extractImages(page)
        useStore.getState().setImages(info.index, found)
        return found
      })()
    }
    return (await imagesJob.current) ?? []
  }, [proxy, info.index])

  // the picture index is cheap and makes the hover affordance possible
  useEffect(() => {
    if (!proxy || !visible || images) return
    if (tool !== 'select' && tool !== 'erase') return
    void ensureImages()
  }, [proxy, visible, images, tool, ensureImages])

  /** A picture that is part of the document becomes one you can move: the area
   *  is lifted out of a high-resolution render, the original is covered with
   *  the paper around it, and what is left behind is an ordinary object. */
  const liftImage = useCallback(async (image: PageImage, mode: 'move' | 'erase') => {
    if (!proxy || !canvasRef.current) return
    const paper = sampleColors(canvasRef.current, canvasScale.current, padRect(image.rect, 6)).background
    if (mode === 'erase') {
      store().add({
        id: uid('wo'), kind: 'whiteout', page: info.index,
        rect: image.rect, rotation: 0, opacity: 1, color: paper,
      })
      return
    }
    const page = await proxy.getPage(info.index)
    const crop = await cropRegion(page, image.rect)
    if (!crop) return
    store().setTool('select')
    store().mutate(d => {
      d.objects.push({
        id: uid('wo'), kind: 'whiteout', page: info.index,
        rect: image.rect, rotation: 0, opacity: 1, color: paper,
      })
      d.objects.push({
        id: uid('image'), kind: 'image', page: info.index,
        rect: { ...image.rect }, rotation: 0, opacity: 1,
        src: crop.src, mime: 'image/png', naturalW: crop.w, naturalH: crop.h, role: 'image',
      })
    })
    const added = useStore.getState().objects
    store().select([added[added.length - 1].id])
  }, [proxy, info.index, store])

  const replaceLine = useCallback((line: TextLine) => {
    const size = Math.round(line.fontSize * 10) / 10
    const ascent = baselineOffset(line.font, size, line.source)
    const lineAscent = line.baseline - line.rect.y
    const w = Math.max(line.rect.w + size * 0.4, size * 2)
    const h = size * 1.25
    // `angle` is already clockwise-on-screen, the same convention objects use
    const angle = line.angle
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)

    // place the box so that rotating it around its own centre lands the first
    // baseline exactly on the baseline of the line being replaced
    const origin = { x: line.runs[0].x, y: line.baseline }
    const lx = w / 2, ly = h / 2 - ascent
    const rect: Rect = {
      x: origin.x + lx * cos - ly * sin - w / 2,
      y: origin.y + lx * sin + ly * cos - h / 2,
      w, h,
    }
    // the patch covers this cell and at most half of each gutter beside it
    const vpad = Math.max(0.6, line.fontSize * 0.14)
    const left = Math.max(0.4, line.padLeft)
    const right = Math.max(0.4, line.padRight)
    const mask: Rect = {
      x: rect.x - left,
      y: rect.y + ascent - lineAscent - vpad,
      w: line.rect.w + left + right,
      h: line.rect.h + vpad * 2,
    }
    const sampled = sampleColors(canvasRef.current!, canvasScale.current, rotatedBounds(mask, centre(rect), angle))

    const obj: AnyObj = {
      id: uid('text'),
      kind: 'text',
      page: info.index,
      rect,
      rotation: angle,
      opacity: 1,
      text: line.text,
      font: line.font,
      size,
      color: sampled.ink,
      align: 'left',
      lineGap: 1.18,
      origin: 'replace',
      source: line.source,
      mask,
      maskColor: sampled.background,
    }
    store().setTool('select')
    store().add(obj)
    store().setEditingText(obj.id)
  }, [info.index, store])

  const newTextBox = useCallback((rect: Rect) => {
    const size = options.textSize
    const obj: AnyObj = {
      id: uid('text'),
      kind: 'text',
      page: info.index,
      rect: { x: rect.x, y: rect.y, w: Math.max(rect.w, size * 8), h: Math.max(rect.h, size * 1.3) },
      rotation: 0,
      opacity: 1,
      text: '',
      font: options.textFont,
      size,
      color: options.textColor,
      align: 'left',
      lineGap: 1.25,
      origin: 'new',
    }
    store().setTool('select')
    store().add(obj)
    store().setEditingText(obj.id)
  }, [info.index, options, store])

  const highlightRects = useCallback((area: Rect): Rect[] => {
    const hits = (lines ?? []).filter(l => rectsIntersect(l.rect, area))
    if (!hits.length) return [area]
    return hits.map(l => {
      const x0 = Math.max(l.rect.x, hits.length > 1 && l !== hits[0] ? l.rect.x : area.x)
      const x1 = Math.min(l.rect.x + l.rect.w, hits.length > 1 && l !== hits[hits.length - 1] ? l.rect.x + l.rect.w : area.x + area.w)
      const pad = l.fontSize * 0.12
      return { x: Math.min(x0, x1 - 1), y: l.rect.y - pad, w: Math.max(2, x1 - x0), h: l.rect.h + pad * 2 }
    })
  }, [lines])

  /* -------------------------------------------------------------- pointer */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-editor]') || target.closest('[data-ui]')) return
    const p = toPage(e)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* no capture, the window still gets the moves */ }

    const grab = handleAt(p)
    if (grab) {
      const obj = mine.find(o => o.id === grab.id)!
      store().begin()
      dragRef.current = grab.handle === 'rotate'
        ? { mode: 'rotate', id: obj.id, c: centre(obj.rect), start: Math.atan2(p.y - centre(obj.rect).y, p.x - centre(obj.rect).x) * 180 / Math.PI, base: obj.rotation }
        : { mode: 'resize', id: obj.id, handle: grab.handle, rect: obj.rect, rotation: obj.rotation }
      return
    }

    if (tool === 'erase') {
      const hit = hitTest(mine, info.index, p, 4 / zoom)
      if (hit) store().remove([hit.id])
      else {
        const picture = (images ?? []).find(im => pointInRect(p, im.rect))
        if (picture) void liftImage(picture, 'erase')
        else void eraseDocumentText(p)
      }
      dragRef.current = { mode: 'erase' }
      return
    }

    if (tool === 'select' || tool === 'text') {
      const hit = hitTest(mine, info.index, p, 3 / zoom)
      if (hit) {
        const ids = e.shiftKey
          ? selection.includes(hit.id) ? selection.filter(i => i !== hit.id) : [...selection, hit.id]
          : selection.includes(hit.id) ? selection : [hit.id]
        store().select(ids)
        if (tool === 'text' && hit.kind === 'text') { store().setTool('select'); store().select([hit.id]); store().setEditingText(hit.id); return }
        store().begin()
        dragRef.current = {
          mode: 'move',
          ids,
          start: p,
          origins: Object.fromEntries(mine.filter(o => ids.includes(o.id)).map(o => [o.id, { x: o.rect.x, y: o.rect.y }])),
        }
        return
      }
      if (tool === 'text') {
        dragRef.current = { mode: 'create', start: p, kind: 'text' }
        return
      }
      store().select([])
      store().setEditingText(null)
      dragRef.current = { mode: 'create', start: p, kind: 'marquee' }
      return
    }

    if (tool === 'draw') {
      dragRef.current = { mode: 'draw', points: [p] }
      setDraft({
        id: 'draft', kind: 'draw', page: info.index, rect: { x: 0, y: 0, w: info.width, h: info.height },
        rotation: 0, opacity: 1, strokes: [[p]],
        color: options.drawColor,
        width: options.drawMode === 'marker' ? options.drawWidth * 4 : options.drawWidth,
        mode: options.drawMode,
      })
      return
    }

    if (tool === 'highlight' || tool === 'whiteout' || tool === 'shape') {
      const paper = tool === 'whiteout' ? paperAt(p) : undefined
      dragRef.current = { mode: 'create', start: p, kind: tool, paper }
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPage(e)
    const drag = dragRef.current

    if (!drag) {
      if (tool === 'text' || tool === 'erase') setHoverLine(lineAt(p, e.altKey))
      if (tool === 'select' || tool === 'erase') {
        const over = hitTest(mine, info.index, p, 3 / zoom)
          ? null
          : (images ?? []).find(im => pointInRect(p, im.rect)) ?? null
        setHoverImage(over)
      }
      return
    }

    switch (drag.mode) {
      case 'move': {
        const dx = p.x - drag.start.x
        const dy = p.y - drag.start.y
        const snap = e.shiftKey
        for (const id of drag.ids) {
          const o = drag.origins[id]
          store().update(id, {
            rect: {
              ...mine.find(m => m.id === id)!.rect,
              x: o.x + (snap && Math.abs(dx) < Math.abs(dy) ? 0 : dx),
              y: o.y + (snap && Math.abs(dy) <= Math.abs(dx) ? 0 : dy),
            },
          })
        }
        break
      }
      case 'resize': {
        const obj = mine.find(o => o.id === drag.id)
        if (!obj) break
        const keepAspect = obj.kind === 'image' ? !e.altKey : e.shiftKey
        const rect = resizeRect(drag.rect, drag.rotation, drag.handle, p, keepAspect)
        if (obj.kind === 'text' && drag.handle.length === 2) {
          // corner drag on text scales the type, edge drags only reflow the box
          const factor = rect.h / Math.max(1e-3, drag.rect.h)
          store().update(obj.id, { rect, size: clamp(Math.round(obj.size * factor * 10) / 10, 3, 400) } as Partial<AnyObj>)
        } else {
          store().update(obj.id, { rect })
        }
        break
      }
      case 'rotate': {
        const now = Math.atan2(p.y - drag.c.y, p.x - drag.c.x) * 180 / Math.PI
        const next = drag.base + (now - drag.start)
        store().update(drag.id, { rotation: e.shiftKey ? snapAngle(next) : Math.round(next) })
        break
      }
      case 'draw': {
        drag.points.push(p)
        setDraft(d => (d && d.kind === 'draw' ? { ...d, strokes: [[...drag.points]] } : d))
        break
      }
      case 'erase': {
        const hit = hitTest(mine, info.index, p, 4 / zoom)
        if (hit) store().remove([hit.id])
        break
      }
      case 'create': {
        const rect = rectFromPoints(drag.start, p)
        if (drag.kind === 'marquee') { setMarquee(rect); break }
        if (drag.kind === 'text') { setMarquee(rect); break }
        if (drag.kind === 'highlight') {
          setDraft({
            id: 'draft', kind: 'highlight', page: info.index, rect, rotation: 0,
            opacity: options.highlightStyle === 'highlight' ? 0.55 : 1,
            color: options.highlightColor, rects: highlightRects(rect), style: options.highlightStyle,
          })
          break
        }
        if (drag.kind === 'whiteout') {
          setDraft({ id: 'draft', kind: 'whiteout', page: info.index, rect, rotation: 0, opacity: 1, color: drag.paper ?? '#ffffff' })
          break
        }
        setDraft({
          id: 'draft', kind: 'shape', page: info.index,
          rect: options.shape === 'line' || options.shape === 'arrow' ? { x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y } : rect,
          rotation: 0, opacity: 1,
          shape: options.shape, color: options.shapeColor, fill: options.shapeFill, width: options.shapeWidth,
        })
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    const p = toPage(e)

    if (!drag) return
    if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'rotate') { store().commit(); return }

    if (drag.mode === 'draw') {
      const points = simplify(drag.points, 0.4)
      setDraft(null)
      if (points.length < 2 && drag.points.length < 2) return
      const strokes = [points]
      const width = options.drawMode === 'marker' ? options.drawWidth * 4 : options.drawWidth
      store().add({
        id: uid('draw'), kind: 'draw', page: info.index,
        rect: bboxOfStrokes(strokes, width), rotation: 0, opacity: 1,
        strokes, color: options.drawColor, width, mode: options.drawMode,
      })
      return
    }

    if (drag.mode === 'create') {
      const rect = rectFromPoints(drag.start, p)
      const tiny = rect.w < 3 && rect.h < 3
      setDraft(null)
      setMarquee(null)

      if (drag.kind === 'marquee') {
        if (tiny) return
        const ids = mine.filter(o => rectsIntersect(o.rect, rect)).map(o => o.id)
        store().select(ids)
        return
      }
      if (drag.kind === 'text') {
        if (!tiny) { newTextBox(rect); return }
        const wholeRow = e.altKey
        void ensureLines().then(ls => {
          const line = pickLine(ls, p, wholeRow)
          if (line && canvasRef.current) replaceLine(line)
          else newTextBox({ ...rect, w: 0, h: 0 })
        })
        return
      }
      if (tiny) return

      if (drag.kind === 'highlight') {
        const rects = highlightRects(rect)
        store().add({
          id: uid('hl'), kind: 'highlight', page: info.index, rect: unionRects(rects), rotation: 0,
          opacity: options.highlightStyle === 'highlight' ? 0.55 : 1,
          color: options.highlightColor, rects, style: options.highlightStyle,
        })
        return
      }
      if (drag.kind === 'whiteout') {
        const sampled = canvasRef.current ? sampleColors(canvasRef.current, canvasScale.current, padRect(rect, 2)).background : '#ffffff'
        store().add({
          id: uid('wo'), kind: 'whiteout', page: info.index, rect, rotation: 0, opacity: 1,
          color: options.whiteoutColor === 'auto' ? sampled : options.whiteoutColor,
        })
        return
      }
      store().add({
        id: uid('shape'), kind: 'shape', page: info.index,
        rect: options.shape === 'line' || options.shape === 'arrow'
          ? { x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y }
          : rect,
        rotation: 0, opacity: 1,
        shape: options.shape, color: options.shapeColor, fill: options.shapeFill, width: options.shapeWidth,
      })
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toPage(e)
    const hit = hitTest(mine, info.index, p, 3 / zoom)
    if (hit?.kind === 'text') { store().setEditingText(hit.id); return }
    const wholeRow = e.altKey
    void ensureLines().then(async ls => {
      const line = pickLine(ls, p, wholeRow)
      if (line && canvasRef.current) { replaceLine(line); return }
      // no text here: a picture of the document may be, and that can be lifted
      const picture = (await ensureImages()).find(im => pointInRect(p, im.rect))
      if (picture) void liftImage(picture, 'move')
    })
  }

  const cursor =
    tool === 'draw' ? 'crosshair'
      : tool === 'text' ? 'text'
        : tool === 'erase' ? 'cell'
          : tool === 'select' ? 'default'
            : 'crosshair'

  const selected = mine.filter(o => selection.includes(o.id))
  const editing = editingTextId ? mine.find(o => o.id === editingTextId) : null

  return (
    <div
      ref={hostRef}
      data-page={info.index}
      className="relative shrink-0 select-none bg-white page-shadow"
      style={{ width: outerW, height: outerH, cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerLeave={() => { setHoverLine(null); setHoverImage(null) }}
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width: cssW,
          height: cssH,
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        }}
      >
        <div ref={canvasHost} className="absolute inset-0 bg-white" />

        {(tool === 'text' || tool === 'erase') && hoverLine ? (
          <div
            className={tool === 'erase'
              ? 'pointer-events-none absolute rounded-[2px] border border-dashed border-red-500/80 bg-red-500/10'
              : 'pointer-events-none absolute rounded-[2px] border border-dashed border-brand-600/70 bg-brand-500/8'}
            style={{
              left: hoverLine.rect.x * zoom - 2,
              top: hoverLine.rect.y * zoom - 2,
              width: hoverLine.rect.w * zoom + 4,
              height: hoverLine.rect.h * zoom + 4,
              transform: hoverLine.angle ? `rotate(${hoverLine.angle}deg)` : undefined,
              transformOrigin: `${(hoverLine.runs[0].x - hoverLine.rect.x) * zoom + 2}px ${(hoverLine.baseline - hoverLine.rect.y) * zoom + 2}px`,
            }}
          />
        ) : null}

        {hoverImage && !hoverLine ? (
          <div
            className={tool === 'erase'
              ? 'pointer-events-none absolute rounded-[3px] border border-dashed border-red-500/80 bg-red-500/10'
              : 'pointer-events-none absolute rounded-[3px] border border-dashed border-brand-500/80 bg-brand-500/8'}
            style={{
              left: hoverImage.rect.x * zoom,
              top: hoverImage.rect.y * zoom,
              width: hoverImage.rect.w * zoom,
              height: hoverImage.rect.h * zoom,
            }}
          >
            <span className="absolute -top-6 left-0 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-dim hairline">
              {tool === 'erase' ? 'Click to remove this picture' : 'Double click to pick it up'}
            </span>
          </div>
        ) : null}

        {mine.map(o => (
          <ObjectView key={o.id} obj={o} zoom={zoom} muted={editingTextId === o.id} />
        ))}
        {draft ? <ObjectView obj={draft} zoom={zoom} draft /> : null}

        {selected.map(o => (
          <SelectionFrame key={o.id} obj={o} zoom={zoom} single={selected.length === 1 && tool === 'select'} />
        ))}

        {marquee ? (
          <div
            className="pointer-events-none absolute border border-brand-600 bg-brand-500/10"
            style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }}
          />
        ) : null}

        {editing && editing.kind === 'text' ? <TextEditor obj={editing} zoom={zoom} /> : null}

        {selected.length === 1 && !draft && !marquee ? (
          <ObjectToolbar obj={selected[0]} zoom={zoom} pageRotation={rot} pageWidth={cssW} />
        ) : null}
      </div>

      <span className="pointer-events-none absolute -top-6 left-0 text-[11px] font-medium text-dim">
        {order + 1}
      </span>
    </div>
  )
}

const covers = (l: TextLine, p: Pt) => {
  // slanted lines are tested in their own frame, pivoting on the baseline origin
  const q = l.angle ? rotatePoint(p, { x: l.runs[0].x, y: l.baseline }, -l.angle) : p
  return q.x >= l.rect.x - 2 && q.x <= l.rect.x + l.rect.w + 2 &&
    q.y >= l.rect.y - 2 && q.y <= l.rect.y + l.rect.h + 2
}

/** What a click on the document means. A row that was split at its column
 *  gutters answers with the cell under the pointer, so editing one figure in a
 *  table leaves the rest of the row alone. Hold Alt for the whole row. */
const pickLine = (lines: TextLine[] | undefined, p: Pt, wholeRow = false): TextLine | null => {
  const row = lines?.find(l => covers(l, p))
  if (!row) return null
  if (wholeRow || !row.cells.length) return row
  return row.cells.find(c => covers(c, p)) ?? row
}

function SelectionFrame({ obj, zoom, single }: { obj: AnyObj; zoom: number; single: boolean }) {
  const { rect, rotation } = obj
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <div className="absolute inset-0 border border-brand-600" />
      {single ? (
        <>
          {HANDLES.map(h => {
            const a = handleAnchor(h)
            return (
              <span
                key={h}
                className="absolute h-2.5 w-2.5 rounded-[2px] border border-brand-600 bg-white shadow-sm"
                style={{ left: `calc(${a.x * 100}% - 5px)`, top: `calc(${a.y * 100}% - 5px)` }}
              />
            )
          })}
          <span className="absolute left-1/2 h-5 w-px -translate-x-1/2 bg-brand-600" style={{ top: -22 }} />
          <span className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-brand-600 bg-white" style={{ top: -28 }} />
        </>
      ) : null}
    </div>
  )
}
