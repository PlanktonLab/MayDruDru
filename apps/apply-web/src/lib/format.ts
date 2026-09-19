/** 數字與日期一律走這裡，整站格式一致（SPEC §15.1）。 */

export function money(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  return `NT$${Math.round(amount).toLocaleString('zh-TW')}`
}

/** ISO → `2026/08/01`；壞掉的字串原樣回傳，畫面不會變成 Invalid Date。 */
export function date(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`
}

/** ISO → `2026/08/01 14:30`。 */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const time = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
  return `${date(value)} ${time}`
}

/** 鎖定倒數：秒數 → 「15 分 0 秒」；訊息要讓人知道還要等多久。 */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${rest} 秒`
  if (rest === 0) return `${minutes} 分鐘`
  return `${minutes} 分 ${rest} 秒`
}

/** `2026-04-02` ~ `2026-11-30` → 申請期間字串。 */
export function period(start: string | null, end: string | null): string {
  if (!start && !end) return '未定'
  if (!start) return `即日起至 ${date(end)}`
  if (!end) return `${date(start)} 起`
  return `${date(start)} – ${date(end)}`
}
