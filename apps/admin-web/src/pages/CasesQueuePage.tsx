/** `/cases` — 案件審核佇列（SPEC §8.2）。
 *
 * 排序固定以 `first_submitted_at` 遞增（SPEC §7「排隊順序」）：補件**不重排**，
 * 所以這裡不提供排序切換——能改排序的清單，遲早會有人改了之後忘記改回來。
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Select, Spinner } from '@maydru/ui'
import { DEFAULT_FILTERS, useCaseQueue, type QueueFilters } from '../cases/api'
import { QUEUE_STATUSES, STATUS_STAFF_LABEL, STATUS_TONE, VERDICT_LABEL, dateTime, money } from '../cases/labels'
import { errMsg } from '../components/ui'
import { PageHeader, Table, Td, Th } from '../components/admin/shared'

export default function CasesQueuePage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS)
  const query = useCaseQueue(filters)
  const rows = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / filters.page_size))

  // 換篩選條件一律回到第一頁，不然會停在一個不存在的頁數上看到空白。
  const patch = (next: Partial<QueueFilters>) => setFilters((current) => ({ ...current, page: 1, ...next }))

  const schemes = [...new Set(rows.map((row) => row.scheme_code))]

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader title="案件審核" description="依第一次送件時間排序；補件不會重新排隊。" />

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[13px] text-muted">
          搜尋
          <span className="relative">
            <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <Input
              value={filters.q}
              onChange={(event) => patch({ q: event.target.value })}
              placeholder="案件編號、姓名、工具名稱"
              className="pl-9"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-muted">
          狀態
          <Select value={filters.status} onChange={(event) => patch({ status: event.target.value })} className="w-40">
            <option value="">全部</option>
            {QUEUE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_STAFF_LABEL[status]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-muted">
          方案
          <Select value={filters.scheme} onChange={(event) => patch({ scheme: event.target.value })} className="w-40">
            <option value="">全部</option>
            {schemes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-muted">
          指派
          <Select value={filters.assigned} onChange={(event) => patch({ assigned: event.target.value })} className="w-32">
            <option value="">全部</option>
            <option value="me">指派給我</option>
            <option value="none">尚未指派</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-muted">
          規則判定
          <Select value={filters.verdict} onChange={(event) => patch({ verdict: event.target.value })} className="w-36">
            <option value="">全部</option>
            <option value="PASS">全數符合</option>
            <option value="FAIL">有不符</option>
            <option value="INDETERMINATE">無法辨識</option>
          </Select>
        </label>
      </div>

      {query.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Spinner /> 載入中…
        </div>
      ) : query.error ? (
        <p role="alert" className="mt-8 text-sm text-danger">
          {errMsg(query.error)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="沒有符合條件的案件"
          hint="換個篩選條件，或清空搜尋字串再看一次。"
          action={<Button onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>}
        />
      ) : (
        <>
          <div className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>案件編號</Th>
                  <Th>申請人</Th>
                  <Th>方案</Th>
                  <Th>工具</Th>
                  <Th>申報金額</Th>
                  <Th>狀態</Th>
                  <Th>規則判定</Th>
                  <Th>審核人</Th>
                  <Th>第一次送件</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.case_no}
                    tabIndex={0}
                    onClick={() => navigate(`/cases/${encodeURIComponent(row.case_no)}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') navigate(`/cases/${encodeURIComponent(row.case_no)}`)
                    }}
                    className="cursor-pointer hover:bg-background-lite"
                  >
                    <Td>
                      <span className="font-mono text-[12.5px] tabular-nums">{row.case_no}</span>
                      {row.revision_count > 0 && (
                        <span className="ml-1.5 text-[11px] text-muted">補件 {row.revision_count} 次</span>
                      )}
                    </Td>
                    <Td>{row.applicant_name_masked}</Td>
                    <Td>{row.scheme_name}</Td>
                    <Td>{row.tool_name}</Td>
                    <Td className="tabular-nums">{money(row.purchase_amount)}</Td>
                    {/* 狀態是一顆標籤，不是一段文字：方案名稱再長也不該把「已撥款」折成兩行。 */}
                    <Td className="whitespace-nowrap">
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_STAFF_LABEL[row.status]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {row.verdict ? (
                        <span className="text-[12.5px] text-muted">{VERDICT_LABEL[row.verdict] ?? row.verdict}</span>
                      ) : (
                        <span className="text-[12.5px] text-secondary">—</span>
                      )}
                    </Td>
                    <Td>{row.assigned_reviewer?.name ?? <span className="text-secondary">未指派</span>}</Td>
                    <Td className="tabular-nums">{dateTime(row.first_submitted_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
            <span className="tabular-nums">
              共 {total} 件 · 第 {filters.page} / {pages} 頁
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={<ChevronLeft size={14} />}
                disabled={filters.page <= 1}
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              >
                上一頁
              </Button>
              <Button
                size="sm"
                disabled={filters.page >= pages}
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              >
                下一頁
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
