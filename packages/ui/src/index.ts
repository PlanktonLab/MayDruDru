/** `@maydru/ui` — admin-web 與 apply-web 共用的設計 token 與元件。
 *
 * P0 只提供 token（`@maydru/ui/tokens.css`）與下面的 token 名稱表；共用元件在
 * P3 之後隨頁面一起長出來（SPEC §15）。
 */

/** tokens.css 所定義的語意顏色，供元件以字串引用時做編譯期檢查。 */
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
