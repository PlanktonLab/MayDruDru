/** 案件審核區的資料存取。既有的 `lib/api.ts` 已經處理 JWT 與錯誤訊息，這裡只包查詢。 */

import { useQuery } from '@tanstack/react-query'
import type { OcrResult } from '@maydru/ocr'
import { get, post, put } from '../lib/api'
import type {
  CaseDetail,
  FindingOverrideInput,
  PresignedUrl,
  QueuePage,
  Reviewer,
  TransitionInput,
} from './types'

export interface QueueFilters {
  status: string
  scheme: string
  assigned: string
  verdict: string
  q: string
  page: number
  page_size: number
}

export const DEFAULT_FILTERS: QueueFilters = {
  status: '',
  scheme: '',
  assigned: '',
  verdict: '',
  q: '',
  page: 1,
  page_size: 20,
}

export function queueQueryString(filters: QueueFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.scheme) params.set('scheme', filters.scheme)
  if (filters.assigned) params.set('assigned', filters.assigned)
  if (filters.verdict) params.set('verdict', filters.verdict)
  if (filters.q.trim()) params.set('q', filters.q.trim())
  params.set('page', String(filters.page))
  params.set('page_size', String(filters.page_size))
  return params.toString()
}

export function useCaseQueue(filters: QueueFilters) {
  const query = queueQueryString(filters)
  return useQuery({
    queryKey: ['admin-cases', query],
    queryFn: () => get<QueuePage>(`/api/admin/applications?${query}`),
  })
}

export function useCaseDetail(caseNo: string | undefined) {
  return useQuery({
    queryKey: ['admin-case', caseNo],
    queryFn: () => get<CaseDetail>(`/api/admin/applications/${encodeURIComponent(caseNo!)}`),
    enabled: Boolean(caseNo),
  })
}

/**
 * 可指派的審核人。P3 契約還沒有這支端點（只有 `POST …/assign` 吃 `reviewer_id`），
 * 所以拿不到時回空陣列——指派選單會變成唯讀，但案件頁其他部分照常運作。
 */
export function useReviewers() {
  return useQuery({
    queryKey: ['case-reviewers'],
    queryFn: async () => {
      try {
        return await get<Reviewer[]>('/api/admin/reviewers')
      } catch {
        return [] as Reviewer[]
      }
    },
    staleTime: 5 * 60_000,
  })
}

const base = (caseNo: string) => `/api/admin/applications/${encodeURIComponent(caseNo)}`

/** presigned URL 只有 5 分鐘（SPEC §11），所以每次開文件都重新要一次。 */
export const documentUrl = (caseNo: string, documentId: string) =>
  get<PresignedUrl>(`${base(caseNo)}/documents/${encodeURIComponent(documentId)}/url`)

/** 承辦在自己的瀏覽器重跑 tesseract 之後回存，`source=reviewer`。 */
export const putDocumentOcr = (caseNo: string, documentId: string, ocr: OcrResult) =>
  post<{ findings: unknown[] }>(`${base(caseNo)}/documents/${encodeURIComponent(documentId)}/ocr`, { ocr })

export const overrideFinding = (caseNo: string, ruleCode: string, body: FindingOverrideInput) =>
  put<{ findings: unknown[] }>(`${base(caseNo)}/findings/${encodeURIComponent(ruleCode)}`, body)

export const runTransition = (caseNo: string, body: TransitionInput) =>
  post<{ status: string; events: unknown[] }>(`${base(caseNo)}/transitions`, body)

export const assignReviewer = (caseNo: string, reviewerId: string | null) =>
  post<{ assigned_reviewer: Reviewer | null }>(`${base(caseNo)}/assign`, { reviewer_id: reviewerId })

export const reevaluate = (caseNo: string) =>
  post<{ findings: unknown[]; verdict: string }>(`${base(caseNo)}/evaluate`)
