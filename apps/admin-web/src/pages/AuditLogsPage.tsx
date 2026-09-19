import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { get } from '../lib/api'
import { Badge, Empty, Input, Select, Spinner } from '../components/ui'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../components/admin/shared'

interface AuditItem {
  id: string; actor_name: string; action: string; target_type: string; target_id: string
  diff: Record<string, unknown>; created_at: string
}
interface AuditPage { items: AuditItem[]; total: number; offset: number; limit: number }

export default function AuditLogsPage() {
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const params = new URLSearchParams({ limit: '100' })
  if (actor.trim()) params.set('actor', actor.trim())
  if (action) params.set('action', action)
  if (targetType) params.set('target_type', targetType)
  const q = useQuery({ queryKey: ['audit-logs', actor, action, targetType],
    queryFn: () => get<AuditPage>(`/api/admin/audit-logs?${params}`) })

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="稽核日誌" description="後台設定與案件操作的不可變紀錄；只顯示欄位差異，不複製申請人的文件或個資。" />
      <div className="grid gap-2 rounded-xl border border-border bg-canvas p-3 sm:grid-cols-3">
        <Input aria-label="依操作者篩選" placeholder="操作者" value={actor} onChange={(e) => setActor(e.target.value)} />
        <Select aria-label="依動作篩選" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">全部動作</option><option value="create">建立</option><option value="update">更新</option>
          <option value="delete">刪除</option><option value="publish">發布</option><option value="finding_override">覆寫判定</option>
        </Select>
        <Input aria-label="依資源類型篩選" placeholder="資源類型，例如 scheme" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
      </div>
      {q.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {q.error && <Notice tone="warn">{q.error instanceof Error ? q.error.message : '載入失敗'}</Notice>}
      {q.data && !q.data.items.length && <Empty>沒有符合條件的稽核紀錄。</Empty>}
      {q.data && q.data.items.length > 0 && <>
        <div className="text-xs text-muted">共 {q.data.total} 筆，顯示最新 {q.data.items.length} 筆</div>
        <Table><thead><tr><Th>時間</Th><Th>操作者</Th><Th>動作</Th><Th>資源</Th><Th>差異</Th></tr></thead>
          <tbody>{q.data.items.map((row) => <tr key={row.id}>
            <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.created_at)}</Td>
            <Td>{row.actor_name || '系統'}</Td><Td><Badge tone="accent">{row.action}</Badge></Td>
            <Td><div className="font-medium">{row.target_type}</div><div className="max-w-48 truncate font-mono text-[11px] text-muted" title={row.target_id}>{row.target_id || '—'}</div></Td>
            <Td><pre className="max-h-32 max-w-xl overflow-auto whitespace-pre-wrap break-all rounded bg-background-lite p-2 font-mono text-[11px]">{JSON.stringify(row.diff, null, 2)}</pre></Td>
          </tr>)}</tbody></Table>
      </>}
    </div>
  )
}
