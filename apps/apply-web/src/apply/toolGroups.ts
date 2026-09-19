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

/** 分組 → 該組收錄的工具 id。順序不重要，顯示前一律依名稱排序。 */
const GROUP_MEMBERS: readonly { label: string; ids: readonly string[] }[] = [
  {
    label: '通用型 AI',
    ids: ['tool-chatgpt', 'tool-claude', 'tool-google-ai', 'tool-grok', 'tool-perplexity'],
  },
  {
    label: '影像／設計類 AI',
    ids: ['tool-adobe-firefly', 'tool-adobe-other', 'tool-canva', 'tool-figma-ai', 'tool-midjourney'],
  },
  {
    label: '辦公／生產力類 AI',
    ids: ['tool-m365-copilot', 'tool-notion', 'tool-copyai', 'tool-jasper'],
  },
  {
    label: '學習／語言類 AI',
    ids: ['tool-grammarly', 'tool-speak', 'tool-elicit'],
  },
  {
    label: '其他',
    ids: ['tool-cursor'],
  },
]

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
 * 清單上沒有的工具不會出現在選單（但仍可由「其他（自行填寫）」比對到）；
 * 反過來，清單列了但這個 scheme 沒有的 id 會被安靜略過，
 * 不會在畫面上留下一個點不動的空選項。
 */
export function toolGroups(tools: readonly EligibleTool[]): ToolGroup[] {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  return GROUP_MEMBERS.map(({ label, ids }) => ({
    label,
    tools: ids
      .map((id) => byId.get(id))
      .filter((tool): tool is EligibleTool => Boolean(tool))
      .sort((a, b) => compareToolName(a.name, b.name)),
  })).filter((group) => group.tools.length > 0)
}
