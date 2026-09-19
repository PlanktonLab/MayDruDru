/** `@maydru/ui` — admin-web 與 apply-web 共用的設計 token 與元件（SPEC §15）。
 *
 * 兩個前端各自 `@import "@maydru/ui/tokens.css"` 取得 Tailwind 4 的 `@theme`
 * 與深色模式變數；顏色、字級、間距、圓角一律走 token，不硬編色碼。
 *
 * 可及性是硬規則：觸控目標 ≥ 44pt、對比 ≥ 4.5:1、鍵盤可操作、每個控制項都有標籤。
 */

export { cx, type ClassValue } from './cx'
export { TOUCH_TARGET, colorTokens, cssVar, type ColorToken } from './tokens'

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button'
export { Checkbox, Field, Input, Select, Textarea, type CheckboxProps, type FieldProps } from './form'
export { FlatSelect, type FlatSelectOption, type FlatSelectProps } from './FlatSelect'
export { Badge, Card, EmptyState, Spinner, type BadgeTone, type CardProps } from './surfaces'
export { Modal, type ModalProps } from './Modal'
export { Stepper, Timeline, type Step, type TimelineEvent } from './progress'
export { ToastProvider } from './Toast'
export { useToast, type ToastApi, type ToastItem, type ToastTone } from './toastContext'
