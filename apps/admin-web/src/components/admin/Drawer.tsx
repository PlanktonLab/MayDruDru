import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Native modal keeps focus and keyboard interaction inside the top layer. */
export function Drawer({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    if (dialog?.showModal) dialog.showModal()
    else dialog?.setAttribute('open', '')
    return () => { dialog?.close?.(); if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return <dialog ref={ref} aria-labelledby={titleId} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-xl border-l border-border bg-canvas p-0 text-primary shadow-xl backdrop:bg-scrim">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-6">
        <div><h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
        <button type="button" aria-label="關閉" onClick={onClose} className="rounded-lg p-2 hover:bg-background-lite"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">{children}</div>
    </div>
  </dialog>
}
