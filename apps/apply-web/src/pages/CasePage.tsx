/** `/status/:case_no` — 進度時間軸、下一步、補件、撤回（SPEC §8.1）。
 *
 * 沒有有效 token（或 token 過期）時，就地顯示查詢表單並把案號帶進去；
 * 剛送完件的人點「查看進度」過來，不會撞到一個空白的 401 畫面。
 */

import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, Modal, Spinner, Timeline, type TimelineEvent } from '@maydru/ui'
import { SupplementPanel } from '../status/SupplementPanel'
import { VerifyForm } from '../status/VerifyForm'
import { ApiError, caseToken } from '../lib/api'
import { dateTime, money, date } from '../lib/format'
import { useCase, useContentOverlay, useScheme, withdrawCase } from '../lib/queries'
import { STATUS_TONE, nextAction, publicLabel } from '../lib/status'
import type { CasePublic } from '../lib/types'

function events(caseData: CasePublic, overlay: Record<string, string>): TimelineEvent[] {
  // 最新的放最上面（SPEC §15.3）。
  return [...caseData.events]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((event, index) => ({
      key: `${event.transition_code}-${event.created_at}-${index}`,
      title: publicLabel(event.to_status, overlay),
      at: dateTime(event.created_at),
      tone: STATUS_TONE[event.to_status],
      description: index === 0 ? nextAction(event.to_status, overlay) : undefined,
    }))
}

export default function CasePage() {
  const { case_no: caseNo = '' } = useParams()
  const queryClient = useQueryClient()
  const [verified, setVerified] = useState(() => Boolean(caseToken.get()))
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [notice, setNotice] = useState('')

  const overlayQuery = useContentOverlay()
  const overlay = overlayQuery.data ?? {}
  const caseQuery = useCase(caseNo, verified)
  const caseData = caseQuery.data
  const schemeQuery = useScheme(caseData?.scheme.code)

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['apply', 'case', caseNo] })
  }, [caseNo, queryClient])

  const doWithdraw = useCallback(async () => {
    setWithdrawing(true)
    try {
      await withdrawCase(caseNo)
      setConfirmWithdraw(false)
      setNotice('已撤回這件申請。如果之後要重新申請，請從首頁重新送件。')
      refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '撤回沒有成功，請再試一次。')
    } finally {
      setWithdrawing(false)
    }
  }, [caseNo, refresh])

  const needsVerify =
    !verified || (caseQuery.error instanceof ApiError && caseQuery.error.status === 401)

  if (needsVerify)
    return (
      <section className="md-risein space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">查詢進度</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            為了保護你的資料，看案件內容前要先用末四碼確認一次。
          </p>
        </header>
        <VerifyForm
          initialCaseNo={caseNo}
          onVerified={() => {
            setVerified(true)
            refresh()
          }}
        />
      </section>
    )

  if (caseQuery.isLoading) return <Spinner label="載入案件…" />
  if (caseQuery.error || !caseData)
    return (
      <p role="alert" className="text-[14px] leading-6 text-danger">
        {caseQuery.error instanceof Error ? caseQuery.error.message : '案件載入失敗，請重新查詢一次。'}
      </p>
    )

  const showSupplement = caseData.can_supplement && caseData.supplement_items.length > 0

  return (
    <section className="md-risein space-y-5">
      <header>
        <p className="font-mono text-[13px] tabular-nums text-muted">{caseData.case_no}</p>
        {/* 狀態本身就是標題，不再用 badge 重講一次；方案名稱是說明，放下面一行——
            它很長，塞進 badge 會在手機寬度上折行壓到標題。 */}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{publicLabel(caseData.status, overlay)}</h1>
        <p className="mt-1 text-[14px] text-muted">{caseData.scheme.name}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{nextAction(caseData.status, overlay)}</p>
      </header>

      {notice && (
        <p role="status" className="rounded-xl bg-accent-bg px-3 py-2.5 text-[14px] leading-6 text-accent">
          {notice}
        </p>
      )}

      {showSupplement && (
        <SupplementPanel
          caseData={caseData}
          scheme={schemeQuery.data}
          onDone={() => {
            setNotice('補件已送出，承辦人員會再看一次。')
            refresh()
          }}
        />
      )}

      <Card title="申請內容">
        <dl className="divide-y divide-border">
          <div className="flex justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-muted">工具</dt>
            <dd className="text-[15px] text-primary">{caseData.tool_name}</dd>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-muted">申請金額</dt>
            <dd className="text-[15px] text-primary">{money(caseData.purchase_amount)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-muted">第一次送件</dt>
            <dd className="text-[15px] text-primary">{dateTime(caseData.first_submitted_at)}</dd>
          </div>
          {caseData.revision_count > 0 && (
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="text-[13px] text-muted">最近一次補件</dt>
              <dd className="text-[15px] text-primary">{dateTime(caseData.last_submitted_at)}</dd>
            </div>
          )}
          {caseData.payment_date && (
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="text-[13px] text-muted">撥款日期</dt>
              <dd className="text-[15px] text-primary">{date(caseData.payment_date)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title={`已上傳的文件（${caseData.documents.filter((doc) => doc.is_current).length} 份）`}>
        <ul className="space-y-1.5 text-[14px]">
          {caseData.documents
            .filter((doc) => doc.is_current)
            .map((doc) => {
              const label =
                schemeQuery.data?.document_types.find((type) => type.code === doc.document_type_code)?.label ??
                doc.document_type_code
              return (
                <li key={`${doc.document_type_code}-${doc.revision}`} className="flex justify-between gap-3">
                  <span className="truncate text-primary">{label}</span>
                  <span className="shrink-0 text-muted">
                    {doc.revision > 1 ? `第 ${doc.revision} 版 · ` : ''}
                    {dateTime(doc.uploaded_at)}
                  </span>
                </li>
              )
            })}
        </ul>
        <p className="mt-3 rounded-xl bg-background-lite px-3 py-2.5 text-[13px] leading-5 text-muted">
          這些證明文件在案件結案後會依規定期限自動刪除，也不會送給任何 AI 服務。
        </p>
      </Card>

      <Card title="案件歷程">
        <Timeline events={events(caseData, overlay)} currentKey={events(caseData, overlay)[0]?.key} />
      </Card>

      {caseData.can_withdraw && (
        <Button variant="ghost" size="md" block onClick={() => setConfirmWithdraw(true)}>
          撤回這件申請
        </Button>
      )}

      <Modal
        open={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        title="確定要撤回嗎？"
        subtitle="撤回之後這件案子就結案了，無法復原。要再申請必須重新送一件。"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmWithdraw(false)}>先不要</Button>
            <Button variant="danger" loading={withdrawing} onClick={() => void doWithdraw()}>
              確定撤回
            </Button>
          </div>
        }
      >
        <p className="text-[14px] leading-6 text-muted">
          案件編號 <span className="font-mono">{caseData.case_no}</span> 會標記為「已撤回」，已上傳的文件會依保存期限刪除。
        </p>
      </Modal>
    </section>
  )
}
