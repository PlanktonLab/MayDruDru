/** MSW handlers：P3 契約的 `/api/apply/*`（與 `/api/contents`）。
 *
 * 兩個用途：`VITE_USE_MOCKS=1` 時讓 apply-web 不接後端也跑得動，以及測試共用同一套行為。
 * 這裡不模擬規則引擎——送件的判定回 `INDETERMINATE`，因為真伺服器會自己重跑一次。
 */

import { HttpResponse, http, type HttpHandler } from 'msw'
import { CASES, CASE_LAST4, FAQS, OTHER_SCHEMES, SCHEME, SCHEME_SUMMARY, requiredDocumentCodes } from './data'
import { STATUS_NEXT_ACTION, STATUS_PUBLIC_LABEL } from '../lib/status'
import type { CasePublic, CaseStatus } from '../lib/types'

/** 每個 handler 集合自己一份副本，測試之間不會互相汙染。 */
function freshCases(): Record<string, CasePublic> {
  return structuredClone(CASES)
}

const TOKEN_PREFIX = 'mock-case-token:'

function caseOfToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7)
  return token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null
}

export interface MockOptions {
  /** 讓 `POST /api/apply/verify` 一律回 423，測鎖定訊息用。 */
  locked?: boolean
  /** 覆寫示範案件。 */
  cases?: Record<string, CasePublic>
}

export function createHandlers(options: MockOptions = {}): HttpHandler[] {
  const cases = options.cases ?? freshCases()
  /** 失敗次數：連續 5 次就鎖 15 分鐘（決策 D17）。 */
  let failures = 0
  let nextCaseSerial = 900_100

  return [
    http.get('/api/apply/schemes', () => HttpResponse.json([SCHEME_SUMMARY, ...OTHER_SCHEMES])),

    http.get('/api/apply/schemes/:code', ({ params }) =>
      params.code === SCHEME.code
        ? HttpResponse.json(SCHEME)
        : HttpResponse.json({ detail: '找不到這個方案' }, { status: 404 }),
    ),

    http.post('/api/apply/schemes/:code/required-documents', async ({ request }) => {
      const body = (await request.json()) as {
        tier_code: string
        payment_channel_code: string
        paid_by_proxy: boolean
      }
      return HttpResponse.json({ document_type_codes: requiredDocumentCodes(body) })
    }),

    http.post('/api/apply/applications', async ({ request }) => {
      const form = await request.formData()
      const application = JSON.parse(String(form.get('application') ?? '{}')) as { scheme_code?: string }
      if (application.scheme_code !== SCHEME.code)
        return HttpResponse.json({ code: 'SCHEME_CLOSED' }, { status: 400 })
      const caseNo = `HC-2026-${nextCaseSerial++}`
      cases[caseNo] = {
        ...structuredClone(CASES['HC-2026-900002']),
        case_no: caseNo,
        status: 'UNDER_REVIEW',
        first_submitted_at: new Date().toISOString(),
        last_submitted_at: new Date().toISOString(),
      }
      return HttpResponse.json(
        { case_no: caseNo, status: 'UNDER_REVIEW', verdict: 'INDETERMINATE', findings: [] },
        { status: 201 },
      )
    }),

    http.post('/api/apply/verify', async ({ request }) => {
      if (options.locked)
        return HttpResponse.json({ code: 'LOCKED', retry_after_seconds: 900 }, { status: 423 })
      const { case_no, last4 } = (await request.json()) as { case_no: string; last4: string }
      if (CASE_LAST4[case_no] !== last4) {
        failures += 1
        if (failures >= 5)
          return HttpResponse.json({ code: 'LOCKED', retry_after_seconds: 900 }, { status: 423 })
        return HttpResponse.json({ code: 'VERIFICATION_FAILED' }, { status: 401 })
      }
      failures = 0
      return HttpResponse.json({
        token: `${TOKEN_PREFIX}${case_no}`,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        case_no,
      })
    }),

    http.get('/api/apply/applications/:case_no', ({ request, params }) => {
      const authorised = caseOfToken(request)
      const caseNo = String(params.case_no)
      if (!authorised || authorised !== caseNo)
        return HttpResponse.json({ code: 'UNAUTHORISED' }, { status: 401 })
      const found = cases[caseNo]
      return found ? HttpResponse.json(found) : HttpResponse.json({ detail: '找不到案件' }, { status: 404 })
    }),

    http.post('/api/apply/applications/:case_no/documents', async ({ request, params }) => {
      const caseNo = String(params.case_no)
      if (caseOfToken(request) !== caseNo) return HttpResponse.json({ code: 'UNAUTHORISED' }, { status: 401 })
      const found = cases[caseNo]
      if (!found) return HttpResponse.json({ detail: '找不到案件' }, { status: 404 })
      if (!found.can_supplement) return HttpResponse.json({ code: 'NOT_IN_SUPPLEMENT' }, { status: 400 })
      const form = await request.formData()
      const documents = JSON.parse(String(form.get('documents') ?? '[]')) as { document_type_code: string }[]
      const allowed = new Set(found.supplement_items.map((item) => item.document_type_code))
      if (documents.some((doc) => !allowed.has(doc.document_type_code)))
        return HttpResponse.json({ code: 'UNEXPECTED_DOCUMENT_TYPE' }, { status: 400 })
      found.status = 'REVISION_SUBMITTED'
      found.revision_count += 1
      found.last_submitted_at = new Date().toISOString()
      found.supplement_items = []
      found.can_supplement = false
      found.events.push({
        transition_code: 'T4',
        from_status: 'NEEDS_REVISION',
        to_status: 'REVISION_SUBMITTED',
        actor_type: 'APPLICANT',
        created_at: new Date().toISOString(),
        rejection_codes: [],
      })
      return HttpResponse.json({ status: found.status, verdict: 'INDETERMINATE', findings: [] })
    }),

    http.post('/api/apply/applications/:case_no/withdraw', ({ request, params }) => {
      const caseNo = String(params.case_no)
      if (caseOfToken(request) !== caseNo) return HttpResponse.json({ code: 'UNAUTHORISED' }, { status: 401 })
      const found = cases[caseNo]
      if (!found) return HttpResponse.json({ detail: '找不到案件' }, { status: 404 })
      const from = found.status
      found.status = 'WITHDRAWN'
      found.can_withdraw = false
      found.can_supplement = false
      found.events.push({
        transition_code: 'T10',
        from_status: from,
        to_status: 'WITHDRAWN',
        actor_type: 'APPLICANT',
        created_at: new Date().toISOString(),
        rejection_codes: [],
      })
      return HttpResponse.json({ status: found.status })
    }),

    http.get('/api/apply/faqs', ({ request }) => {
      const query = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase()
      const rows = query
        ? FAQS.filter(
            (faq) =>
              faq.question.toLowerCase().includes(query) || faq.answer.toLowerCase().includes(query),
          )
        : FAQS
      return HttpResponse.json([...rows].sort((a, b) => b.priority - a.priority))
    }),

    // P2 的 contents；mock 直接回備援文案，讓「線上文案會覆蓋本地字串」這條路也走得到。
    http.get('/api/contents', ({ request }) => {
      const keys = (new URL(request.url).searchParams.get('keys') ?? '').split(',').filter(Boolean)
      const overlay: Record<string, string> = {}
      for (const key of keys) {
        const match = /^status\.([A-Z_]+)\.(public_label|next_action)$/.exec(key)
        if (!match) continue
        const status = match[1] as CaseStatus
        const table = match[2] === 'public_label' ? STATUS_PUBLIC_LABEL : STATUS_NEXT_ACTION
        if (table[status]) overlay[key] = table[status]
      }
      return HttpResponse.json(overlay)
    }),
  ]
}

export const handlers = createHandlers()
