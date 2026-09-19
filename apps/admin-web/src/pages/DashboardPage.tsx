/** 儀表板 (SPEC §6.4): KPI tiles, daily trend chart (inline SVG), per-flow and LLM usage tables. */
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Card, Empty, Spinner, errMsg } from '../components/ui'
import { get } from '../lib/api'
import type { DashboardSummary } from '../lib/types'

type DayKey = 'session_created' | 'completed' | 'stuck_upload' | 'escalation'
const SERIES: { key: DayKey; label: string; color: string }[] = [
  { key: 'session_created', label: 'Session', color: 'var(--accent)' },
  { key: 'completed', label: '完成', color: 'var(--pg-good)' },
  { key: 'stuck_upload', label: '卡住上傳', color: 'var(--pg-warn)' },
  { key: 'escalation', label: 'Escalation', color: 'var(--danger)' },
]

const fmtInt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('zh-TW'))
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
const fmtUsd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(4)}`)
const fmtDec = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toFixed(d))

export default function DashboardPage() {
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => get<DashboardSummary>(`/api/dashboard/summary?days=${days}`), placeholderData: (prev) => prev })
  const d = q.data

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">儀表板</h1>
          <p className="text-xs text-muted">民眾 session 的使用狀況、各 flow 的疑似改版警示與 LLM 成本（不含評測流量）。</p>
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5 text-xs">
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" onClick={() => setDays(n)} className={clsx('h-7 rounded-md px-3 font-medium', days === n ? 'bg-accent-bg text-accent' : 'text-muted hover:text-primary')}>近 {n} 天</button>
          ))}
        </div>
      </div>

      {q.isLoading && <div className="flex justify-center p-10"><Spinner size={20} /></div>}
      {q.error && <Empty>載入失敗：{errMsg(q.error)}</Empty>}
      {d && (
        <div className={clsx('space-y-4 transition-opacity', q.isFetching && 'opacity-60')}>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5 xl:grid-cols-9">
            <Kpi label="Session 數" value={fmtInt(d.sessions)} />
            <Kpi label="開始的 flow" value={fmtInt(d.flows_started)} />
            <Kpi label="完成數" value={fmtInt(d.completed)} />
            <Kpi label="完成率" value={fmtPct(d.completion_rate)} hint="完成 / 開始的 flow" />
            <Kpi label="平均步數" value={fmtDec(d.avg_steps)} hint="每個開始的 flow" />
            <Kpi label="卡住上傳" value={fmtInt(d.stuck_uploads)} />
            <Kpi label="Escalation" value={fmtInt(d.escalations)} />
            <Kpi label="Escalation 率" value={fmtPct(d.escalation_rate)} hint="escalation / session" />
            <Kpi label="LLM 成本" value={fmtUsd(d.llm_cost_usd)} hint="USD，估算" />
          </div>

          <Card title="每日趨勢"><DailyChart daily={d.daily} days={d.days} /></Card>

          <Card title="各 flow">
            <FlowTable rows={d.flows} />
          </Card>

          <Card title="LLM 用量">
            <UsageTable rows={d.llm_usage} total={d.llm_cost_usd} />
          </Card>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-3 py-2.5" style={{ boxShadow: 'var(--shadow-float)' }} title={hint}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold leading-7">{value}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ chart */

const PAD = { top: 12, right: 16, bottom: 28, left: 40 }
const H = 240

function DailyChart({ daily, days }: { daily: DashboardSummary['daily']; days: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<DayKey>>(new Set())
  const [today] = useState(() => Date.now())

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(Math.max(320, Math.floor(entries[0].contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Full day axis (UTC dates, matching the backend's date_trunc), zero-filled.
  const rows = useMemo(() => {
    const byDate = new Map(daily.map((r) => [r.date, r]))
    const out: { date: string; session_created: number; completed: number; stuck_upload: number; escalation: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(today - i * 86400000).toISOString().slice(0, 10)
      const r = byDate.get(key)
      out.push({ date: key, session_created: r?.session_created ?? 0, completed: r?.completed ?? 0, stuck_upload: r?.stuck_upload ?? 0, escalation: r?.escalation ?? 0 })
    }
    return out
  }, [daily, days, today])

  const visible = SERIES.filter((s) => !hidden.has(s.key))
  const rawMax = Math.max(1, ...rows.flatMap((r) => visible.map((s) => r[s.key])))
  const yMax = niceMax(rawMax)
  const iw = width - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw)
  const y = (v: number) => PAD.top + ih - (v / yMax) * ih
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f))
  const tickEvery = Math.max(1, Math.ceil(rows.length / Math.max(3, Math.floor(iw / 90))))
  const total = rows.reduce((a, r) => a + r.session_created + r.completed + r.stuck_upload + r.escalation, 0)
  const md = (s: string) => `${parseInt(s.slice(5, 7))}/${parseInt(s.slice(8, 10))}`

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const step = rows.length <= 1 ? iw : iw / (rows.length - 1)
    setHover(Math.min(rows.length - 1, Math.max(0, Math.round((px - PAD.left) / step))))
  }
  const toggle = (k: DayKey) => setHidden((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        {SERIES.map((s) => (
          <button key={s.key} type="button" onClick={() => toggle(s.key)} className={clsx('inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-background-lite', hidden.has(s.key) && 'opacity-40 line-through')} title="點擊顯示／隱藏">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} /><span className="text-muted">{s.label}</span>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-secondary">單位：次／日（UTC）</span>
      </div>
      <div ref={wrapRef} className="relative w-full">
        {total === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">此期間沒有事件</div>}
        <svg width={width} height={H} role="img" aria-label="每日趨勢" onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block select-none">
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{t.toLocaleString()}</text>
            </g>
          ))}
          {rows.map((r, i) => (i % tickEvery === 0 || i === rows.length - 1) && (
            <text key={r.date} x={x(i)} y={H - 8} textAnchor={i === rows.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize={10} fill="var(--muted)">{md(r.date)}</text>
          ))}
          {visible.map((s) => {
            const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join(' ')
            const last = rows.length - 1
            return (
              <g key={s.key}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {rows.length <= 31 && rows.map((r, i) => r[s.key] > 0 && <circle key={i} cx={x(i)} cy={y(r[s.key])} r={3} fill={s.color} stroke="var(--canvas)" strokeWidth={2} />)}
                {rows[last][s.key] > 0 && <circle cx={x(last)} cy={y(rows[last][s.key])} r={4} fill={s.color} stroke="var(--canvas)" strokeWidth={2} />}
              </g>
            )
          })}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--secondary)" strokeWidth={1} />
              {visible.map((s) => <circle key={s.key} cx={x(hover)} cy={y(rows[hover][s.key])} r={4} fill={s.color} stroke="var(--canvas)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-border bg-canvas p-2 text-xs" style={{ boxShadow: 'var(--shadow-menu)', ...(x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }) }}>
            <div className="mb-1 font-medium">{rows[hover].date}</div>
            {SERIES.map((s) => (
              <div key={s.key} className={clsx('flex items-center gap-2', hidden.has(s.key) && 'opacity-40')}>
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{rows[hover][s.key].toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function niceMax(v: number) {
  if (v <= 4) return 4
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10
  return step * mag
}

/* ------------------------------------------------------------------ tables */

const th = 'px-2 py-2 font-medium'
const td = 'px-2 py-1.5'
const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已發布' }

function FlowTable({ rows }: { rows: DashboardSummary['flows'] }) {
  if (rows.length === 0) return <Empty>尚無 flow。</Empty>
  const sorted = [...rows].sort((a, b) => b.drift_count - a.drift_count || b.started - a.started)
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-background text-left text-muted">
          <tr><th className={th}>平台</th><th className={th}>Flow</th><th className={th}>狀態</th><th className={clsx(th, 'text-right')}>開始</th><th className={clsx(th, 'text-right')}>完成</th><th className={clsx(th, 'text-right')}>完成率</th><th className={clsx(th, 'text-right')}>疑似改版</th></tr>
        </thead>
        <tbody>
          {sorted.map((f) => (
            <tr key={f.flow_id} className="border-t border-border">
              <td className={clsx(td, 'text-muted')}>{f.platform_name}</td>
              <td className={clsx(td, 'font-medium')}>{f.name}</td>
              <td className={td}><Badge tone={f.status === 'published' ? 'good' : 'muted'}>{STATUS_LABEL[f.status] ?? f.status}</Badge></td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(f.started)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(f.completed)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{f.started ? fmtPct(f.completed / f.started) : '—'}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>
                {f.drift_count > 0 ? <Badge tone="warn"><AlertTriangle size={11} className="mr-1" />{f.drift_count}</Badge> : <span className="text-secondary">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsageTable({ rows, total }: { rows: DashboardSummary['llm_usage']; total: number }) {
  if (rows.length === 0) return <Empty>此期間沒有 LLM 呼叫。</Empty>
  const sum = (k: 'calls' | 'input_tokens' | 'cached_tokens' | 'output_tokens') => rows.reduce((a, r) => a + r[k], 0)
  const calls = sum('calls')
  const avgLat = calls ? rows.reduce((a, r) => a + r.avg_latency_ms * r.calls, 0) / calls : null
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-background text-left text-muted">
          <tr><th className={th}>任務</th><th className={clsx(th, 'text-right')}>呼叫</th><th className={clsx(th, 'text-right')}>輸入 tokens</th><th className={clsx(th, 'text-right')}>快取 tokens</th><th className={clsx(th, 'text-right')}>輸出 tokens</th><th className={clsx(th, 'text-right')}>平均耗時</th><th className={clsx(th, 'text-right')}>成本 (USD)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task} className="border-t border-border">
              <td className={clsx(td, 'font-medium')}>{r.task}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(r.calls)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(r.input_tokens)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(r.cached_tokens)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(r.output_tokens)}</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(r.avg_latency_ms)} ms</td>
              <td className={clsx(td, 'text-right tabular-nums')}>{fmtUsd(r.cost_usd)}</td>
            </tr>
          ))}
          <tr className="border-t border-border bg-background font-semibold">
            <td className={td}>合計</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(calls)}</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(sum('input_tokens'))}</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(sum('cached_tokens'))}</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{fmtInt(sum('output_tokens'))}</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{avgLat == null ? '—' : `${fmtInt(avgLat)} ms`}</td>
            <td className={clsx(td, 'text-right tabular-nums')}>{fmtUsd(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
