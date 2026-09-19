/** 選單上的工具分組（計畫公告的分類）。
 *
 * 分類只存在於前端：後端的 `eligible_tools` 沒有分類欄位，而分類純粹是
 * 「怎麼把十幾個選項排得好找」的呈現問題，不影響任何判定。
 *
 * 這份清單同時決定**哪些工具出現在選單裡**——不予補助的工具不列（它們仍留在
 * `eligible_tools` 裡，供市民自行填寫時比對），需人工認定的則照列，
 * 因為那是「可以申請、但要等認定」而不是「不能申請」。
 */

import type { EligibleTool } from '../lib/types'

export interface ToolGroup {
  label: string
  /** 這一組的工具，已依英文字母排序。 */
  tools: EligibleTool[]
}

/**
 * 分組 → 該組收錄的工具**名稱關鍵字**。
 *
 * 用名稱而不是 id：`eligible_tools.id` 在伺服器上是隨機產生的（`new_id`），
 * 只有 mock 資料才叫 `tool-chatgpt`。拿 id 比對的話，接上真後端就一個都對不到，
 * 整個選單只剩「其他（自行填寫）」——這正是部署後選單空掉的原因。
 *
 * 比對方式是「名稱包含這個關鍵字」（忽略大小寫與空白），所以
 * 「Microsoft Copilot（Pro/M365）」用 `copilot` 就對得到，承辦人在後台把名稱
 * 改成「Microsoft 365 Copilot」也仍然分得進同一組。
 */
const GROUP_MEMBERS: readonly { label: string; keywords: readonly string[] }[] = [
  {
    label: '通用型 AI',
    keywords: ['chatgpt', 'claude', 'gemini', 'google ai', 'grok', 'perplexity'],
  },
  {
    label: '影像／設計類 AI',
    keywords: ['firefly', 'adobe', 'canva', 'figma', 'midjourney'],
  },
  {
    label: '辦公／生產力類 AI',
    keywords: ['copilot', 'notion', 'copy.ai', 'copyai', 'jasper'],
  },
  {
    label: '學習／語言類 AI',
    keywords: ['grammarly', 'speak', 'elicit'],
  },
  {
    label: '其他',
    keywords: ['cursor'],
  },
]

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '')

/** 這個工具屬於哪一組；都不符合就回 null（不列在選單上）。 */
function groupLabelOf(tool: EligibleTool): string | null {
  const name = normalize(tool.name)
  for (const group of GROUP_MEMBERS) {
    if (group.keywords.some((keyword) => name.includes(normalize(keyword)))) return group.label
  }
  return null
}

/**
 * 依英文字母排序。
 *
 * 「其他 Adobe AI 創作工具」這類中文開頭的名字要跟著它的品牌排（Adobe 之後），
 * 所以排序時把開頭的「其他」拿掉再比——否則所有「其他…」會擠在一起，
 * 跟它實際屬於哪個品牌無關。
 */
function sortKey(name: string): string {
  return name.replace(/^其他\s*/, '')
}

export function compareToolName(a: string, b: string): number {
  return sortKey(a).localeCompare(sortKey(b), 'en', { sensitivity: 'base' })
}

/**
 * 把 scheme 的 `eligible_tools` 攤成選單要的分組。
 *
 * 不予補助的工具不列（它們仍留在 `eligible_tools` 裡，供自行填寫時比對）。
 * 分不進任何一組的可補助工具收到最後的「其他」——承辦人在後台新增了一個
 * 關鍵字表沒收錄的工具時，它仍然選得到，而不是安靜消失。
 */
export function toolGroups(tools: readonly EligibleTool[]): ToolGroup[] {
  const listed = tools.filter((tool) => tool.status !== 'REJECTED')
  const buckets = new Map<string, EligibleTool[]>()
  for (const tool of listed) {
    const label = groupLabelOf(tool) ?? '其他'
    const bucket = buckets.get(label)
    if (bucket) bucket.push(tool)
    else buckets.set(label, [tool])
  }
  return GROUP_MEMBERS.map(({ label }) => ({
    label,
    tools: (buckets.get(label) ?? []).sort((a, b) => compareToolName(a.name, b.name)),
  })).filter((group) => group.tools.length > 0)
}
