/** Chip-style tag input: type + Enter adds, × removes, Backspace on empty removes the last one. */
import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { isComposing } from '../../lib/keys'

export function TagInput({ value, onChange, placeholder = '輸入後按 Enter 新增', disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (!t) return
    if (!value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) return
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 focus-within:border-accent">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent-bg px-1.5 py-0.5 text-xs text-accent">
          {t}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded hover:opacity-70" aria-label={`移除 ${t}`}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        disabled={disabled}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-secondary"
      />
    </div>
  )
}

/** Read-only chip list (aliases etc.). */
export function Chips({ items, empty = '—' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="text-xs text-secondary">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t) => <span key={t} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted">{t}</span>)}
    </span>
  )
}
