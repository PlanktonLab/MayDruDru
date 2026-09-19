import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  /** 底部的動作列；主要動作放最右邊。 */
  footer?: ReactNode
  /** 最大寬度（px）。行動版一律滿版。 */
  width?: number
  children: ReactNode
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 用原生 `<dialog>`：backdrop、inert 背景、Esc 關閉都由瀏覽器負責，
 * 我們只補兩件事——把 Esc 導回 `onClose`（而不是讓 dialog 自己關掉、狀態卻沒更新），
 * 以及把 Tab 圈在對話框裡（jsdom 與少數瀏覽器不會自己做）。
 */
export function Modal({ open, onClose, title, subtitle, footer, width = 520, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // 瀏覽器走 showModal（backdrop + 背景 inert）；jsdom 沒實作 dialog 的開關方法，
      // 退回直接操作 `open` 屬性，測試才跑得動。
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else if (typeof dialog.show === 'function') dialog.show()
      else dialog.open = true
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.open = false
    }
  }, [open])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === 'Escape') {
        // 預設行為會直接關掉 dialog，但 React 的 `open` 還是 true，下次就打不開了。
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === event.currentTarget)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className={cx(
        'w-[calc(100vw-2rem)] max-w-none rounded-2xl border border-border bg-canvas p-0 text-primary',
        'backdrop:bg-scrim open:flex open:flex-col',
        'max-h-[85vh] overflow-hidden',
        className,
      )}
      style={{ maxWidth: width, boxShadow: 'var(--shadow-popover)' }}
    >
      {(title || subtitle) && (
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-background-lite hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden size={18} />
          </button>
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[15px] leading-relaxed">{children}</div>
      {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </dialog>
  )
}
