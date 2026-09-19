/**
 * 代碼 → 中文句子。
 *
 * 後端刻意只回代碼（`bad_size`、`area_3_bounds`…），中文一律在這裡長出來：
 * 同一個代碼在 LINE handler、worker 與後台各翻一次的話，三邊遲早會講不一樣的話。
 * 句子要讓承辦人知道「下一步做什麼」，不是只知道「哪裡錯」。
 */

import type { NotificationStatus, RichMenuState } from '../../lib/types'

/** LINE 允許的圖文選單圖檔尺寸與大小上限（與後端 `richmenu.ALLOWED_SIZES` 一致）。 */
export const RICH_MENU_IMAGE_RULE = '2500×1686、2500×843 或 1200×810，且不超過 1 MB'

export const RICH_MENU_STATE_LABEL: Record<RichMenuState, string> = {
  synced: '已同步',
  different: '與 LINE 上不同',
  missing: 'LINE 上沒有選單',
  not_configured: '尚未設定 LINE 憑證',
  unknown: '讀取失敗',
}
export const RICH_MENU_STATE_TONE: Record<RichMenuState, 'good' | 'warn' | 'danger' | 'muted'> = {
  synced: 'good',
  different: 'warn',
  missing: 'warn',
  not_configured: 'muted',
  unknown: 'danger',
}

const DIFFERENCE_TEXT: Record<string, string> = {
  size: '畫布尺寸和 LINE 上那一份不一樣，重新同步會以這裡的 2500×1686 為準。',
  chat_bar_text: '聊天室下方的選單標籤和 LINE 上那一份不一樣。',
  area_count: '格子數量和 LINE 上那一份不一樣（這裡是六格）。',
}

/** `area_3_action` → 「第 4 格」：後端從 0 起算，承辦人看的是第幾格。 */
const AREA_PATTERN = /^area_(\d+)_(action|bounds)$/

/** 一個差異代碼的中文說明；沒見過的代碼也要給得出一句話。 */
export function describeDifference(code: string): string {
  const known = DIFFERENCE_TEXT[code]
  if (known) return known
  const area = AREA_PATTERN.exec(code)
  if (area) {
    const nth = Number(area[1]) + 1
    return area[2] === 'action'
      ? `第 ${nth} 格按下去的動作和 LINE 上那一份不一樣。`
      : `第 ${nth} 格的位置或大小和 LINE 上那一份不一樣。`
  }
  return `有一項設定和 LINE 上那一份不一樣（代碼 ${code}），重新同步即可蓋過去。`
}

const IMAGE_PROBLEM_TEXT: Record<string, string> = {
  not_png_or_jpeg: '圖檔必須是 PNG 或 JPEG，其他格式 LINE 不收。',
  bad_size: `圖檔尺寸不對，LINE 只接受 ${RICH_MENU_IMAGE_RULE.split('，')[0]}。`,
  too_large: '圖檔超過 1 MB，請壓到 1 MB 以內再上傳。',
}

/** 圖檔問題代碼的中文說明；`invalid_image:…` 帶著 LINE 自己的原因回來。 */
export function describeImageProblem(code: string): string {
  const known = IMAGE_PROBLEM_TEXT[code]
  if (known) return known
  if (code.startsWith('invalid_image')) {
    const reason = code.slice('invalid_image'.length).replace(/^[:：]\s*/, '')
    return reason ? `LINE 不接受這張圖：${reason}` : 'LINE 不接受這張圖，請換一張再試。'
  }
  return `圖檔有一個問題（代碼 ${code}）。LINE 只接受 ${RICH_MENU_IMAGE_RULE}。`
}

/** 從 502 的 `error` 字串裡撈出 `invalid_image:…`，讓它也能翻成中文。 */
export function imageProblemCodes(problems: string[] | undefined, error: string | undefined): string[] {
  const codes = [...(problems ?? [])]
  const match = error && /invalid_image[:：][^\s]*/.exec(error)
  if (match) codes.push(match[0])
  return codes
}

export const NOTIFICATION_STATUS_LABEL: Record<NotificationStatus, string> = {
  queued: '等待送出',
  sent: '已送出',
  failed: '失敗',
  skipped: '未綁定 LINE',
}
export const NOTIFICATION_STATUS_TONE: Record<NotificationStatus, 'muted' | 'good' | 'danger' | 'warn'> = {
  queued: 'muted',
  sent: 'good',
  failed: 'danger',
  skipped: 'warn',
}

/** 預覽分頁：後端的 surface id → 承辦人看得懂的畫面名稱。 */
export const SURFACE_LABEL: Record<string, string> = {
  welcome: '歡迎訊息',
  case_ask: '查詢案件',
  case_card: '案件進度卡',
  my_cases: '我的案件',
  scheme_card: '方案卡',
  contact: '聯絡我們',
  notification: '推播通知',
}
export const surfaceLabel = (id: string) => SURFACE_LABEL[id] ?? id

const VARIABLE_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g

/**
 * 把 `{{name}}` 換成範例值，與後端 `contents.substitute()` 同一套規則。
 * 前端自己算一份是為了「打字當下就看到結果」——等 API 回來才更新會慢半拍。
 * 沒有範例值的變數保留原樣，才看得出是哪一個沒填。
 */
export const substitute = (text: string, vars: Record<string, string>): string =>
  text.replace(VARIABLE_PATTERN, (whole, name: string) => (vars[name] ? vars[name] : whole))
