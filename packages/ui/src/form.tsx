import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'

/* 輸入框是「填色 + 透明框線」而不是「白底 + 灰框線」：整排欄位看起來是一片安靜的
   淺灰塊，只有正在填的那一格浮起來（框線轉 accent、外圈一圈淡光）。
   `--field` 在 tokens.css 定義，深色模式會換成深一階的底色。 */
const CONTROL =
  'w-full rounded-xl border border-transparent bg-[var(--field)] px-3.5 text-[16px] text-primary outline-none ' +
  'transition-colors placeholder:text-secondary ' +
  'focus-visible:border-accent focus-visible:bg-canvas focus-visible:ring-2 focus-visible:ring-accent/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger'

// 行動版的輸入框字級固定 16px：小於 16px 時 iOS Safari 會自動放大整頁。
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, 'h-[46px]', className)} />
}

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} rows={rows} className={cx(CONTROL, 'py-3 leading-relaxed', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, 'h-[46px] pr-8', className)}>
      {children}
    </select>
  )
}

export interface FieldProps {
  label: string
  /** 填寫說明；錯誤發生時由 `error` 取代。 */
  hint?: string
  /** 一句「怎麼修」，不是「錯在哪」（SPEC §15.5）。 */
  error?: string
  required?: boolean
  className?: string
  /** 拿到 id 與 aria 屬性後掛到實際的控制項上。 */
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

/** 標籤、控制項、說明或錯誤——三件事永遠上下排，不並排（SPEC §15.8 行動優先）。 */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[12px] font-medium text-muted">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-label="必填">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': message ? messageId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {message && (
        // 錯誤要當場被螢幕閱讀器念出來；提示文字則只是靜態說明，不該打斷人。
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cx('text-[13px] leading-5', error ? 'text-danger' : 'text-muted')}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode
  /** 補充說明，放在標籤下面一行。 */
  description?: ReactNode
}

/**
 * 整塊（含文字）都可以點，觸控目標遠大於 44pt；原生 checkbox 留在 DOM 裡但視覺隱藏，
 * 所以鍵盤與螢幕閱讀器行為完全照舊。
 */
export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  return (
    <label
      className={cx(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-1 text-[15px] leading-relaxed',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
        rest.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input {...rest} type="checkbox" className="peer sr-only" />
      {/* 打勾用 currentColor：未勾選時整個方塊的文字色是 transparent，所以勾看不見。 */}
      <span
        aria-hidden
        className={cx(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-canvas',
          'text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent',
        )}
      >
        <Check size={16} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-primary">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </span>
    </label>
  )
}
