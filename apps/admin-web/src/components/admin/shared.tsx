/** Small helpers shared by the admin pages (platforms / goals / members / api keys). */
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/* ---- plain table primitives (flat, bordered) */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto rounded-xl border border-border bg-canvas', className)} style={{ boxShadow: 'var(--shadow-float)' }}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('whitespace-nowrap border-b border-border bg-background-lite px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted', className)}>{children}</th>
)
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('border-b border-border px-3 py-2 align-middle', className)}>{children}</td>
)

/** Labeled key/value row used in read-only detail views. */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-2 py-1 text-sm">
      <div className="text-xs leading-5 text-muted">{label}</div>
      <div className="min-w-0 leading-5">{children}</div>
    </div>
  )
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'accent'; children: ReactNode }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2 text-xs leading-5',
      tone === 'muted' && 'border-border bg-background-lite text-muted',
      tone === 'warn' && 'border-transparent bg-warn-bg text-warn',
      tone === 'accent' && 'border-transparent bg-accent-bg text-accent')}>{children}</div>
  )
}
