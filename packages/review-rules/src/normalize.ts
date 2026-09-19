/** 值的正規化（SPEC §8.3 `normalize(amount/date/last4)`）。
 *
 * ⚠️ Python 版（`services/review.py`）必須逐條對齊這裡的行為，否則共用 fixtures 會失敗。
 * 每個 normalizer 都是純函式：吃字串、回標準字串或 null（表示看不懂）。
 */

import type { Normalizer } from './types'

/**
 * 金額：去掉幣別符號、千分位、全形字與中文單位後 parse。
 *
 * - 只保留 `0-9`、`.`、`-`（負號僅在最前面才有意義，實務上不會出現）。
 * - 逗號一律當千分位、點一律當小數點；歐式寫法（`1.200,50`，最後一個逗號在最後一個
 *   點之後）無法區分，視為看不懂回 null，交給人工。
 * - 有多個小數點時同樣回 null。
 * - 輸出：整數就不帶小數點（`'1200'`），否則用 JS `String(number)`
 *   （`1200.5` → `'1200.5'`）。Python 端請用
 *   `str(int(v)) if v == int(v) else repr(v)`。
 */
export function normalizeAmount(raw: string): string | null {
  const compact = raw.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
  // 歐式 `1.200,50`：最後一個逗號在最後一個點之後 → 點是千分位，無從判斷，交給人工。
  if (compact.lastIndexOf(',') > compact.lastIndexOf('.') && compact.includes('.')) return null
  const digits = compact.replace(/[^0-9.-]/g, '')
  if (!/\d/.test(digits)) return null
  if ((digits.match(/\./g) ?? []).length > 1) return null
  const value = Number.parseFloat(digits.replace(/(?!^)-/g, ''))
  if (!Number.isFinite(value)) return null
  // `String(1200)` → '1200'、`String(1200.5)` → '1200.5'，整數不會多出 `.0`。
  return String(value)
}

/** 依序嘗試的日期樣式；年份 < 1911 一律視為民國年。 */
const DATE_PATTERNS: RegExp[] = [
  /(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/, // 民國 115 年 9 月 1 日
  /(\d{4})-(\d{1,2})-(\d{1,2})/, // ISO
  /(\d{2,4})\/(\d{1,2})\/(\d{1,2})/, // 115/09/01 或 2026/09/01
  /(\d{2,4})\.(\d{1,2})\.(\d{1,2})/, // 2026.09.01
  /(\d{4})(\d{2})(\d{2})(?!\d)/, // 20260901
]

/**
 * 日期：民國 / ISO / 斜線 / 點 / 八碼 → `YYYY-MM-DD`。
 *
 * 一律「年 → 月 → 日」的順序，不支援美式 `MM/DD/YYYY`（台灣的憑證不會這樣印，
 * 而且無法和民國年區分）。年份 < 1911 加上 1911 換算成西元。
 * 月份不在 1–12、日不在 1–31 → null。
 */
export function normalizeDate(raw: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(raw)
    if (!match) continue
    let year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (year < 1911) year += 1911
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

/** 常見的遮罩字元（含全形星號與項目符號）。 */
const MASK_CHARS = '[•*xX·✱●＊ｘＸ#]'
const MASKED_LAST4 = new RegExp(`(?:${MASK_CHARS}){2,}\\s*(\\d{4})`)

/**
 * 卡號末四碼：先看遮罩字元後面的四碼，再看字串結尾的四碼。
 *
 * 1. 去掉空白與各式連字號（`4826` 常被印成 `**** - 4826`）；
 * 2. `••••4826` / `xxxx4826` → `4826`；
 * 3. 結尾剛好是四碼（`末四碼4826`）→ `4826`；
 * 4. 其餘一律 null——寧可回 UNREADABLE 讓人工看，也不要猜錯一組數字。
 */
export function normalizeLast4(raw: string): string | null {
  const compact = raw.replace(/[\s–—_-]/g, '')
  const masked = MASKED_LAST4.exec(compact)
  if (masked) return masked[1]
  const trailing = /(\d{4})$/.exec(compact)
  if (trailing) return trailing[1]
  return null
}

export const NORMALIZERS: Record<Normalizer, (raw: string) => string | null> = {
  amount: normalizeAmount,
  date: normalizeDate,
  last4: normalizeLast4,
}

/** 沒有指定 normalizer 時，值就是 trim 過的原字串。 */
export function applyNormalizer(raw: string, normalizer?: Normalizer): string | null {
  const value = raw.trim()
  if (!normalizer) return value
  return NORMALIZERS[normalizer](value)
}

/** 把 normalize 過的金額字串轉回數字（`amount_tolerance` 用）。 */
export function parseAmount(value: string): number | null {
  const normalized = normalizeAmount(value)
  if (normalized === null) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
