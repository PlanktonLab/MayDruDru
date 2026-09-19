import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 顯示轉圈並自動 disable；同時掛上 `aria-busy`。 */
  loading?: boolean
  /** 佔滿一整列——行動版的主要動作幾乎都是這個。 */
  block?: boolean
  icon?: ReactNode
}

// sm 只用在桌面的工具列；行動版一律 md 以上，才守得住 44pt 觸控目標（SPEC §15.4）。
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 min-h-9 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-11 min-h-11 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-13 min-h-13 px-5 text-[16px] gap-2 rounded-2xl',
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent border-accent text-on-accent hover:opacity-90 active:opacity-80',
  secondary: 'bg-canvas border-border text-primary hover:bg-background-lite',
  ghost: 'bg-transparent border-transparent text-muted hover:bg-background-lite hover:text-primary',
  danger: 'bg-danger border-danger text-on-accent hover:opacity-90 active:opacity-80',
}

/**
 * 一個畫面一個主要動作（SPEC §15.1）：一頁最多一顆 `primary`。
 *
 * `loading` 期間按鈕仍然留在原位、文字不變，只多一個轉圈——避免版面跳動。
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap border font-medium',
        'transition-[opacity,background-color,border-color] outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        SIZES[size],
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
    >
      {loading ? (
        <Loader2 aria-hidden size={16} className="animate-spin" />
      ) : icon ? (
        <span aria-hidden className="flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  )
}
