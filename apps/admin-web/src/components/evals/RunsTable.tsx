/** Eval run history (newest first) with per-case drill-down and prev-run comparison. */
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { EvalRun } from '../../lib/types'
import { Badge, Empty, Spinner, errMsg } from '../ui'
import type { EvalLookup } from './lookup'
import { isActiveRun, useEvalRuns } from './queries'

interface CaseResult {
  case_id: string; expected_platform_id: string; expected_step_id: string | null; expected_goal_id?: string | null
  platform_id?: string | null; step_id?: string | null; confidence?: number; scope?: string; ok?: boolean
  platform_correct?: boolean; step_correct?: boolean
  intent_platform_id?: string | null; intent_goal_id?: string | null; intent_platform_correct?: boolean; intent_goal_correct?: boolean
  error?: string; intent_error?: string
}

/** Metrics shown in the history table. `higher` = larger is better (for comparison colouring). */
const METRICS: { key: string; label: string; higher: boolean; fmt: (v: number) => string }[] = [
  { key: 'platform_accuracy', label: '平台準確率', higher: true, fmt: pct },
  { key: 'step_accuracy', label: '步驟準確率', higher: true, fmt: pct },
  { key: 'intent_platform_accuracy', label: '意圖・平台', higher: true, fmt: pct },
  { key: 'intent_goal_accuracy', label: '意圖・goal', higher: true, fmt: pct },
  { key: 'avg_latency_ms', label: '平均耗時', higher: false, fmt: (v) => `${Math.round(v).toLocaleString()} ms` },
  { key: 'total_cost_usd', label: '成本', higher: false, fmt: (v) => `$${v.toFixed(4)}` },
]
function pct(v: number) { return `${(v * 100).toFixed(1)}%` }

const STATUS: Record<string, { label: string; tone: 'accent' | 'good' | 'danger' | 'muted' }> = {
  running: { label: '執行中', tone: 'accent' }, done: { label: '完成', tone: 'good' }, failed: { label: '失敗', tone: 'danger' },
}

function configSummary(c: Record<string, unknown>): string {
  const models = (c.models ?? {}) as Record<string, string>
  const parts = [c.content_mode === 'draft' ? '草稿' : '已發布', c.provider as string | undefined, ...Object.entries(models).map(([t, m]) => `${t}=${m}`)]
  if (c.threshold != null) parts.push(`門檻 ${c.threshold}`)
  return parts.filter(Boolean).join(' · ')
}

export default function RunsTable({ lookup }: { lookup: EvalLookup }) {
  const runs = useEvalRuns()
  const [open, setOpen] = useState<string | null>(null)
  if (runs.isLoading) return <div className="flex justify-center p-6"><Spinner /></div>
  if (runs.error) return <Empty>載入失敗：{errMsg(runs.error)}</Empty>
  const list = runs.data ?? []
  if (list.length === 0) return <Empty>尚無評測紀錄。</Empty>
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-background text-left text-muted">
          <tr>
            <th className="w-6 px-2 py-2" />
            <th className="px-2 py-2 font-medium">標籤</th><th className="px-2 py-2 font-medium">開始時間</th><th className="px-2 py-2 font-medium">狀態</th>
            <th className="px-2 py-2 text-right font-medium">樣本</th>
            {METRICS.map((m) => <th key={m.key} className="px-2 py-2 text-right font-medium">{m.label}</th>)}
            <th className="px-2 py-2 font-medium">設定</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => {
            const prev = list.slice(i + 1).find((p) => p.status === 'done')
            const st = STATUS[r.status] ?? { label: r.status, tone: 'muted' as const }
            const expanded = open === r.id
            return (
              <Fragment key={r.id}>
                <tr className={clsx('cursor-pointer border-t border-border hover:bg-background-lite', expanded && 'bg-background-lite')} onClick={() => setOpen(expanded ? null : r.id)}>
                  <td className="px-2 py-2 text-muted">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                  <td className="px-2 py-2 font-medium">{r.label || <span className="text-muted">（未命名）</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted">{new Date(r.started_at).toLocaleString('zh-TW', { hour12: false })}</td>
                  <td className="px-2 py-2"><Badge tone={st.tone}>{isActiveRun(r) && <Spinner size={10} />}{st.label}</Badge></td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.summary?.cases ?? '—'}</td>
                  {METRICS.map((m) => {
                    const v = r.summary?.[m.key] as number | null | undefined
                    const pv = prev?.summary?.[m.key] as number | null | undefined
                    let tone = ''
                    if (v != null && pv != null && v !== pv) {
                      const better = m.higher ? v > pv : v < pv
                      tone = better ? 'bg-good-bg text-good' : 'bg-danger-bg text-danger'
                    }
                    return <td key={m.key} className={clsx('px-2 py-2 text-right tabular-nums', tone)} title={pv != null ? `上一次：${m.fmt(pv)}` : undefined}>{v == null ? '—' : m.fmt(v)}</td>
                  })}
                  <td className="max-w-[260px] truncate px-2 py-2 text-[11px] text-muted" title={configSummary(r.config)}>{configSummary(r.config)}</td>
                </tr>
                {expanded && (
                  <tr className="border-t border-border bg-background">
                    <td colSpan={6 + METRICS.length} className="p-3"><RunResults run={r} prev={prev} lookup={lookup} /></td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const Mark = ({ ok }: { ok: boolean | undefined }) => (ok == null ? <span className="text-secondary">—</span> : ok ? <Check size={13} className="inline text-good" /> : <X size={13} className="inline text-danger" />)

function RunResults({ run, prev, lookup }: { run: EvalRun; prev: EvalRun | undefined; lookup: EvalLookup }) {
  const results = (run.results ?? []) as unknown as CaseResult[]
  if (run.status === 'running') {
    return isActiveRun(run)
      ? <div className="flex items-center gap-2 text-muted"><Spinner size={12} /> 執行中，每 2 秒更新…</div>
      : <div className="text-muted">執行時間過長，已停止自動更新；可按「重新整理」查看最新狀態。</div>
  }
  if (results.length === 0) return <div className="text-muted">此次執行沒有結果。</div>
  const prevMap = new Map(((prev?.results ?? []) as unknown as CaseResult[]).map((r) => [r.case_id, r]))
  /** Cell colouring vs previous run for the same case: improved → good, regressed → danger. */
  const diff = (now: boolean | undefined, before: boolean | undefined) => (now == null || before == null || now === before ? '' : now ? 'bg-good-bg' : 'bg-danger-bg')
  return (
    <div className="overflow-auto rounded-lg border border-border bg-canvas">
      <table className="w-full text-xs">
        <thead className="text-left text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">樣本</th>
            <th className="px-2 py-1.5 font-medium">平台（預期 → 實際）</th>
            <th className="px-2 py-1.5 font-medium">步驟（預期 → 實際）</th>
            <th className="px-2 py-1.5 text-right font-medium">信心</th><th className="px-2 py-1.5 font-medium">範圍</th>
            <th className="px-2 py-1.5 font-medium">意圖・平台</th><th className="px-2 py-1.5 font-medium">意圖・goal</th>
            <th className="px-2 py-1.5 font-medium">錯誤</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const p = prevMap.get(r.case_id)
            const hasIntent = 'intent_platform_correct' in r || r.intent_error
            return (
              <tr key={r.case_id} className="border-t border-border">
                <td className="px-2 py-1.5 font-mono text-[11px] text-muted">{r.case_id.slice(0, 8)}</td>
                <td className={clsx('px-2 py-1.5', diff(r.platform_correct, p?.platform_correct))}><Mark ok={r.platform_correct} /> {lookup.platform(r.expected_platform_id)} → {lookup.platform(r.platform_id)}</td>
                <td className={clsx('px-2 py-1.5', r.expected_step_id && diff(r.step_correct, p?.step_correct))}>
                  {r.expected_step_id ? <><Mark ok={r.step_correct} /> {lookup.step(r.expected_step_id)} → {lookup.step(r.step_id)}</> : <span className="text-secondary">未指定 → {lookup.step(r.step_id)}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.confidence == null ? '—' : `${(r.confidence * 100).toFixed(0)}%`}</td>
                <td className="px-2 py-1.5 text-muted">{r.scope ?? '—'}</td>
                <td className={clsx('px-2 py-1.5', hasIntent && diff(r.intent_platform_correct, p?.intent_platform_correct))}>{hasIntent ? <><Mark ok={r.intent_platform_correct} /> {lookup.platform(r.intent_platform_id)}</> : <span className="text-secondary">無文字</span>}</td>
                <td className={clsx('px-2 py-1.5', hasIntent && r.expected_goal_id && diff(r.intent_goal_correct, p?.intent_goal_correct))}>
                  {hasIntent ? (r.expected_goal_id ? <><Mark ok={r.intent_goal_correct} /> {lookup.goal(r.expected_goal_id)} → {lookup.goal(r.intent_goal_id)}</> : <span className="text-secondary">未指定 → {lookup.goal(r.intent_goal_id)}</span>) : <span className="text-secondary">—</span>}
                </td>
                <td className="max-w-[240px] truncate px-2 py-1.5 text-danger" title={r.error || r.intent_error}>{r.error || r.intent_error || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
