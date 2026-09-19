/**
 * 推播紀錄（SPEC §8.7）——案件狀態一變，worker 就往 LINE 送一則通知。
 *
 * 這一頁回答的是「民眾到底收到了沒有」。`skipped` 不是錯誤：那是民眾根本沒綁
 * LINE，承辦人要改用電話或信件通知，所以它和 `failed` 要分得清清楚楚。
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { NotificationStatus } from '../../lib/types'
import { Badge, Empty, Input, Spinner, errMsg } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../../components/admin/shared'
import { NOTIFICATION_STATUS_LABEL, NOTIFICATION_STATUS_TONE } from './labels'
import { fetchNotifications } from './queries'

const FILTERS: { value: '' | NotificationStatus; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'queued', label: NOTIFICATION_STATUS_LABEL.queued },
  { value: 'sent', label: NOTIFICATION_STATUS_LABEL.sent },
  { value: 'failed', label: NOTIFICATION_STATUS_LABEL.failed },
  { value: 'skipped', label: NOTIFICATION_STATUS_LABEL.skipped },
]

export default function LineNotificationsPage() {
  const [status, setStatus] = useState<'' | NotificationStatus>('')
  const [caseNo, setCaseNo] = useState('')
  const query = useQuery({
    queryKey: ['line-notifications', status, caseNo.trim()],
    queryFn: () => fetchNotifications({ status: status || undefined, case_no: caseNo.trim() || undefined, limit: 100 }),
  })
  const items = query.data?.items ?? []

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="推播紀錄"
        description="案件狀態改變時主動送到民眾 LINE 的訊息。「未綁定 LINE」不是失敗——那位民眾是用網頁送件的，請改用其他方式通知。"
      />

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
    </div>
  )
}
