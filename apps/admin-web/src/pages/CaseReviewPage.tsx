/** `/cases/:case_no` — 案件頁（SPEC §8.2）。
 *
 * 版面就是審核的順序：左邊是文件（畫面主體，SPEC §15.2），右邊是申請資料、規則判定、
 * 金額比對、決策列與事件時間軸。「定位」把 finding 的 bbox 丟給左邊畫框，
 * 「重新辨識」在**承辦自己的瀏覽器**跑 tesseract（SPEC §8.2 最後一列），結果回存為
 * `source=reviewer`，證明文件一樣不離開這台電腦以外的地方。
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ListChecks, ShieldAlert } from 'lucide-react'
import { Badge, Card, Select, Spinner, Timeline, type TimelineEvent } from '@maydru/ui'
import { createOcrWorker, disposeCanvas, pdfToPageCanvases, recognize, type OcrLine, type OcrResult } from '@maydru/ocr'
import { ComparePanel } from '../cases/ComparePanel'
import { DecisionBar } from '../cases/DecisionBar'
import { DocumentViewer } from '../cases/DocumentViewer'
import { FindingsPanel } from '../cases/FindingsPanel'
import { renderNote } from '../cases/reviewNotes'
import {
  assignReviewer,
  documentUrl,
  overrideFinding,
  putDocumentOcr,
  runTransition,
  useCaseDetail,
  useReviewers,
} from '../cases/api'
import { STATUS_STAFF_LABEL, STATUS_TONE, VERDICT_LABEL, actorLabel, date, dateTime, money } from '../cases/labels'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL, type Role } from '../lib/types'
import { errMsg, useToast } from '../components/ui'
import { PageHeader } from '../components/admin/shared'
import type { BoundingBox } from '@maydru/review-rules'
import type { CaseDocument, DocumentTypeOption } from '../cases/types'

function shiftLines(lines: OcrLine[], dy: number): OcrLine[] {
  return lines.map((line) => ({
    ...line,
    bbox: { ...line.bbox, y0: line.bbox.y0 + dy, y1: line.bbox.y1 + dy },
    words: line.words.map((word) => ({
      ...word,
      bbox: { ...word.bbox, y0: word.bbox.y0 + dy, y1: word.bbox.y1 + dy },
    })),
  }))
}

export function mergePageOcr(results: OcrResult[], pageHeights: number[]): OcrResult {
  let offset = 0
  const lines: OcrLine[] = []
  results.forEach((result, index) => {
    lines.push(...shiftLines(result.lines, offset))
    offset += pageHeights[index] ?? 0
  })
  const confidences = results.map((result) => result.confidence).filter((value) => value > 0)
  return {
    text: results.map((result) => result.text).join('\n'),
    confidence: confidences.length
      ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
      : 0,
    lines,
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13.5px] text-primary">{value}</dd>
    </div>
  )
}

export default function CaseReviewPage() {
  const { case_no: caseNo = '' } = useParams()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const detail = useCaseDetail(caseNo)
  const caseData = detail.data
  const reviewers = useReviewers()

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ ruleCode: string; bbox: BoundingBox | null; key: number } | null>(null)
  const [recognising, setRecognising] = useState(false)
  const [recogniseProgress, setRecogniseProgress] = useState(0)

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['admin-case', caseNo] }),
    [caseNo, queryClient],
  )

  const loadUrl = useCallback(
    async (documentId: string) => (await documentUrl(caseNo, documentId)).url,
    [caseNo],
  )

  const onLocate = useCallback(
    (finding: { rule_code: string; bbox: BoundingBox | null; document_id: string | null }) => {
      if (finding.document_id) setSelectedDocumentId(finding.document_id)
      setFocus((current) => ({
        ruleCode: finding.rule_code,
        bbox: finding.bbox,
        key: (current?.key ?? 0) + 1,
      }))
    },
    [],
  )

  /** 重新辨識：在承辦的瀏覽器跑 tesseract，只把結果 POST 回去（SPEC §8.2、§11）。 */
  const reRecognise = useCallback(
    async (document: CaseDocument) => {
      setRecognising(true)
      setRecogniseProgress(0)
      let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null
      let pdfCanvases: HTMLCanvasElement[] = []
      try {
        const { url } = await documentUrl(caseNo, document.id)
        let currentPage = 0
        let pageCount = 1
        worker = await createOcrWorker({
          onProgress: (progress) => setRecogniseProgress((currentPage + progress) / pageCount),
        })
        let result: OcrResult
        if (document.mime === 'application/pdf') {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`PDF 下載失敗（${response.status}）`)
          const pages = await pdfToPageCanvases(await response.blob(), { maxPages: 5 })
          pdfCanvases = pages.canvases
          pageCount = pdfCanvases.length
          const results: OcrResult[] = []
          for (let index = 0; index < pdfCanvases.length; index++) {
            currentPage = index
            results.push(await recognize(worker, pdfCanvases[index]))
          }
          result = mergePageOcr(results, pdfCanvases.map((canvas) => canvas.height))
        } else {
          result = await recognize(worker, url)
        }
        await putDocumentOcr(caseNo, document.id, result)
        await refresh()
        toast('已用重新辨識的結果重跑規則')
      } catch (cause) {
        toast(errMsg(cause), 'err')
      } finally {
        pdfCanvases.forEach(disposeCanvas)
        await worker?.terminate().catch(() => {})
        setRecognising(false)
        setRecogniseProgress(0)
      }
    },
    [caseNo, refresh, toast],
  )

  const events = useMemo<TimelineEvent[]>(() => {
    if (!caseData) return []
    return [...caseData.events]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((event, index) => ({
        key: `${event.transition_code}-${event.created_at}-${index}`,
        title: `${STATUS_STAFF_LABEL[event.to_status]}${event.transition_code ? `（${event.transition_code}）` : ''}`,
        at: dateTime(event.created_at),
        tone: STATUS_TONE[event.to_status],
        description: [
          actorLabel(event),
          event.reason,
          event.rejection_codes.length ? `退件原因：${event.rejection_codes.join('、')}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }))
  }, [caseData])

  if (detail.isLoading) return <div className="p-8 text-sm text-muted"><Spinner /> 載入案件…</div>
  if (detail.error || !caseData)
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-danger">{errMsg(detail.error) || '案件載入失敗。'}</p>
        <Link to="/cases" className="mt-3 inline-flex text-sm text-accent underline">回佇列</Link>
      </div>
    )

  /** 補件表單的選項：方案設定裡「這件案子真的要附」的那幾種文件。 */
  const settings = caseData.scheme_settings
  const documentTypes: DocumentTypeOption[] = settings.document_types.filter((type) =>
    caseData.required_document_types.includes(type.code),
  )
  const currentDocumentTypes = new Set(
    caseData.documents.filter((document) => document.is_current).map((document) => document.document_type_code),
  )
  const missingDocuments = caseData.required_document_types
    .filter((code) => !currentDocumentTypes.has(code))
    .map((code) => settings.document_types.find((type) => type.code === code)?.label || code)
  const findingsPanel = (
    <FindingsPanel
      findings={caseData.findings.map((finding) => ({
        ...finding,
        note: finding.note_text || renderNote(finding.note),
      }))}
      rules={caseData.rules}
      missingDocuments={missingDocuments}
      focusedRuleCode={focus?.ruleCode ?? null}
      onLocate={onLocate}
      canReview={can('case_review')}
      onOverride={async (ruleCode, body) => {
        await overrideFinding(caseNo, ruleCode, body)
        await refresh()
        toast('已寫入人工判定')
      }}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pt-6">
        <Link to="/cases" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-primary">
          <ArrowLeft size={14} /> 回佇列
        </Link>
        <PageHeader
          title={caseData.case_no}
          description={`${caseData.scheme_name} · 第一次送件 ${dateTime(caseData.first_submitted_at)}`}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/review-settings?scheme=${encodeURIComponent(caseData.scheme_code)}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[13px] text-muted hover:bg-background-lite hover:text-primary">
                <ListChecks size={13} /> 資料重點設定
              </Link>
              <Badge tone={STATUS_TONE[caseData.status]}>{STATUS_STAFF_LABEL[caseData.status]}</Badge>
              {caseData.verdict && (
                <span className="text-[13px] text-muted">{VERDICT_LABEL[caseData.verdict] ?? caseData.verdict}</span>
              )}
            </span>
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 pt-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section
          aria-label="文件檢視器"
          className="min-h-[60vh] overflow-hidden rounded-2xl border border-border bg-canvas"
        >
          <DocumentViewer
            documents={caseData.documents}
            selectedId={selectedDocumentId}
            onSelect={(documentId) => {
              setSelectedDocumentId(documentId)
              setFocus(null)
            }}
            loadUrl={loadUrl}
            focusBbox={focus?.bbox ?? null}
            focusKey={focus?.key ?? 0}
            findings={caseData.findings}
            onReRecognise={can('case_review') ? (doc) => void reRecognise(doc) : undefined}
            recognising={recognising}
            recogniseProgress={recogniseProgress}
            reviewContext={{
              caseNo: caseData.case_no,
              applicant: caseData.applicant_name,
              scheme: caseData.scheme_name,
              status: STATUS_STAFF_LABEL[caseData.status],
              amount: money(caseData.purchase_amount),
              reviewer: caseData.assigned_reviewer?.name ?? '未指派',
              missingCount: missingDocuments.length,
            }}
          />
        </section>

        <aside aria-label="審核面板" className="min-h-0 space-y-4 overflow-auto">
          {findingsPanel}

          <Card title="申請概況">
            <dl className="divide-y divide-border">
              <Row label="申請人" value={caseData.applicant_name} />
              <Row label="手機" value={caseData.phone_masked} />
              <Row label="身分證末四碼" value={caseData.id_last4_masked} />
              {caseData.email && <Row label="Email" value={caseData.email} />}
              <Row label="工具" value={caseData.tool_name} />
              <Row label="級距／管道" value={`${caseData.tier_code} · ${caseData.payment_channel_code}`} />
              <Row label="購買日期" value={date(caseData.purchase_date)} />
              <Row label="申報金額" value={money(caseData.purchase_amount)} />
              {caseData.paid_by_proxy && <Row label="付款人" value="由他人代為支付" />}
              {caseData.approved_amount != null && <Row label="核定金額" value={money(caseData.approved_amount)} />}
              {caseData.supplement_deadline && (
                <Row label="補件期限" value={date(caseData.supplement_deadline)} />
              )}
              {caseData.note && <Row label="申請人備註" value={caseData.note} />}
              <Row label="來源" value={caseData.intake_channel} />
            </dl>
            {caseData.documents_purge_at && (
              <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-5 text-muted">
                <ShieldAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
                文件將於 {date(caseData.documents_purge_at)} 依保存期限硬刪。
              </p>
            )}
          </Card>

          <Card title="指派審核人">
            <Select
              aria-label="指派審核人"
              value={caseData.assigned_reviewer?.id ?? ''}
              disabled={!can('case_review') || !reviewers.data?.length}
              onChange={async (event) => {
                try {
                  await assignReviewer(caseNo, event.target.value || null)
                  await refresh()
                  toast('已更新指派')
                } catch (cause) {
                  toast(errMsg(cause), 'err')
                }
              }}
            >
              <option value="">未指派</option>
              {(reviewers.data ?? []).map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}（{ROLE_LABEL[reviewer.role as Role] ?? reviewer.role}）
                </option>
              ))}
            </Select>
            {!reviewers.isLoading && !reviewers.data?.length && (
              <p className="mt-2 text-[12px] text-muted">
                {reviewers.error
                  ? '審核人名單載入失敗，指派先停用。'
                  : '這個機關還沒有具審核權限的帳號，請先到「成員」新增。'}
              </p>
            )}
          </Card>

          <ComparePanel
            claimed={caseData.purchase_amount}
            findings={caseData.findings}
            rules={caseData.rules}
          />

          <DecisionBar
            transitions={caseData.allowed_transitions}
            blockers={caseData.approval_blockers}
            rejectionCodes={settings.rejection_codes}
            documentTypes={documentTypes}
            supplementDays={settings.supplement_days}
            onSubmit={async (input) => {
              await runTransition(caseNo, input)
              await refresh()
              toast('已更新案件狀態')
            }}
          />

          <Card title="事件時間軸" subtitle="每一次轉移都是不可變的紀錄。">
            <Timeline events={events} currentKey={events[0]?.key} />
          </Card>
        </aside>
      </div>
    </div>
  )
}
