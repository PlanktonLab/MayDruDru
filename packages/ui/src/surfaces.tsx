import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'

export interface CardProps {
  title?: ReactNode
  /** 標題下面一行的說明。 */
  subtitle?: ReactNode
  /** 標題右邊的動作區。 */
  actions?: ReactNode
  footer?: ReactNode
  padded?: boolean
  className?: string
  children?: ReactNode
}

/** 內容在前、介面退後（SPEC §15.2）：一張卡就是一段內容，不要巢狀。 */
export function Card({ title, subtitle, actions, footer, padded = true, className, children }: CardProps) {
  return (
    <section
      className={cx('rounded-2xl border border-border bg-canvas', className)}
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className={cx(padded && 'p-4 sm:p-5', padded && (title || actions) && 'pt-3 sm:pt-3')}>{children}</div>}
      {footer && <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  )
}

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-background text-muted',
  accent: 'border-transparent bg-accent-bg text-accent',
  good: 'border-transparent bg-good-bg text-good',
  warn: 'border-transparent bg-warn-bg text-warn',
  danger: 'border-transparent bg-danger-bg text-danger',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium leading-5',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cx('inline-flex items-center gap-2 text-muted', className)}>
      <Loader2 aria-hidden size={size} className="animate-spin" />
      {label ? <span className="text-[13px]">{label}</span> : <span className="sr-only">載入中</span>}
    </span>
  )
}

/** 空畫面是邀請，不是錯誤：一個圖示、一句話、最多一個動作。 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {icon && (
        <div aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-full bg-background-lite text-muted">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-medium tracking-tight text-primary">{title}</p>
      {hint && <p className="max-w-sm text-[14px] leading-6 text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
