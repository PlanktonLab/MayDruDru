/** Quiet inspector primitives: label-less inputs that save on blur / Enter. */

import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { useInlineEdit } from './useInlineEdit'

export function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      {label && <div className="mb-1.5 text-[11px] font-medium text-muted">{label}</div>}
      {children}
    </div>
  )
}

interface TextFieldProps {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  disabled?: boolean
  multiline?: boolean
  rows?: number
  /** Shows a quiet counter; over the limit it turns red (the text is still saved). */
  maxLen?: number
  /** An empty value is not saved (the field snaps back). */
  required?: boolean
  className?: string
}

/** Inspector text field: keeps a local draft, commits on blur / Enter, Escape discards. */
export function TextField({ value, onSave, placeholder, disabled, multiline, rows = 3, maxLen, required, className }: TextFieldProps) {
  const base = 'w-full rounded-lg border border-border bg-canvas px-2.5 text-[13px] outline-none transition-colors focus:border-accent disabled:opacity-60'
  const { bind, draft } = useInlineEdit({ value, onCommit: onSave, allowEmpty: !required, multiline })

  return (
    <div className="relative">
      {multiline ? (
        <textarea {...bind} rows={rows} disabled={disabled} placeholder={placeholder} className={clsx(base, 'resize-none py-2 leading-5', className)} />
      ) : (
        <input {...bind} disabled={disabled} placeholder={placeholder} className={clsx(base, 'h-8', className)} />
      )}
      {maxLen !== undefined && (
        <div className={clsx('mt-1 text-right text-[11px] tabular-nums', draft.length > maxLen ? 'text-danger' : 'text-secondary')}>
          {draft.length}/{maxLen}
        </div>
      )}
    </div>
  )
}

/** The inspector's one select style (flow goal, platform channel, component kind). */
export function Picker({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; children: ReactNode; className?: string
}) {
  return (
    <select
      value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className={clsx('h-8 w-full rounded-lg border border-border bg-canvas px-2 text-[13px] outline-none focus:border-accent disabled:opacity-60', className)}
    >
      {children}
    </select>
  )
}

/** The toggle on its own, for rows that carry their own label (示範資料). */
export function Toggle({ checked, disabled, onChange, label, title }: {
  checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label?: string; title?: string
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} title={title} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-tertiary')}
    >
      <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all" style={{ left: checked ? 16 : 2 }} />
    </button>
  )
}

export function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={clsx('flex items-center justify-between text-[13px]', disabled && 'opacity-60')}>
      {label}
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </label>
  )
}

export function KeyValue({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[13px]">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}
