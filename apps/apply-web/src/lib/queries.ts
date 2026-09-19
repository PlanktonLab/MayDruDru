/** 市民端所有讀取用的 react-query hooks，以及送件／補件／撤回的 mutation 輔助。 */

import { useQuery } from '@tanstack/react-query'
import type { OcrResult } from '@maydru/ocr'
import { getJson, postForm, postJson, request } from './api'
import { contentKeys, type ContentOverlay } from './status'
import type {
  CasePublic,
  DocumentPayload,
  Faq,
  SchemePublic,
  SchemeSummary,
  SubmitResponse,
  VerifyResponse,
} from './types'

export function useSchemes() {
  return useQuery({
    queryKey: ['apply', 'schemes'],
    queryFn: () => getJson<SchemeSummary[]>('/api/apply/schemes'),
  })
}

export function useScheme(code: string | undefined) {
  return useQuery({
    queryKey: ['apply', 'scheme', code],
    queryFn: () => getJson<SchemePublic>(`/api/apply/schemes/${encodeURIComponent(code!)}`),
    enabled: Boolean(code),
  })
}

export interface RequiredDocumentsInput {
  tier_code: string
  payment_channel_code: string
  paid_by_proxy: boolean
}

/**
 * 必備文件清單一律問伺服器（`scheme.required_document_types`），不在前端自己推。
 * 前端推一次、後端推一次，兩邊遲早會不一致——不一致的那天就是民眾被莫名退件的那天。
 */
export function useRequiredDocuments(code: string | undefined, input: RequiredDocumentsInput) {
  const ready = Boolean(code && input.tier_code && input.payment_channel_code)
  return useQuery({
    queryKey: ['apply', 'required-documents', code, input.tier_code, input.payment_channel_code, input.paid_by_proxy],
    queryFn: () =>
      postJson<{ document_type_codes: string[] }>(
        `/api/apply/schemes/${encodeURIComponent(code!)}/required-documents`,
        input,
      ),
    enabled: ready,
  })
}

/**
 * 狀態文案的線上版本（P2 的 `contents`）。回應是 `{ items: { key: text } }`；
 * 這支端點失敗時回空物件，畫面退回 `lib/status.ts` 的備援字串，不會讓市民看到狀態代號。
 */
export function useContentOverlay() {
  return useQuery<ContentOverlay>({
    queryKey: ['apply', 'contents'],
    queryFn: async () => {
      try {
        const body = await getJson<{ items?: Record<string, string> }>(
          `/api/contents?keys=${encodeURIComponent(contentKeys().join(','))}`,
        )
        // 空字串代表「這個 key 沒有文案」，留著會蓋掉備援字串，變成一片空白。
        return Object.fromEntries(
          Object.entries(body?.items ?? {}).filter(([, text]) => (text ?? '').trim()),
        )
      } catch {
        return {}
      }
    },
    staleTime: 5 * 60_000,
  })
}

export function useCase(caseNo: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['apply', 'case', caseNo],
    queryFn: () => getJson<CasePublic>(`/api/apply/applications/${encodeURIComponent(caseNo!)}`, true),
    enabled: Boolean(caseNo) && enabled,
    retry: false,
  })
}

export function useFaqs(query: string, scheme?: string) {
  return useQuery({
    queryKey: ['apply', 'faqs', query, scheme],
    queryFn: () => {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (scheme) params.set('scheme', scheme)
      const suffix = params.toString()
      return getJson<Faq[]>(`/api/apply/faqs${suffix ? `?${suffix}` : ''}`)
    },
  })
}

/* ───────────────────────── 寫入 ───────────────────────── */

export function verifyCase(case_no: string, last4: string) {
  return postJson<VerifyResponse>('/api/apply/verify', { case_no, last4 })
}

export interface ApplicationPayload {
  scheme_code: string
  tier_code: string
  payment_channel_code: string
  applicant_name: string
  phone: string
  id_last4?: string
  email?: string
  tool_name: string
  tool_id?: string | null
  purchase_amount: number
  purchase_date: string
  paid_by_proxy: boolean
  note?: string
  precheck?: { verdict: string; findings: unknown[] }
}

export interface OutgoingDocument {
  document_type_code: string
  masked: boolean
  mime: string
  page_count: number
  ocr: OcrResult | null
  blob: Blob
  fileName: string
}

/** 契約：`documents` 的順序就是 `file_0…file_n` 的順序。 */
export function buildFormData(documents: OutgoingDocument[], application?: ApplicationPayload): FormData {
  const form = new FormData()
  if (application) form.append('application', JSON.stringify(application))
  const meta: DocumentPayload[] = documents.map((doc) => ({
    document_type_code: doc.document_type_code,
    masked: doc.masked,
    mime: doc.mime,
    page_count: doc.page_count,
    ocr: doc.ocr,
  }))
  form.append('documents', JSON.stringify(meta))
  documents.forEach((doc, index) => {
    form.append(`file_${index}`, doc.blob, doc.fileName || `${doc.document_type_code}.jpg`)
  })
  return form
}

export function submitApplication(application: ApplicationPayload, documents: OutgoingDocument[]) {
  return postForm<SubmitResponse>('/api/apply/applications', buildFormData(documents, application))
}

export function submitSupplement(caseNo: string, documents: OutgoingDocument[]) {
  return postForm<SubmitResponse>(
    `/api/apply/applications/${encodeURIComponent(caseNo)}/documents`,
    buildFormData(documents),
    true,
  )
}

export function withdrawCase(caseNo: string) {
  return request<{ status: string }>(`/api/apply/applications/${encodeURIComponent(caseNo)}/withdraw`, {
    method: 'POST',
    auth: true,
  })
}
