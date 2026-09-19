/** Small shared UI kit — flat, bordered, slate tokens. */
import { clsx } from 'clsx'
import { Loader2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type RefObject, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'good'
export function Button({ variant = 'default', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent border-accent text-on-accent hover:opacity-90',
        variant === 'default' && 'bg-canvas border-border hover:bg-background-lite',
        variant === 'ghost' && 'bg-transparent border-transparent hover:bg-background-lite',
        variant === 'danger' && 'bg-danger-bg border-transparent text-danger hover:opacity-80',
        variant === 'good' && 'bg-good-bg border-transparent text-good hover:opacity-80',
        className,
      )}
    >
      {loading && <Loader2 size={14} className="spin" />}
      {children}
    </button>
  )
}

/** A quiet square button holding one icon — toolbars, headers, menus. */
export function IconButton({ className, active, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-background-lite hover:text-primary', className)}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx('h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm outline-none focus:border-accent', className)} />
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx('w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent', className)} />
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={clsx('h-9 rounded-lg border border-border bg-canvas px-2 text-sm outline-none focus:border-accent', className)}>{children}</select>
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-secondary">{hint}</div>}
    </label>
  )
}

export function Badge({ tone = 'muted', children, className }: { tone?: 'muted' | 'good' | 'warn' | 'danger' | 'accent'; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4',
      tone === 'muted' && 'bg-background text-muted border border-border',
      tone === 'good' && 'bg-good-bg text-good', tone === 'warn' && 'bg-warn-bg text-warn',
      tone === 'danger' && 'bg-danger-bg text-danger', tone === 'accent' && 'bg-accent-bg text-accent', className)}>{children}</span>
  )
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-border bg-canvas', className)} style={{ boxShadow: 'var(--shadow-float)' }}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="text-sm font-semibold">{title}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

/**
 * Close an overlay on Escape and, when `inside` is given, on a pointer press
 * outside that element. Listens only while `active`; always calls the latest
 * `onClose`, so callers can pass inline arrows.
 */
export function useDismiss(active: boolean, onClose: () => void, inside?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    if (!active) return
    // Overlays stack (a confirm over a dialog): only the topmost one answers.
    const layerOf = (n: Element | null) => n?.closest('[data-overlay]') ?? null
    const onTop = () => {
      const el = inside?.current
      if (!el) return true
      const layers = document.querySelectorAll('[data-overlay]')
      return !layers.length || layers[layers.length - 1] === layerOf(el)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && onTop()) { e.preventDefault(); close.current() } }
    const onDown = (e: MouseEvent) => {
      const el = inside?.current
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return
      // A press inside another overlay (a confirm, a menu) is not a press outside this one.
      if (layerOf(e.target instanceof Element ? e.target : e.target.parentElement) !== layerOf(el)) return
      close.current()
    }
    window.addEventListener('keydown', onKey)
    if (inside) document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (inside) document.removeEventListener('mousedown', onDown)
    }
  }, [active, inside])
}

export function Modal({ open, onClose, title, subtitle, children, width = 520, padded = true }: {
  open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; padded?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  useDismiss(open, onClose, panel)
  if (!open) return null
  return (
    <div className="pg-fadein fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" data-overlay>
      <div ref={panel} className="pg-scalein flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-canvas" style={{ maxWidth: width, boxShadow: 'var(--shadow-popover)' }}>
        {title && (
          <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight">{title}</div>
              {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted hover:bg-background-lite hover:text-primary" aria-label="關閉"><X size={16} /></button>
          </header>
        )}
        <div className={clsx('min-h-0 flex-1 overflow-auto', padded && 'px-5 pb-5', padded && !title && 'pt-5')}>{children}</div>
      </div>
    </div>
  )
}

export const Spinner = ({ size = 16 }: { size?: number }) => <Loader2 size={size} className="spin text-muted" />
export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{children}</div>

/**
 * One empty state for the whole product: an icon, one sentence, at most one
 * action. Nothing else — an empty screen should feel like an invitation, not
 * an error.
 */
export function EmptyState({ icon, title, hint, action, className }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('pg-fadein flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-background-lite text-muted">{icon}</div>}
      <div className="text-[15px] font-medium tracking-tight text-primary">{title}</div>
      {hint && <div className="max-w-sm text-[13px] leading-5 text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** A loading placeholder shaped like the content it stands in for. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={clsx('pg-skeleton', className)} style={style} aria-hidden />
}

/* ---- toasts */
interface Toast { id: number; text: string; tone: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s, { id, text, tone }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'err' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* clear of the canvas toolbar (h-11 at bottom-4), so a toast never swallows a click on it */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div key={t.id} className={clsx('pg-risein pointer-events-auto rounded-full border px-4 py-2 text-[13px]', t.tone === 'err' ? 'border-danger/30 bg-danger-bg text-danger' : 'border-border bg-canvas text-primary')} style={{ boxShadow: 'var(--shadow-menu)' }}>{t.text}</div>
        ))}
      </div>
      <ConfirmHost />
    </ToastCtx.Provider>
  )
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/* ---- confirm dialog (styled, promise-based) */

export interface ConfirmOptions {
  title: string
  /** One short paragraph on what happens; omit when the title says it all. */
  body?: ReactNode
  /** The verb on the confirming button (default「確定」). */
  action?: string
  /** A second way to say yes, next to `action`; `confirm` then resolves to 'secondary'. */
  secondary?: string
  danger?: boolean
}

export type ConfirmAnswer = boolean | 'secondary'
type ConfirmRequest = ConfirmOptions & { resolve: (ok: ConfirmAnswer) => void }
let requestConfirm: ((r: ConfirmRequest) => void) | null = null

/**
 * A styled replacement for `window.confirm`: one title, one line, two
 * buttons, the dangerous one in red. Resolves to true when confirmed.
 */
export function confirm(opts: ConfirmOptions): Promise<ConfirmAnswer> {
  return new Promise((resolve) => {
    if (!requestConfirm) { resolve(window.confirm(opts.title)); return }
    requestConfirm({ ...opts, resolve })
  })
}

function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  useEffect(() => {
    requestConfirm = (r) => setReq((cur) => { cur?.resolve(false); return r })
    return () => { requestConfirm = null }
  }, [])
  const panel = useRef<HTMLDivElement>(null)
  const done = useCallback((ok: ConfirmAnswer) => { setReq((r) => { r?.resolve(ok); return null }) }, [])
  useDismiss(!!req, () => done(false), panel)
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); done(true) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req, done])
  if (!req) return null
  return (
    <div className="pg-fadein fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-4" data-overlay>
      <div ref={panel} role="alertdialog" className="pg-scalein w-full max-w-[360px] rounded-2xl border border-border bg-canvas p-5" style={{ boxShadow: 'var(--shadow-popover)' }}>
        <div className="text-[15px] font-semibold tracking-tight">{req.title}</div>
        {req.body && <div className="mt-1.5 text-[13px] leading-5 text-muted">{req.body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => done(false)}>取消</Button>
          {req.secondary && <Button variant="default" onClick={() => done('secondary')}>{req.secondary}</Button>}
          <Button variant={req.danger ? 'danger' : 'primary'} autoFocus onClick={() => done(true)}>{req.action ?? '確定'}</Button>
        </div>
      </div>
    </div>
  )
}

/** @deprecated the older pages still call the native dialog; new code uses `confirm()`. */
export function confirmDialog(text: string): boolean { return window.confirm(text) }
