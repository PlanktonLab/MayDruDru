/**
 * 「LINE 內容」六頁共用的 fetch helper（SPEC §8.2）。
 *
 * 只包路徑與 body，不含 react-query：hook 留在各自的頁面裡，這個檔案才能在測試
 * 裡被整包 mock 掉（`vi.mock('./queries')`），不必攔 `fetch`。
 * `lib/api.ts` 維持原樣——那是全站共用的 client，不該為了一個功能區改形狀。
 */

import { api, apiFetch, del, ensureOk, get, post, put } from '../../lib/api'
import type {
  ContentPreview,
  ContentView,
  ContentsList,
  Faq,
  FaqList,
  KnowledgeDoc,
  LineNotification,
  LineFeedback,
  LineSyncLog,
  MediaItem,
  RichMenuStatus,
  UnmatchedMessage,
} from '../../lib/types'

/** 只帶有值的參數，`?category=&q=` 這種空查詢字串不必送給後端。 */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    search.set(k, String(v))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

const contentPath = (key: string) => `/api/admin/contents/${encodeURIComponent(key)}`

/* ------------------------------------------------------------- 罐頭訊息 */

export const fetchContents = (p: { category?: string; q?: string } = {}) =>
  get<ContentsList>(`/api/admin/contents${qs(p)}`)

/** `text` 省略時預覽的是目前存著的草稿／內容。 */
export const fetchContentPreview = (body: { key: string; text?: string }) =>
  post<ContentPreview>('/api/admin/contents/preview', body)

export const saveContentDraft = (key: string, body: { draft: string; expected_version?: number }) =>
  put<ContentView>(contentPath(key), body)

/** `content` 給 null＝發布目前的草稿。`expected_version` 對不上後端回 409。 */
export const publishContent = (key: string, body: { content?: string | null; expected_version?: number }) =>
  post<ContentView>(`${contentPath(key)}/publish`, body)

export const resetContent = (key: string, body: { expected_version?: number } = {}) =>
  post<ContentView>(`${contentPath(key)}/reset`, body)

/* -------------------------------------------------------------------- FAQ */

export const fetchFaqs = (p: { category?: string; q?: string; active_only?: boolean } = {}) =>
  get<FaqList>(`/api/admin/faqs${qs(p)}`)

export interface FaqInput {
  question: string
  answer: string
  category: string
  keywords: string[]
  priority: number
  active: boolean
}

export const createFaq = (body: FaqInput) => post<Faq>('/api/admin/faqs', body)
export const updateFaq = (id: string, body: FaqInput & { expected_version?: number }) => put<Faq>(`/api/admin/faqs/${id}`, body)
export const setFaqActive = (id: string, active: boolean) => post<Faq>(`/api/admin/faqs/${id}/status`, { active })
export const deleteFaq = (id: string) => del<void>(`/api/admin/faqs/${id}`)

/* --------------------------------------------------------------- 知識文件 */

export const fetchKnowledge = (p: { q?: string } = {}) => get<{ items: KnowledgeDoc[] }>(`/api/admin/knowledge${qs(p)}`)

export interface KnowledgeInput {
  title: string
  content: string
  source_url: string
  source_type: string
  tags: string[]
}

export const createKnowledge = (body: KnowledgeInput) => post<KnowledgeDoc>('/api/admin/knowledge', body)
export const updateKnowledge = (id: string, body: KnowledgeInput & { expected_version?: number }) =>
  put<KnowledgeDoc>(`/api/admin/knowledge/${id}`, body)
export const deleteKnowledge = (id: string) => del<void>(`/api/admin/knowledge/${id}`)

/* ---------------------------------------------------------------- 媒體庫 */

export const fetchMedia = () => get<{ items: MediaItem[] }>('/api/admin/media')

/* ------------------------------------------------------------- 圖文選單 */

export const fetchRichMenu = () => get<RichMenuStatus>('/api/admin/line/richmenu')

export async function fetchRichMenuImage(): Promise<string> {
  const blob = await (await ensureOk(await apiFetch('/api/admin/line/richmenu/image'))).blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('無法讀取圖文選單圖片'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 同步。欄位名固定是 `image`（不是 `lib/api.upload` 的 `file`），沒帶圖就沿用
 * LINE 上那一張或內建美術稿。失敗時後端回 502，`ApiError.detail` 帶著圖檔診斷。
 */
export function syncRichMenu(image?: File | null) {
  const form = new FormData()
  if (image) form.append('image', image)
  return api<{ state: string; rich_menu_id: string; status: RichMenuStatus }>('/api/admin/line/richmenu/sync', {
    method: 'POST',
    form,
  })
}

export const deleteRichMenu = () => del<{ state: string }>('/api/admin/line/richmenu')

export const fetchSyncLogs = (limit = 20) => get<{ items: LineSyncLog[] }>(`/api/admin/line/sync-logs${qs({ limit })}`)

/* ------------------------------------------------- 推播紀錄與未命中訊息 */

export const fetchNotifications = (p: { status?: string; case_no?: string; limit?: number } = {}) =>
  get<{ items: LineNotification[] }>(`/api/admin/line/notifications${qs(p)}`)

export const sendDemoNotification = (body: { case_no: string; document_code?: string }) =>
  post<{ case_no: string; queued: number; skipped: number }>('/api/admin/line/notifications/demo', body)

export const fetchFeedback = (limit = 100) =>
  get<{ items: LineFeedback[] }>(`/api/admin/line/feedback${qs({ limit })}`)

export const fetchUnmatched = (limit = 100) => get<{ items: UnmatchedMessage[] }>(`/api/admin/line/unmatched${qs({ limit })}`)

export const dismissUnmatched = (id: string) => del<void>(`/api/admin/line/unmatched/${id}`)
