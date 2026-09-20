import { AlignCenter, AlignLeft, AlignRight, ArrowUpRight, Circle, Copy, Minus, MoveDown, MoveUp, RotateCcw, RotateCw, Square, Trash2 } from 'lucide-react'
import type { AnyObj, FontKey } from '../lib/types'
import { FONT_LABELS } from '../lib/css'
import { retypePatch } from '../lib/textops'
import { useStore } from '../lib/store'
import { Button, ColorPicker, Field, Panel, Segmented, Slider } from './ui'

const FONTS = Object.keys(FONT_LABELS) as FontKey[]

export function Inspector() {
  const objects = useStore(s => s.objects)
  const selection = useStore(s => s.selection)
  const tool = useStore(s => s.tool)
  const options = useStore(s => s.options)
  const setOption = useStore(s => s.setOption)
  const activePage = useStore(s => s.activePage)
  const pages = useStore(s => s.pages)
  const store = useStore.getState

  const selected = objects.filter(o => selection.includes(o.id))
  const one = selected.length === 1 ? selected[0] : null

  const patch = (p: Partial<AnyObj>) => {
    store().mutate(d => {
      for (const o of d.objects) if (selection.includes(o.id)) Object.assign(o, p)
    })
  }

  return (
    <aside className="surface flex w-[292px] shrink-0 flex-col overflow-y-auto border-l border-[var(--line)] no-scrollbar">
      {selected.length ? (
        <>
          <Panel title={one ? label(one) : `${selected.length} objects`}>
            {one?.kind === 'text' ? <TextProps obj={one} patch={patch} /> : null}
            {one?.kind === 'image' ? (
              <p className="text-[12px] leading-relaxed text-dim">
                Drag the corners to resize; hold Alt to stretch freely. Rotate with the handle above the box.
              </p>
            ) : null}
            {one?.kind === 'highlight' ? (
              <>
                <Field label="Style">
                  <Segmented
                    value={one.style}
                    onChange={v => patch({ style: v, opacity: v === 'highlight' ? 0.55 : 1 } as Partial<AnyObj>)}
                    options={[{ value: 'highlight', label: 'Highlight' }, { value: 'underline', label: 'Underline' }, { value: 'strike', label: 'Strike' }]}
                  />
                </Field>
                <Field label="Colour"><ColorPicker value={one.color} onChange={c => c && patch({ color: c } as Partial<AnyObj>)} /></Field>
              </>
            ) : null}
            {one?.kind === 'draw' ? (
              <>
                <Field label="Colour"><ColorPicker value={one.color} onChange={c => c && patch({ color: c } as Partial<AnyObj>)} /></Field>
                <Field label="Thickness"><Slider value={one.width} min={0.5} max={24} step={0.5} onChange={v => patch({ width: v } as Partial<AnyObj>)} suffix="pt" /></Field>
              </>
            ) : null}
            {one?.kind === 'shape' ? (
              <>
                <Field label="Stroke"><ColorPicker value={one.color} onChange={c => c && patch({ color: c } as Partial<AnyObj>)} /></Field>
                <Field label="Fill"><ColorPicker value={one.fill} allowNone onChange={c => patch({ fill: c } as Partial<AnyObj>)} /></Field>
                <Field label="Thickness"><Slider value={one.width} min={0.5} max={16} step={0.5} onChange={v => patch({ width: v } as Partial<AnyObj>)} suffix="pt" /></Field>
              </>
            ) : null}
            {one?.kind === 'whiteout' ? (
              <Field label="Colour" hint="Sampled from the page when you drew it. Adjust if the paper is tinted.">
                <ColorPicker value={one.color} onChange={c => c && patch({ color: c } as Partial<AnyObj>)} />
              </Field>
            ) : null}
          </Panel>

          <Panel title="Placement">
            <Field label="Opacity">
              <Slider value={(one?.opacity ?? 1) * 100} min={5} max={100} onChange={v => patch({ opacity: v / 100 })} suffix="%" />
            </Field>
            <Field label="Rotation">
              <Slider value={one?.rotation ?? 0} min={-180} max={180} onChange={v => patch({ rotation: v })} suffix="°" />
            </Field>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => one && store().bring(one.id, 'front')}><MoveUp size={14} /> Front</Button>
              <Button variant="outline" size="sm" onClick={() => one && store().bring(one.id, 'back')}><MoveDown size={14} /> Back</Button>
              <Button variant="outline" size="sm" onClick={() => store().duplicate(selection)}><Copy size={14} /> Duplicate</Button>
              <Button variant="danger" size="sm" onClick={() => store().deleteSelection()}><Trash2 size={14} /> Delete</Button>
            </div>
          </Panel>
        </>
      ) : (
        <ToolProps tool={tool} options={options} setOption={setOption} />
      )}

      <Panel title={`Page ${activePage}`}>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => store().rotatePage(activePage, -90)}><RotateCcw size={14} /> Rotate</Button>
          <Button variant="outline" size="sm" onClick={() => store().rotatePage(activePage, 90)}><RotateCw size={14} /> Rotate</Button>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          disabled={pages.filter(p => !p.deleted).length <= 1}
          onClick={() => store().deletePage(activePage)}
        >
          <Trash2 size={14} /> Delete this page
        </Button>
      </Panel>
    </aside>
  )
}

const label = (o: AnyObj) =>
  o.kind === 'text' ? (o.origin === 'replace' ? 'Replaced text' : 'Text box')
    : o.kind === 'image' ? 'Image'
      : o.kind === 'highlight' ? 'Markup'
        : o.kind === 'draw' ? 'Ink'
          : o.kind === 'shape' ? 'Shape'
            : 'Whiteout'

function TextProps({ obj, patch }: { obj: Extract<AnyObj, { kind: 'text' }>; patch: (p: Partial<AnyObj>) => void }) {
  const retype = (next: { size?: number; font?: FontKey }) => patch(retypePatch(obj, next) as Partial<AnyObj>)

  return (
    <>
      <Field label="Font">
        <select
          value={obj.font}
          onChange={e => retype({ font: e.target.value as FontKey })}
          className="surface-2 h-9 w-full rounded-[var(--radius-sm)] hairline px-2 text-[13px] outline-none focus:border-brand-500"
        >
          {FONTS.map(f => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
        </select>
      </Field>
      <Field label="Size"><Slider value={obj.size} min={4} max={96} step={0.5} onChange={v => retype({ size: v })} suffix="pt" /></Field>
      <Field label="Colour"><ColorPicker value={obj.color} onChange={c => c && patch({ color: c } as Partial<AnyObj>)} /></Field>
      <Field label="Alignment">
        <Segmented
          value={obj.align}
          onChange={v => patch({ align: v } as Partial<AnyObj>)}
          options={[
            { value: 'left', label: <AlignLeft size={14} />, title: 'Left' },
            { value: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
            { value: 'right', label: <AlignRight size={14} />, title: 'Right' },
          ]}
        />
      </Field>
      <Field label="Line spacing"><Slider value={obj.lineGap} min={0.8} max={2.4} step={0.05} onChange={v => patch({ lineGap: v } as Partial<AnyObj>)} /></Field>
      {obj.origin === 'replace' ? (
        <Field label="Cover colour" hint="The patch painted over the original glyphs. It was sampled from the page.">
          <ColorPicker value={obj.maskColor ?? '#ffffff'} onChange={c => c && patch({ maskColor: c } as Partial<AnyObj>)} />
        </Field>
      ) : null}
    </>
  )
}

function ToolProps({
  tool, options, setOption,
}: { tool: string; options: ReturnType<typeof useStore.getState>['options']; setOption: ReturnType<typeof useStore.getState>['setOption'] }) {
  if (tool === 'text') {
    return (
      <Panel title="Text">
        <p className="text-[12px] leading-relaxed text-dim">
          Click a line of the document to rewrite it in place, or drag anywhere to start a new box.
          In a table you get the single cell under the pointer; hold Alt to take the whole row.
        </p>
        <Field label="Font">
          <select
            value={options.textFont}
            onChange={e => setOption('textFont', e.target.value as FontKey)}
            className="surface-2 h-9 w-full rounded-[var(--radius-sm)] hairline px-2 text-[13px] outline-none focus:border-brand-500"
          >
            {FONTS.map(f => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
          </select>
        </Field>
        <Field label="Size"><Slider value={options.textSize} min={4} max={72} step={0.5} onChange={v => setOption('textSize', v)} suffix="pt" /></Field>
        <Field label="Colour"><ColorPicker value={options.textColor} onChange={c => c && setOption('textColor', c)} /></Field>
      </Panel>
    )
  }
  if (tool === 'highlight') {
    return (
      <Panel title="Markup">
        <p className="text-[12px] leading-relaxed text-dim">Drag across text and the marks snap to the lines underneath.</p>
        <Field label="Style">
          <Segmented
            value={options.highlightStyle}
            onChange={v => setOption('highlightStyle', v)}
            options={[{ value: 'highlight', label: 'Highlight' }, { value: 'underline', label: 'Underline' }, { value: 'strike', label: 'Strike' }]}
          />
        </Field>
        <Field label="Colour">
          <ColorPicker
            value={options.highlightColor}
            onChange={c => c && setOption('highlightColor', c)}
            swatches={['#ffe14d', '#9df5a3', '#8fd4ff', '#ffb0d8', '#ffc38a', '#d63b2f']}
          />
        </Field>
      </Panel>
    )
  }
  if (tool === 'draw') {
    return (
      <Panel title="Ink">
        <Field label="Nib">
          <Segmented
            value={options.drawMode}
            onChange={v => setOption('drawMode', v)}
            options={[{ value: 'pen', label: 'Pen' }, { value: 'marker', label: 'Marker' }]}
          />
        </Field>
        <Field label="Thickness"><Slider value={options.drawWidth} min={0.5} max={12} step={0.5} onChange={v => setOption('drawWidth', v)} suffix="pt" /></Field>
        <Field label="Colour"><ColorPicker value={options.drawColor} onChange={c => c && setOption('drawColor', c)} /></Field>
      </Panel>
    )
  }
  if (tool === 'shape') {
    return (
      <Panel title="Shape">
        <Field label="Kind">
          <Segmented
            value={options.shape}
            onChange={v => setOption('shape', v)}
            options={[
              { value: 'rect', label: <Square size={14} />, title: 'Rectangle' },
              { value: 'ellipse', label: <Circle size={14} />, title: 'Ellipse' },
              { value: 'line', label: <Minus size={14} />, title: 'Line' },
              { value: 'arrow', label: <ArrowUpRight size={14} />, title: 'Arrow' },
            ]}
          />
        </Field>
        <Field label="Stroke"><ColorPicker value={options.shapeColor} onChange={c => c && setOption('shapeColor', c)} /></Field>
        <Field label="Fill"><ColorPicker value={options.shapeFill} allowNone onChange={c => setOption('shapeFill', c)} /></Field>
        <Field label="Thickness"><Slider value={options.shapeWidth} min={0.5} max={16} step={0.5} onChange={v => setOption('shapeWidth', v)} suffix="pt" /></Field>
      </Panel>
    )
  }
  if (tool === 'whiteout') {
    return (
      <Panel title="Whiteout">
        <p className="text-[12px] leading-relaxed text-dim">
          Drag over anything you want gone. The patch colour is sampled from the paper around it.
        </p>
        <Field label="Colour">
          <ColorPicker
            value={options.whiteoutColor === 'auto' ? null : options.whiteoutColor}
            onChange={c => setOption('whiteoutColor', c ?? 'auto')}
            swatches={['#ffffff', '#fbfaf5', '#f2f2f2', '#000000']}
          />
        </Field>
        <Button variant="outline" size="sm" className="w-full" onClick={() => setOption('whiteoutColor', 'auto')}>
          Match the paper automatically
        </Button>
      </Panel>
    )
  }
  if (tool === 'erase') {
    return (
      <Panel title="Erase">
        <p className="text-[12px] leading-relaxed text-dim">
          Click or drag over your own edits to remove them. Click a line or a cell of the document itself and it is
          covered with its own paper colour, which is how text is deleted. Nothing is written until you save.
        </p>
      </Panel>
    )
  }
  return (
    <Panel title="Select">
      <p className="text-[12px] leading-relaxed text-dim">
        Click an edit to pick it up. Double click a line of the document to rewrite it. Shift click to select several.
      </p>
    </Panel>
  )
}
