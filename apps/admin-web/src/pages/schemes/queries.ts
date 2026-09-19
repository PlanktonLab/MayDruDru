/**
 * 方案管理區與內容助理的 fetch helper（SPEC §8.2 / §8.6）。
 *
 * 和 `pages/line/queries.ts` 同一套作法：只包路徑與 body，不含 react-query，
 * 測試才能整包 `vi.mock('./queries')` 掉，不必攔 `fetch`。
 */

import { del, get, patch, post, put } from '../../lib/api'
import type {
  ChildKind,
  EligibleTool,
  EvaluateResult,
  FaqSuggestion,
  SchemeCopyResult,
  SchemeDetail,
  SchemePatch,
  SchemeRow,
} from './types'

const base = '/api/admin/schemes'
const path = (code: string, rest = '') => `${base}/${encodeURIComponent(code)}${rest}`

/* ------------------------------------------------------------------ 方案 */

export const fetchSchemes = () => get<SchemeRow[]>(base)
export const fetchScheme = (code: string) => get<SchemeDetail>(path(code))
export const createScheme = (body: { code: string; name: string } & Partial<SchemeDetail>) =>
  post<SchemeRow>(base, body)
/** `expected_version` 對不上時後端回 409（樂觀鎖，SPEC §6）。 */
export const patchScheme = (code: string, body: SchemePatch) => patch<SchemeRow>(path(code), body)
export const deleteScheme = (code: string) => del<void>(path(code))

/* -------------------------------------------------------------- 子設定表 */

export const fetchChildren = <T,>(code: string, kind: ChildKind) => get<T[]>(path(code, `/${kind}`))
export const createChild = <T,>(code: string, kind: ChildKind, body: Record<string, unknown>) =>
  post<T>(path(code, `/${kind}`), body)
export const patchChild = <T,>(code: string, kind: ChildKind, id: string, body: Record<string, unknown>) =>
  patch<T>(path(code, `/${kind}/${id}`), body)
export const deleteChild = (code: string, kind: ChildKind, id: string) =>
  del<void>(path(code, `/${kind}/${id}`))
/** 依送上來的 id 順序重寫 `sort_order`。沒帶到的列排在後面。 */
export const reorderChildren = <T,>(code: string, kind: ChildKind, ids: string[]) =>
  post<T[]>(path(code, `/${kind}/reorder`), { ids })

export interface SopFlowLink {
  id: string
  document_type_id: string
  flow_id: string
  platform_id: string
  sort_order: number
}

export const fetchSopFlowLinks = (code: string, documentTypeCode: string) =>
  get<SopFlowLink[]>(path(code, `/document-types/${encodeURIComponent(documentTypeCode)}/sop-flows`))

export const replaceSopFlowLinks = (
  code: string,
  documentTypeCode: string,
  links: { flow_id: string; platform_id: string }[],
) => put<SopFlowLink[]>(path(code, `/document-types/${encodeURIComponent(documentTypeCode)}/sop-flows`), { links })

/* ---------------------------------------------------------- 規則與工具 */

/**
 * 伺服器端試算。面板平常在瀏覽器裡跑 `@maydru/review-rules` 給即時回饋，這一支
 * 是「去問真正做判定的那一側」——兩邊判得不一樣，就是規則引擎的兩個實作走鐘了。
 */
export const evaluateRules = (code: string, body: {
  rules?: unknown[]
  documents: { document_type_code: string; ocr: unknown }[]
  facts: Record<string, unknown>
}) => post<EvaluateResult>(path(code, '/review-rules/evaluate'), body)

export const fetchPendingTools = (code: string) => get<EligibleTool[]>(path(code, '/eligible-tools/pending'))

export const resolveTool = (code: string, id: string, body: {
  status: 'APPROVED' | 'REJECTED' | 'PENDING'
  verdict_note?: string
  merge_into_id?: string | null
}) => post<EligibleTool>(path(code, `/eligible-tools/${id}/resolve`), body)

/* -------------------------------------------------------------- 內容助理 */

/** (c) 一鍵產生整套方案文案草稿。只寫 draft，發布仍然是人按的（決策 D8）。 */
export const generateSchemeCopy = (code: string) =>
  post<SchemeCopyResult>(`/api/admin/copilot/schemes/${encodeURIComponent(code)}/drafts`)

/** (b) 從未命中訊息聚類產生 FAQ 建議。 */
export const generateFaqSuggestions = (limit = 8) =>
  post<{ items: FaqSuggestion[] }>('/api/admin/copilot/faq-suggestions', { limit })

export const fetchFaqSuggestions = () => get<{ items: FaqSuggestion[] }>('/api/admin/copilot/faq-suggestions')

export const acceptFaqSuggestion = (id: string) =>
  post<{ id: string; question: string; active: boolean }>(`/api/admin/copilot/faq-suggestions/${id}/accept`)

export const dismissFaqSuggestion = (id: string) =>
  post<{ id: string; status: string }>(`/api/admin/copilot/faq-suggestions/${id}/dismiss`)
