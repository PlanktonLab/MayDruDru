import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { ToastContext, type ToastItem, type ToastTone } from './toastContext'

const TONES: Record<ToastTone, string> = {
  info: 'border-border bg-canvas text-primary',
  good: 'border-good/30 bg-good-bg text-good',
  danger: 'border-danger/30 bg-danger-bg text-danger',
}

/**
 * 短暫的提示。錯誤訊息留久一點（6 秒），因為使用者要讀完「怎麼修」。
 * 用 `aria-live="polite"`，不搶走正在進行的操作焦點。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<number[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = Date.now() + Math.random()
      setItems((current) => [...current, { id, text, tone }])
      timers.current.push(
        window.setTimeout(() => dismiss(id), tone === 'danger' ? 6000 : 3000),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const handles = timers.current
    return () => {
      for (const handle of handles) window.clearTimeout(handle)
    }
  }, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => dismiss(item.id)}
            className={cx(
              'pointer-events-auto max-w-sm rounded-full border px-4 py-2.5 text-left text-[14px]',
              TONES[item.tone],
            )}
            style={{ boxShadow: 'var(--shadow-menu)' }}
          >
            {item.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
