import { Eraser, Highlighter, Image as ImageIcon, MousePointer2, PenLine, PenTool, Square, SquareDashed, Type } from 'lucide-react'
import type { ToolId } from '../lib/types'
import { useStore } from '../lib/store'
import { IconButton } from './ui'

export const TOOLS: { id: ToolId; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: <MousePointer2 size={18} /> },
  { id: 'text', label: 'Edit or add text', key: 'T', icon: <Type size={18} /> },
  { id: 'highlight', label: 'Highlight, underline, strike', key: 'H', icon: <Highlighter size={18} /> },
  { id: 'draw', label: 'Draw freehand', key: 'D', icon: <PenLine size={18} /> },
  { id: 'signature', label: 'Signature', key: 'S', icon: <PenTool size={18} /> },
  { id: 'image', label: 'Place an image', key: 'I', icon: <ImageIcon size={18} /> },
  { id: 'shape', label: 'Shapes and arrows', key: 'R', icon: <Square size={18} /> },
  { id: 'whiteout', label: 'Whiteout', key: 'W', icon: <SquareDashed size={18} /> },
  { id: 'erase', label: 'Erase your edits', key: 'E', icon: <Eraser size={18} /> },
]

export function ToolRail({ onPickImage, onSignature }: { onPickImage: () => void; onSignature: () => void }) {
  const tool = useStore(s => s.tool)
  const setTool = useStore(s => s.setTool)

  return (
    <nav aria-label="Tools" className="surface flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--line)] py-3">
      {TOOLS.map(t => (
        <IconButton
          key={t.id}
          label={`${t.label} (${t.key})`}
          active={tool === t.id}
          onClick={() => {
            if (t.id === 'image') { onPickImage(); return }
            if (t.id === 'signature') { onSignature(); return }
            setTool(t.id)
          }}
        >
          {t.icon}
        </IconButton>
      ))}
    </nav>
  )
}
