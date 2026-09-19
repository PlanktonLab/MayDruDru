import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'good' | 'danger'

export interface ToastItem {
  id: number
  text: string
  tone: ToastTone
}

export interface ToastApi {
  show: (text: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

/** 沒有 Provider 時是安靜的 no-op，不會炸掉測試或 Storybook。 */
export const ToastContext = createContext<ToastApi>({ show: () => {}, dismiss: () => {} })

/** 在元件裡拿到 `show()`。 */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
