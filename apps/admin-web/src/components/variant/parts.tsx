/** Quiet building blocks shared by the three variant stages. */
import { clsx } from 'clsx'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

/* ---- image zoom (the screenshot inside the sheet) */

const BASE_W = 380
/** Header + paddings + toolbar the image has to share the sheet with. */
const CHROME_H = 48 + 24 * 2 + 44 + 24

/**
 * Zoom for the screenshot editors. It starts at whatever fits the sheet's
 * height (a tall phone screenshot on a small display would otherwise run off
 * the bottom), and the −/+ buttons take it from there.
 */
export function useImageZoom(aspect: number) {
  const fit = useCallback(() => {
    const avail = window.innerHeight - CHROME_H
    return Math.max(0.4, Math.min(1, avail / (BASE_W / Math.max(aspect, 0.2))))
  }, [aspect])
  const [zoom, setZoom] = useState(fit)
  useEffect(() => { setZoom(fit()) }, [fit])
  useEffect(() => {
    const on = () => setZoom(fit())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [fit])
  return {
    zoom,
    width: Math.round(BASE_W * zoom),
    zoomIn: () => setZoom((z) => Math.min(2, z * 1.15)),
    zoomOut: () => setZoom((z) => Math.max(0.3, z / 1.15)),
    reset: () => setZoom(fit()),
  }
}

/**
 * The image column of a stage: the zoom control over the picture. The picture
 * sits right-aligned at its zoomed width; once that is wider than the column
 * the column scrolls sideways, so + keeps enlarging.
 */
export function ZoomedImage({ zoom, children }: { zoom: ReturnType<typeof useImageZoom>; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mx-auto mb-3 flex max-w-full justify-end md:mr-0" style={{ width: zoom.width }}>
        <ZoomControl zoom={zoom.zoom} onIn={zoom.zoomIn} onOut={zoom.zoomOut} onReset={zoom.reset} />
      </div>
      <div className="overflow-x-auto">
        <div className="mx-auto md:mr-0" style={{ width: zoom.width }}>{children}</div>
      </div>
    </div>
  )
}

export interface ToolOption<T extends string> { v: T; label: string; hint: string; color: string }

/**
 * The drawing tools as a vertical list: colour swatch, name, and one line on
 * what the colour means. The colour is the whole vocabulary of the image, so
 * the legend sits next to the control that picks it.
 */
export function ToolList<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: ToolOption<T>[]; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <div role="radiogroup" className="-mx-2 flex flex-col gap-0.5">
      {options.map((o) => {
        const on = o.v === value
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={clsx('flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50',
              on ? 'bg-background-lite' : 'hover:bg-background-lite')}
          >
            <span
              className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: o.color, boxShadow: on ? `0 0 0 2px var(--canvas), 0 0 0 4px ${o.color}` : undefined }}
            />
            <span className="min-w-0">
              <span className={clsx('block text-[13px] leading-5', on ? 'font-medium text-primary' : 'text-primary')}>{o.label}</span>
              <span className="block text-[12px] leading-[18px] text-secondary">{o.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** − 85% + — the percentage resets to the fitted size. */
export function ZoomControl({ zoom, onIn, onOut, onReset }: { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void }) {
  return (
    <div className="flex h-8 items-center rounded-full border border-border bg-canvas px-0.5 text-[12px] text-muted">
      <button type="button" onClick={onOut} title="縮小" className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-background-lite"><Minus size={12} /></button>
      <button type="button" onClick={onReset} title="縮放至剛好" className="h-6 w-12 rounded-full tabular-nums hover:bg-background-lite">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={onIn} title="放大" className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-background-lite"><Plus size={12} /></button>
    </div>
  )
}

/** Small pill switch — used for the theme and for the focus-box / tool types. */
export function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T
  options: { v: T; l: ReactNode }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={clsx(
            'h-7 rounded-full px-3 text-xs transition-colors disabled:opacity-50',
            value === o.v ? 'bg-canvas font-medium text-primary shadow-control' : 'text-muted hover:text-primary',
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

/** A text link that carries no visual weight. */
export function TextLink({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx('text-xs text-muted underline-offset-4 transition-colors hover:text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:hover:text-muted', className)}
    />
  )
}

/** Collapsed-by-default disclosure; the whole row is the toggle. */
export function Disclosure({ title, defaultOpen, children }: { title: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-2.5 text-left text-sm text-muted transition-colors hover:text-primary"
      >
        <ChevronRight size={13} className={clsx('shrink-0 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && <div className="pb-3 pl-5 text-sm">{children}</div>}
    </div>
  )
}

/** Red bullet list; renders nothing when there is nothing wrong. */
export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
      {items.map((p, i) => <li key={`${p}-${i}`}>{p}</li>)}
    </ul>
  )
}

/** Plain comma-free text list used inside the review disclosures. */
export function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-sm text-secondary">（無）</span>
  return (
    <ul className="space-y-1 text-sm">
      {items.map((t, i) => <li key={`${t}-${i}`} className="break-all text-primary">{t}</li>)}
    </ul>
  )
}
