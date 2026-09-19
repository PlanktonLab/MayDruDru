/** `tokens.css` 所定義的語意顏色，供元件以字串引用時做編譯期檢查。 */
export const colorTokens = [
  'primary',
  'muted',
  'secondary',
  'tertiary',
  'elevated',
  'border',
  'background',
  'background-lite',
  'canvas',
  'accent',
  'accent-bg',
  'danger',
  'danger-bg',
  'good',
  'good-bg',
  'warn',
  'warn-bg',
  'on-accent',
  'scrim',
] as const

export type ColorToken = (typeof colorTokens)[number]

/** `cssVar('accent')` → `var(--accent)`，讓行內樣式也走 token。 */
export function cssVar(token: ColorToken): string {
  return `var(--${token})`
}

/**
 * 可及性（SPEC §15.4）：觸控目標至少 44pt。
 * 需要手指點的東西一律套這個 class，別自己寫高度。
 */
export const TOUCH_TARGET = 'min-h-11 min-w-11'
