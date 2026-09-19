import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Select, Spinner, errMsg } from '../components/ui'
import { Notice, PageHeader } from '../components/admin/shared'
import ToolsTab from './schemes/ToolsTab'
import { fetchSchemes, fetchChildren } from './schemes/queries'
import type { EligibleTool } from './schemes/types'

export default function ToolKnowledgePage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const client = useQueryClient()
  const schemes = useQuery({ queryKey: ['schemes'], queryFn: fetchSchemes })
  const code = params.get('scheme') || schemes.data?.[0]?.code || ''
  const tools = useQuery({ queryKey: ['tool-knowledge', code], queryFn: () => fetchChildren<EligibleTool>(code, 'eligible-tools'), enabled: !!code })
  const rows = tools.data ?? []
  const pending = rows.filter((t) => t.status === 'PENDING').sort((a, b) => ((b.inquiry_count ?? 0) + b.request_count) - ((a.inquiry_count ?? 0) + a.request_count))
  return <div className="space-y-5 p-6">
    <PageHeader title="AI 工具知識庫" description="與申請端共用工具列表。優先處理自行填寫的工具，核可後加入列表；標為不適用後，下次申請會阻擋。" />
    <Select aria-label="申請方案" value={code} onChange={(e) => setParams({ scheme: e.target.value })}>
      {!schemes.data?.length && <option value="">尚無申請方案</option>}
      {schemes.data?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </Select>
    {(schemes.isLoading || tools.isLoading) && <Spinner />}
    {(schemes.error || tools.error) && <Notice tone="warn">{errMsg(schemes.error || tools.error)}</Notice>}
    {tools.data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        {([['待確認名稱', pending.length], ['可申請工具', rows.filter((t) => t.status === 'APPROVED').length], ['自行填寫查詢次數', rows.reduce((sum, t) => sum + (t.inquiry_count ?? 0), 0)]] as const).map(([label, value]) =>
          <div key={label} className="rounded-xl border border-border bg-canvas p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}
      </div>
      <ToolsTab key={code} code={code} tools={rows} pending={pending} canWrite={can('admin')}
        reload={() => { void client.invalidateQueries({ queryKey: ['tool-knowledge', code] }); void client.invalidateQueries({ queryKey: ['scheme-children', code] }) }} />
    </>}
  </div>
}
