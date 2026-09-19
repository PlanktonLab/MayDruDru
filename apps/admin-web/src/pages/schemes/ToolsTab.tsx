/**
 * 合格工具與待審工具佇列（SPEC §6.2 `eligible_tools`、§8.2「方案管理」）。
 *
 * 待審佇列是民眾在送件時打了、但清單上還沒有的工具名稱。處理它有三個答案，而且
 * 最常見的是第三個：**併入既有的那一筆**。「chatgpt 訂閱」「ChatGPT Plus 年繳」
 * 講的都是同一個東西，併進去以後下一個人打同樣的字就直接對上，佇列也不會再冒出
 * 同一個工具的第七種寫法。
 */

import { useState } from 'react'
import { Check, Merge, X } from 'lucide-react'
import { Badge, Button, Card, Empty, Input, Select } from '../../components/ui'
import { Chips } from '../../components/admin/TagInput'
import { Notice, Table, Td, Th } from '../../components/admin/shared'
import { ChildTab, useRunner, type Column } from './ChildTab'
import type { FieldSpec } from './fields'
import { resolveTool } from './queries'
import type { EligibleTool, ToolStatus } from './types'

const STATUS_LABEL: Record<ToolStatus, string> = { APPROVED: '可申請', PENDING: '待審', REJECTED: '不適用' }
const STATUS_TONE: Record<ToolStatus, 'good' | 'warn' | 'danger'> = { APPROVED: 'good', PENDING: 'warn', REJECTED: 'danger' }

const SPECS: FieldSpec[] = [
  { name: 'name', label: '工具名稱', required: true, kind: 'text' },
  { name: 'vendor', label: '廠商', kind: 'text' },
  { name: 'aliases', label: '別名', hint: '民眾可能打出來的其他寫法，輸入後按 Enter', wide: true, kind: 'tags' },
  { name: 'status', label: '狀態', kind: 'select',
    options: (Object.keys(STATUS_LABEL) as ToolStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
  { name: 'verdict_note', label: '判定說明', hint: '為什麼可以／不可以，留給下一個承辦人看', wide: true, kind: 'textarea' },
]

/** 待審佇列：每一列三個出口——核可、不適用、併入既有的工具。 */
export function PendingQueue({ code, pending, approved, canWrite, reload }: {
  code: string
  pending: EligibleTool[]
  approved: EligibleTool[]
  canWrite: boolean
  reload: () => void
}) {
  const { busy, run } = useRunner(reload)
  const [mergeInto, setMergeInto] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})

  const resolve = (tool: EligibleTool, status: ToolStatus, merge?: string) =>
    run(
      () => resolveTool(code, tool.id, { status, verdict_note: note[tool.id] ?? '', merge_into_id: merge ?? null }),
      merge ? '已併入既有的工具' : status === 'APPROVED' ? '已核可' : '已標為不適用',
    )

  return (
    <Card title={`待審工具（${pending.length}）`}>
      {!pending.length ? (
        <Empty>目前沒有等著處理的工具名稱</Empty>
      ) : (
        <div className="space-y-3">
          <Notice tone="muted">
            這些是民眾查詢資格或送件時自己打的工具名稱。先看看它是不是清單上某個工具的另一種寫法——
            是的話請併入，民眾下次打同樣的字就會直接對上。
          </Notice>
          <Table>
            <thead>
              <tr>
                <Th>民眾打的名稱</Th>
                <Th className="w-20">查詢次數</Th>
                <Th className="w-20">自填送件</Th>
                <Th>判定說明</Th>
                <Th className="w-72">處理</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((tool) => (
                <tr key={tool.id} className="align-top">
                  <Td><span className="font-medium">{tool.name}</span></Td>
                  <Td className="tabular-nums">{tool.inquiry_count ?? 0}</Td>
                  <Td className="tabular-nums">{tool.request_count}</Td>
                  <Td>
                    <Input
                      aria-label={`${tool.name} 的判定說明`}
                      value={note[tool.id] ?? ''}
                      disabled={!canWrite || busy}
                      onChange={(e) => setNote((n) => ({ ...n, [tool.id]: e.target.value }))}
                      placeholder="為什麼可以／不可以"
                    />
                  </Td>
                  <Td>
                    <div className="space-y-1.5">
                      <div className="flex gap-1">
                        <Button size="sm" variant="good" disabled={!canWrite || busy}
                                onClick={() => void resolve(tool, 'APPROVED')}>
                          <Check size={13} /> 核可
                        </Button>
                        <Button size="sm" variant="danger" disabled={!canWrite || busy}
                                onClick={() => void resolve(tool, 'REJECTED')}>
                          <X size={13} /> 不適用
                        </Button>
                      </div>
                      <div className="flex gap-1">
                        <Select
                          aria-label={`把 ${tool.name} 併入`}
                          value={mergeInto[tool.id] ?? ''}
                          disabled={!canWrite || busy}
                          className="min-w-0 flex-1"
                          onChange={(e) => setMergeInto((m) => ({ ...m, [tool.id]: e.target.value }))}
                        >
                          <option value="">併入既有工具…</option>
                          {approved.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                        <Button size="sm" disabled={!canWrite || busy || !mergeInto[tool.id]}
                                onClick={() => void resolve(tool, 'APPROVED', mergeInto[tool.id])}>
                          <Merge size={13} /> 併入
                        </Button>
                      </div>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

export default function ToolsTab({ code, tools, pending, canWrite, reload }: {
  code: string
  tools: EligibleTool[]
  pending: EligibleTool[]
  canWrite: boolean
  reload: () => void
}) {
  const columns: Column<EligibleTool>[] = [
    { label: '名稱', render: (t) => t.name },
    { label: '查詢次數', render: (t) => t.inquiry_count ?? 0 },
    { label: '自填送件次數', render: (t) => t.request_count },
    { label: '廠商', render: (t) => t.vendor || '—' },
    { label: '別名', render: (t) => <Chips items={t.aliases ?? []} /> },
    { label: '狀態', render: (t) => <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge> },
    { label: '判定說明', render: (t) => <span className="text-xs text-muted">{t.verdict_note || '—'}</span> },
  ]
  return (
    <div className="space-y-4">
      <PendingQueue code={code} pending={pending} approved={tools.filter((t) => t.status === 'APPROVED')}
                    canWrite={canWrite} reload={reload} />
      <ChildTab<EligibleTool>
        code={code}
        kind="eligible-tools"
        rows={tools}
        specs={SPECS}
        columns={columns}
        blank={{ name: '', vendor: '', aliases: [], status: 'APPROVED', verdict_note: '' }}
        canWrite={canWrite}
        reload={reload}
        addLabel="新增工具"
        empty="這個方案還沒有列出任何可申請的工具。"
      />
    </div>
  )
}
