/** 評測 (SPEC §11): sample set, one-click run, run history with comparison. */
import { Play, RefreshCw, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import CaseForm from '../components/evals/CaseForm'
import CaseGrid from '../components/evals/CaseGrid'
import { isActiveRun, useEvalCases, useEvalRuns } from '../components/evals/queries'
import RunsTable from '../components/evals/RunsTable'
import { buildLookup } from '../components/evals/lookup'
import { Button, Card, Field, Input, Select, errMsg, useToast } from '../components/ui'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useCanvas, useGoals, useInvalidate, usePlatforms } from '../lib/hooks'
import type { EvalRun } from '../lib/types'

export default function EvalsPage() {
  const { can } = useAuth()
  const canEdit = can('edit')
  const platforms = usePlatforms()
  const goals = useGoals()
  const canvas = useCanvas()
  const lookup = useMemo(() => buildLookup(platforms.data, goals.data, canvas.data), [platforms.data, goals.data, canvas.data])
  const cases = useEvalCases()
  const caseCount = cases.data?.length ?? 0
  const runs = useEvalRuns()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => { setRefreshing(true); try { await runs.refetch() } finally { setRefreshing(false) } }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">評測</h1>
        <p className="text-xs text-muted">上傳測試截圖並標記正確答案，一鍵評估截圖定位與意圖解析；結果留歷史，方便對照每次調整 prompt 或換模型的效果。</p>
      </div>

      <Card title={<>評測樣本 <span className="ml-1 font-normal text-muted">{caseCount}</span></>}>
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>樣本含個資（可用自己帳號的截圖），僅存於 tenant 私有空間、僅供評測，不會進入民眾可見內容或 Step Card 生成。</span>
        </div>
        {canEdit ? <CaseForm /> : <div className="text-xs text-muted">您的角色無法新增樣本（需要 Editor 以上）。</div>}
        <div className="my-4 border-t border-border" />
        <CaseGrid lookup={lookup} canEdit={canEdit} />
      </Card>

      <Card title="執行評測">
        <RunPanel canEdit={canEdit} caseCount={caseCount} />
      </Card>

      <Card title="評測紀錄" actions={<Button size="sm" variant="ghost" onClick={refresh} loading={refreshing} title="重新整理"><RefreshCw size={13} /> 重新整理</Button>}>
        <p className="mb-3 text-[11px] text-muted">顏色代表與上一次完成的執行相比：<span className="rounded bg-good-bg px-1 text-good">進步</span> / <span className="rounded bg-danger-bg px-1 text-danger">退步</span>。點擊列可展開每個樣本的結果。</p>
        <RunsTable lookup={lookup} />
      </Card>
    </div>
  )
}

function RunPanel({ canEdit, caseCount }: { canEdit: boolean; caseCount: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const runs = useEvalRuns()
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<'published' | 'draft'>('draft')
  const [starting, setStarting] = useState(false)
  const running = runs.data?.some(isActiveRun) ?? false

  const start = async () => {
    setStarting(true)
    try {
      await post<EvalRun>('/api/evals/runs', { label: label.trim(), content_mode: mode })
      toast('已開始執行評測，結果會自動更新')
      setLabel('')
      await invalidate('eval-runs')
    } catch (e) { toast(errMsg(e), 'err') } finally { setStarting(false) }
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void start() }}>
      <div className="min-w-[260px] flex-1"><Field label="標籤" hint="記錄這次調整了什麼，例如「rerank prompt v3」"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="rerank prompt v3" /></Field></div>
      <Field label="內容模式" hint="檢索的候選來源">
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'published' | 'draft')}>
          <option value="draft">草稿（含未發布）</option>
          <option value="published">已發布</option>
        </Select>
      </Field>
      <div className="pb-5">
        <Button type="submit" variant="primary" loading={starting} disabled={!canEdit || running || caseCount === 0} title={!canEdit ? '需要 Editor 以上' : caseCount === 0 ? '尚無樣本' : running ? '已有評測在執行中' : undefined}>
          <Play size={14} /> 一鍵執行全部樣本（{caseCount}）
        </Button>
      </div>
    </form>
  )
}
