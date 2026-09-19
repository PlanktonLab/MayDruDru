/**
 * 推播紀錄（SPEC §8.7）——案件狀態一變，worker 就往 LINE 送一則通知。
 *
 * 這一頁回答的是「民眾到底收到了沒有」。`skipped` 不是錯誤：那是民眾根本沒綁
 * LINE，承辦人要改用電話或信件通知，所以它和 `failed` 要分得清清楚楚。
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircleMore, Send } from 'lucide-react'
import { useState } from 'react'
import type { NotificationStatus } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { Badge, Button, Empty, Input, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../../components/admin/shared'
import { NOTIFICATION_STATUS_LABEL, NOTIFICATION_STATUS_TONE } from './labels'
import { fetchFeedback, fetchNotifications, sendDemoNotification } from './queries'

const FILTERS: { value: '' | NotificationStatus; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'queued', label: NOTIFICATION_STATUS_LABEL.queued },
  { value: 'sent', label: NOTIFICATION_STATUS_LABEL.sent },
  { value: 'failed', label: NOTIFICATION_STATUS_LABEL.failed },
  { value: 'skipped', label: NOTIFICATION_STATUS_LABEL.skipped },
]

export default function LineNotificationsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'' | NotificationStatus>('')
  const [caseNo, setCaseNo] = useState('')
  const [sending, setSending] = useState(false)
  const query = useQuery({
    queryKey: ['line-notifications', status, caseNo.trim()],
    queryFn: () => fetchNotifications({ status: status || undefined, case_no: caseNo.trim() || undefined, limit: 100 }),
  })
  const items = query.data?.items ?? []
  const feedback = useQuery({ queryKey: ['line-feedback'], queryFn: () => fetchFeedback(100) })

  const sendDemo = async () => {
    const target = caseNo.trim()
    if (!target) {
      toast('請先輸入要示範的案件編號', 'err')
      return
    }
    setSending(true)
    try {
      const result = await sendDemoNotification({ case_no: target, document_code: 'BILLING_STATEMENT' })
      await queryClient.invalidateQueries({ queryKey: ['line-notifications'] })
      toast(result.queued
        ? `已排入 ${result.queued} 則 LINE 缺件提醒`
        : '這件案件尚未綁定 LINE，用戶不會收到推播')
    } catch (error) {
      toast(errMsg(error), 'err')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="推播紀錄"
        description="案件狀態改變時主動送到民眾 LINE 的訊息。「未綁定 LINE」不是失敗——那位民眾是用網頁送件的，請改用其他方式通知。"
      />

      {can('admin') && (
        <section className="rounded-xl border border-accent/30 bg-accent-bg p-4" aria-label="LINE Demo 發送">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Send size={15} /> Demo 缺件通知</div>
              <p className="mt-1 text-xs leading-5 text-muted">輸入案件編號後，會向已關注／綁定此案件的 LINE 用戶發送信用卡消費紀錄缺件提醒，並附上完整 SOP 教學按鈕。</p>
              <Input className="mt-2 max-w-sm" value={caseNo} onChange={(event) => setCaseNo(event.target.value)} placeholder="例如 HC-2026-900001" aria-label="Demo 案件編號" />
            </div>
            <Button variant="primary" loading={sending} onClick={() => void sendDemo()}><Send size={14} /> Demo 發送</Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="狀態篩選" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`min-h-9 rounded-full border px-3 py-1 text-[13px] ${status === f.value ? 'border-accent bg-accent-bg text-accent' : 'border-border bg-canvas text-muted hover:text-primary'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="搜尋案件編號" aria-label="搜尋案件編號" className="max-w-[220px]" />
      </div>

      {query.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
      {query.data && !items.length && <Empty>這個條件下沒有推播紀錄</Empty>}
      {!!items.length && (
        <Table>
          <thead><tr><Th className="w-36">案件編號</Th><Th>轉移</Th><Th className="w-28">狀態</Th><Th>錯誤</Th><Th className="w-36">建立時間</Th><Th className="w-36">送出時間</Th></tr></thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="hover:bg-background-lite">
                <Td className="whitespace-nowrap font-mono text-xs">{row.case_no || '—'}</Td>
                <Td className="text-xs text-muted">{row.transition_code || row.kind || '—'}</Td>
                <Td><Badge tone={NOTIFICATION_STATUS_TONE[row.status] ?? 'muted'}>{NOTIFICATION_STATUS_LABEL[row.status] ?? row.status}</Badge></Td>
                <Td className="max-w-sm text-xs text-danger"><span className="block truncate" title={row.error ?? undefined}>{row.error || '—'}</span></Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.created_at)}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.sent_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <section className="space-y-3 pt-3" aria-labelledby="feedback-heading">
        <div>
          <h2 id="feedback-heading" className="flex items-center gap-2 text-base font-semibold"><MessageCircleMore size={17} /> 用戶 Feedback</h2>
          <p className="mt-1 text-xs text-muted">LINE 功能或 SOP 教學完成後由用戶主動留下；帳號只顯示不可逆雜湊前八碼。</p>
        </div>
        {feedback.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入回饋…</div>}
        {feedback.error && <Notice tone="warn">{errMsg(feedback.error)}</Notice>}
        {feedback.data && !feedback.data.items.length && <Empty>目前還沒有用戶回饋</Empty>}
        {!!feedback.data?.items.length && (
          <Table>
            <thead><tr><Th>回饋內容</Th><Th className="w-32">情境</Th><Th className="w-36">案件編號</Th><Th className="w-28">帳號雜湊</Th><Th className="w-36">時間</Th></tr></thead>
            <tbody>
              {feedback.data.items.map((row) => (
                <tr key={row.id} className="hover:bg-background-lite">
                  <Td className="max-w-xl"><span className="block whitespace-pre-wrap break-words">{row.text}</span></Td>
                  <Td><Badge tone="accent">{row.context || 'general'}</Badge></Td>
                  <Td className="font-mono text-xs">{row.case_no || '—'}</Td>
                  <Td className="font-mono text-xs text-muted">{row.user_hash || '—'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
