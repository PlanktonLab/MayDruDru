import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from './cx'

export interface FlatSelectOption {
  value: string
  label: string
  /** 右側的小字分類，例如工具的「通用型AI」。 */
  group?: string
}

export interface FlatSelectProps {
  value: string
  onChange: (value: string) => void
  options: readonly FlatSelectOption[]
  placeholder?: string
  className?: string
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  disabled?: boolean
}

/**
 * 下拉選單。
 *
 * 不用原生 `<select>`：各家瀏覽器的選單樣式差太多，而且沒辦法在選項右邊放分類
 * 或打勾。這裡自己做一個 combobox，但鍵盤行為照 WAI-ARIA 的 pattern 走：
 * 上下鍵移動、Home／End 跳頭尾、Enter／空白選取、Esc 關閉、打字跳到開頭相符的選項。
 *
 * 關閉的時機有三個：選了、按 Esc、焦點或指標離開整塊。`onMouseDown` 要
 * `preventDefault()`，否則點選項會先讓按鈕失焦、選單在 click 之前就收起來。
 */
export function FlatSelect({
  value,
  onChange,
  options,
  placeholder = '請選擇',
  className,
  id,
  disabled,
  ...aria
}: FlatSelectProps) {
  const generatedId = useId()
  const rootId = id ?? generatedId
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  // 用鍵盤移動時把目前這一項捲進視野，否則長清單按到一半就看不見游標在哪。
  useEffect(() => {
    if (open) document.getElementById(`${rootId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, rootId])

  const selected = options.find((option) => option.value === value)

  function choose(index: number) {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
    trigger.current?.focus()
  }

  const selectedIndex = () => Math.max(0, options.findIndex((option) => option.value === value))

  return (
    <div
      ref={root}
      className={cx('relative', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        id={rootId}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${rootId}-list` : undefined}
        aria-activedescendant={open ? `${rootId}-${active}` : undefined}
        {...aria}
        className={cx(
          'flex min-h-[46px] w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2',
          'text-left text-[16px] text-primary outline-none transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open
            ? 'border-accent bg-canvas ring-2 ring-accent/15'
            : 'border-transparent bg-[var(--field)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/15',
        )}
        onClick={() => {
          setActive(selectedIndex())
          setOpen((previous) => !previous)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            setActive((current) => {
              if (event.key === 'Home') return 0
              if (event.key === 'End') return options.length - 1
              if (!open) return selectedIndex()
              return Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
            })
            setOpen(true)
          } else if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            choose(active)
          } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // 打字跳選項：先往下找，找不到再從頭找一次。
            const needle = event.key.toLowerCase()
            const after = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(needle))
            const match = after >= 0 ? after : options.findIndex((option) => option.label.toLowerCase().startsWith(needle))
            if (match >= 0) {
              event.preventDefault()
              setActive(match)
              setOpen(true)
            }
          }
        }}
      >
        <span className={cx('truncate', !selected && 'text-secondary')}>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          id={`${rootId}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(360px,50vh)] overflow-y-auto rounded-xl border border-border bg-canvas py-1.5"
          style={{ boxShadow: 'var(--shadow-menu)' }}
        >
          {options.map((option, index) => {
            const isSelected = value === option.value
            return (
              <div
                key={option.value}
                id={`${rootId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-[15px] transition-colors',
                  active === index && 'bg-background-lite',
                  isSelected ? 'font-medium text-accent' : 'text-primary',
                )}
              >
                <span className="min-w-0">{option.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                  {option.group}
                  {isSelected && <Check size={16} aria-hidden className="text-accent" />}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
