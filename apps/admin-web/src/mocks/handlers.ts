/** MSW handlers：案件審核區用得到的端點（P3 契約的 `/api/admin/applications/*`）。
 *
 * `VITE_USE_MOCKS=1` 時讓 admin-web 不接後端也能開案件審核區；測試共用同一組行為。
 * SOP 那幾區的端點不在這裡——它們在 P0 就已經有真後端了。
 */

import { HttpResponse, http, type HttpHandler } from 'msw'
import { CASES, CURRENT_USER, REVIEWERS, SCHEME_SETTINGS } from './data'
import type { CaseDetail, QueueRow } from '../cases/types'

function toQueueRow(item: CaseDetail): QueueRow {
  const {
    documents: _documents,
    findings: _findings,
    events: _events,
    rules: _rules,
    allowed_transitions: _transitions,
    approval_blockers: _blockers,
    ...row
  } = item
  return row
}

export interface MockOptions {
  /** 沒有審核人清單端點時（目前的真實情況）回 404。 */
  reviewers?: boolean
  cases?: Record<string, CaseDetail>
}

export function createHandlers(options: MockOptions = {}): HttpHandler[] {
  const cases = options.cases ?? structuredClone(CASES)

  return [
    http.get('/api/auth/me', () => HttpResponse.json(CURRENT_USER)),

    http.get('/api/admin/applications', ({ request }) => {
      const params = new URL(request.url).searchParams
      const status = params.get('status') ?? ''
      const scheme = params.get('scheme') ?? ''
      const assigned = params.get('assigned') ?? ''
      const verdict = params.get('verdict') ?? ''
      const q = (params.get('q') ?? '').trim().toLowerCase()
      const page = Number(params.get('page') ?? 1)
      const pageSize = Number(params.get('page_size') ?? 20)

      let rows = Object.values(cases)
        .map(toQueueRow)
        // SPEC §7：以第一次送件時間遞增排序，補件不重排。
        .sort((a, b) => (a.first_submitted_at < b.first_submitted_at ? -1 : 1))

      if (status) rows = rows.filter((row) => row.status === status)
      if (scheme) rows = rows.filter((row) => row.scheme_code === scheme)
      if (verdict) rows = rows.filter((row) => row.verdict === verdict)
      if (assigned === 'none') rows = rows.filter((row) => !row.assigned_reviewer)
      if (assigned === 'me') rows = rows.filter((row) => row.assigned_reviewer?.id === CURRENT_USER.id)
      if (q)
        rows = rows.filter((row) =>
          [row.case_no, row.applicant_name_masked, row.tool_name].some((value) =>
            value.toLowerCase().includes(q),
          ),
        )

      const total = rows.length
      const start = (page - 1) * pageSize
      return HttpResponse.json({ items: rows.slice(start, start + pageSize), total })
    }),

    http.get('/api/admin/applications/:case_no', ({ params }) => {
      const found = cases[String(params.case_no)]
      return found ? HttpResponse.json(found) : HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
    }),

    http.get('/api/admin/applications/:case_no/documents/:doc_id/url', () =>
      HttpResponse.json({
        // 1×1 透明 PNG：不打外部網路，也不放任何真實影像。
        url:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
    ),

    http.post('/api/admin/applications/:case_no/documents/:doc_id/ocr', async ({ params, request }) => {
      const found = cases[String(params.case_no)]
      if (!found) return HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
      const body = (await request.json()) as { ocr: { confidence: number; lines: unknown[] } }
      const document = found.documents.find((doc) => doc.id === String(params.doc_id))
      if (document)
        document.ocr = {
          source: 'reviewer',
          engine: 'tesseract.js@6',
          confidence: body.ocr.confidence,
          lines: body.ocr.lines as never,
        }
      return HttpResponse.json({ findings: found.findings })
    }),

    http.post('/api/admin/applications/:case_no/evaluate', ({ params }) => {
      const found = cases[String(params.case_no)]
      if (!found) return HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
      return HttpResponse.json({ findings: found.findings, verdict: found.verdict })
    }),

    http.put('/api/admin/applications/:case_no/findings/:rule_code', async ({ params, request }) => {
      const found = cases[String(params.case_no)]
      if (!found) return HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
      const body = (await request.json()) as { status: string; extracted_value?: string; note?: string }
      const ruleCode = String(params.rule_code)
      const previous = found.findings.find((item) => item.rule_code === ruleCode)
      if (previous) previous.superseded = true
      found.findings = [
        {
          ...(previous ?? {
            id: `finding-${ruleCode}`,
            rule_code: ruleCode,
            rule_id: null,
            extracted_value: null,
            expected_value: null,
            confidence: null,
            bbox: null,
            document_type_code: null,
            document_id: null,
          }),
          id: `finding-${ruleCode}-reviewer`,
          rule_code: ruleCode,
          status: body.status as never,
          extracted_value: body.extracted_value ?? previous?.extracted_value ?? null,
          note: body.note ?? null,
          source: 'reviewer',
          reviewer: { id: CURRENT_USER.id, name: CURRENT_USER.name },
          decided_at: new Date().toISOString(),
          superseded: false,
        } as never,
        ...found.findings,
      ]
      // 覆寫成 MATCH 之後，擋住核定的那一條就不再是 blocker。
      if (body.status === 'MATCH')
        found.approval_blockers = found.approval_blockers.filter((blocker) => blocker.rule_code !== ruleCode)
      return HttpResponse.json({ findings: found.findings })
    }),

    http.post('/api/admin/applications/:case_no/transitions', async ({ params, request }) => {
      const found = cases[String(params.case_no)]
      if (!found) return HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
      const body = (await request.json()) as {
        code: string
        reason?: string
        rejection_codes?: string[]
        supplement_items?: { document_type_code: string; rejection_code: string; note: string }[]
        supplement_deadline?: string
      }
      const transition = found.allowed_transitions.find((item) => item.code === body.code)
      if (!transition)
        return HttpResponse.json(
          { code: 'TRANSITION_NOT_ALLOWED', blockers: found.approval_blockers },
          { status: 409 },
        )
      if (body.code === 'T3' && found.approval_blockers.length > 0)
        return HttpResponse.json(
          { code: 'TRANSITION_NOT_ALLOWED', blockers: found.approval_blockers },
          { status: 409 },
        )

      found.status = transition.to_status
      if (body.supplement_items) found.supplement_items = body.supplement_items
      if (body.supplement_deadline) found.supplement_deadline = body.supplement_deadline
      found.events.push({
        transition_code: body.code,
        from_status: null,
        to_status: transition.to_status,
        actor_type: 'STAFF',
        actor_name: CURRENT_USER.name,
        created_at: new Date().toISOString(),
        reason: body.reason ?? null,
        rejection_codes: body.rejection_codes ?? [],
      })
      found.allowed_transitions = []
      // 契約：轉移成功回 201。
      return HttpResponse.json({ status: found.status, events: found.events }, { status: 201 })
    }),

    http.post('/api/admin/applications/:case_no/assign', async ({ params, request }) => {
      const found = cases[String(params.case_no)]
      if (!found) return HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 })
      const { reviewer_id } = (await request.json()) as { reviewer_id: string | null }
      const reviewer = REVIEWERS.find((item) => item.id === reviewer_id) ?? null
      found.assigned_reviewer = reviewer
      found.assigned_reviewer_id = reviewer?.id ?? null
      return HttpResponse.json({ assigned_reviewer: reviewer })
    }),

    http.get('/api/admin/reviewers', () =>
      options.reviewers
        ? HttpResponse.json(REVIEWERS)
        : // 真後端目前沒有這支端點；預設模擬它不存在，指派選單就會停用。
          HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
    ),

    // 退件原因與文件標籤目前只能從公開的方案端點借（見 README「契約缺口」）。
    http.get('/api/apply/schemes/:code', () => HttpResponse.json(SCHEME_SETTINGS)),
  ]
}

export const handlers = createHandlers()
