import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({
  children, variant = 'ghost', size = 'md', className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'solid' | 'flare' | 'outline' | 'danger'
  size?: 'sm' | 'md'
}) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium whitespace-nowrap',
        'transition-colors duration-150 ease-[var(--ease-out-soft)] disabled:opacity-40',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3 text-sm',
        variant === 'ghost' && 'text-[var(--text)] hover:bg-[var(--color-ink-100)] dark:hover:bg-white/8',
        variant === 'outline' && 'hairline text-[var(--text)] hover:bg-[var(--color-ink-100)] dark:hover:bg-white/8',
        variant === 'solid' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'flare' && 'bg-flare-500 text-white hover:bg-flare-600',
        variant === 'danger' && 'text-red-600 hover:bg-red-500/10',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label, active, children, className, size = 'md', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={clsx(
        'group relative inline-flex items-center justify-center rounded-[var(--radius-sm)]',
        'transition-colors duration-150 ease-[var(--ease-out-soft)] disabled:opacity-35',
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
        active
          ? 'bg-brand-600 text-white'
          : 'text-[var(--text)] hover:bg-[var(--color-ink-100)] dark:hover:bg-white/10',
        className,
      )}
    >
      {children}
    </button>
  )
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block">
    <span className="mb-1.5 block text-[11px] font-semibold tracking-[0.06em] text-dim uppercase">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[11px] leading-snug text-dim">{hint}</span> : null}
  </label>
)

export function Slider({
  value, min, max, step = 1, onChange, suffix,
}: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-ink-200)] accent-[var(--color-brand-600)] dark:bg-white/15"
      />
      <span className="w-12 shrink-0 text-right font-mono text-[12px] text-dim tabular-nums">
        {Math.round(value * 10) / 10}{suffix}
      </span>
    </div>
  )
}

export function Segmented<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="hairline inline-flex w-full rounded-[var(--radius-sm)] p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          title={o.title ?? String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={clsx(
            'flex h-7 flex-1 items-center justify-center rounded-[4px] text-[12px] font-medium',
            'transition-colors duration-150',
            value === o.value ? 'bg-brand-600 text-white' : 'text-dim hover:text-[var(--text)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const SWATCHES = [
  '#16202a', '#ffffff', '#d63b2f', '#e8811c', '#ffe14d', '#3ba55d',
  '#2f6fd6', '#7a3fd6', '#e0559f', '#8a8f94',
]

export function ColorPicker({
  value, onChange, allowNone, swatches = SWATCHES,
}: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; swatches?: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone ? (
        <button
          onClick={() => onChange(null)}
          aria-label="No fill"
          title="No fill"
          className={clsx(
            'relative h-6 w-6 overflow-hidden rounded-full hairline transition-transform hover:scale-110',
            value === null && 'ring-2 ring-[var(--color-brand-600)] ring-offset-1 ring-offset-[var(--surface)]',
          )}
        >
          <span className="absolute top-1/2 left-1/2 h-[1.5px] w-8 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500" />
        </button>
      ) : null}
      {swatches.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
          title={c}
          style={{ background: c }}
          className={clsx(
            'h-6 w-6 rounded-full hairline transition-transform hover:scale-110',
            value?.toLowerCase() === c.toLowerCase() && 'ring-2 ring-[var(--color-brand-600)] ring-offset-1 ring-offset-[var(--surface)]',
          )}
        />
      ))}
      <label
        className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full hairline"
        title="Custom colour"
        style={{ background: 'conic-gradient(#d63b2f,#e8811c,#ffe14d,#3ba55d,#2f6fd6,#7a3fd6,#d63b2f)' }}
      >
        <input
          type="color"
          value={value ?? '#000000'}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Pick a custom colour"
        />
      </label>
    </div>
  )
}

export const Panel = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
    <header className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-bold tracking-[0.08em] text-dim uppercase">{title}</h3>
      {action}
    </header>
    <div className="space-y-3">{children}</div>
  </section>
)

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-[4px] border border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] text-dim">{children}</kbd>
)
