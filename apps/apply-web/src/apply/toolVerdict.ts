/** 自行填寫的工具名稱 → 補助判定（參考原專案 `lib/toolSearch.ts` 的做法）。
 *
 * 市民打的字高度分歧：中英文、俗稱、縮寫、常見錯字。所以比對走兩段：
 * 先精確（正式名稱或別名完全相同），再模糊（包含關係或編輯距離在容忍範圍內）。
 *
 * **查無收錄不擋送出**：我們收錄不完全世界的工具，擋下來只會把人推去打電話。
 * 沒比對到就標成「需人工認定」，由承辦看一眼。
 */

import type { EligibleTool } from '../lib/types'

export type VerdictTone = 'good' | 'warn' | 'danger'

export interface ToolVerdict {
  tone: VerdictTone
  title: string
  body: string
  /** false 只有一種情況：明確比對到不予補助的工具。 */
  canProceed: boolean
  /** 比對到的工具；沒比對到是 null（仍可送出，由人認定）。 */
  matched: EligibleTool | null
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '').replace(/[-_.+]/g, '')

/** Levenshtein 距離，用來容忍錯字（chatgtp → chatgpt）。 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/** 一個工具的所有可比對名稱：正式名稱、別名、廠商。 */
const namesOf = (tool: EligibleTool) => [tool.name, ...tool.aliases, tool.vendor].filter(Boolean)

/** 比對輸入字串，回傳最像的那一個；都不像就是 null。 */
export function matchTool(input: string, tools: readonly EligibleTool[]): EligibleTool | null {
  const needle = normalize(input)
  if (!needle) return null

  const exact = tools.find((tool) => namesOf(tool).some((name) => normalize(name) === needle))
  if (exact) return exact

  const scored = tools
    .map((tool) => {
      let best = Infinity
      for (const name of namesOf(tool)) {
        const candidate = normalize(name)
        if (!candidate) continue
        // 包含關係：以長度差當距離，短的那個優先（「claude」比「claudepro」更像使用者打的字）。
        if (candidate.includes(needle) || needle.includes(candidate)) {
          best = Math.min(best, Math.abs(candidate.length - needle.length) * 0.5)
        }
        const distance = editDistance(needle, candidate)
        // 容忍度隨字長放寬，但最多 3——再寬就會把不相干的名字配在一起。
        const tolerance = Math.min(3, Math.floor(Math.max(needle.length, candidate.length) / 4) + 1)
        if (distance <= tolerance) best = Math.min(best, distance)
      }
      return { tool, score: best }
    })
    .filter((entry) => entry.score !== Infinity)
    .sort((a, b) => a.score - b.score)

  return scored[0]?.tool ?? null
}

/** 把比對結果翻成給市民看的一段話。 */
export function verdictFor(input: string, tools: readonly EligibleTool[]): ToolVerdict | null {
  if (!input.trim()) return null
  const matched = matchTool(input, tools)

  if (!matched)
    return {
      tone: 'warn',
      title: '這個工具我們還沒有收錄',
      body: '你仍然可以繼續申請。這件案子會由承辦人員人工認定是否符合補助資格，不會因為系統沒收錄就被擋住。',
      canProceed: true,
      matched: null,
    }

  if (matched.status === 'APPROVED')
    return {
      tone: 'good',
      title: '這個工具可以申請補助',
      body: matched.verdict_note ?? '符合本計畫補助範圍。',
      canProceed: true,
      matched,
    }

  if (matched.status === 'REJECTED')
    return {
      tone: 'danger',
      title: '這個工具不符合補助資格',
      body: matched.verdict_note ?? '依本計畫規定不予補助。',
      canProceed: false,
      matched,
    }

  return {
    tone: 'warn',
    title: '這個工具需要個案認定',
    body: matched.verdict_note ?? '需依申請人實際使用目的逐案認定。',
    canProceed: true,
    matched,
  }
}
