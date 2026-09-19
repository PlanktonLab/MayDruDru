import { clsx, type ClassValue } from 'clsx'

/** 合併 className 的唯一入口；元件一律用它，不要自己串字串。 */
export function cx(...values: ClassValue[]): string {
  return clsx(...values)
}

export type { ClassValue }
