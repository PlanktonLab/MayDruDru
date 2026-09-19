/**
 * The floating panel for the one selected step: the screenshot rows, on a
 * 終點 the document it delivers, and the rarely-used settings folded under
 *「更多」. What the citizen reads —
 * the title, the instruction, the stuck hint — is edited in the workspace's
 * annotation stage, next to the picture it is printed on (the title also by
 * double-clicking the card). The panel appears with the selection and leaves
 * with it, so the canvas has its full width the rest of the time.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, Check, ChevronRight, Plus, X } from 'lucide-react'
import type { Step, Theme } from '../lib/types'
import { Ring } from '../components/ai/AIStatus'
import { Picker, Switch } from './fields'
import { STATUS, statusOf, THEME_LABEL, themeHasWork } from './status'
import { useEditor } from './context'

export function StepPanel({ step }: { step: Step }) {
  const ed = useEditor()
  const { editable, actions } = ed
  const [more, setMore] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const save = (body: Parameters<typeof actions.patchStep>[1]) => { void actions.patchStep(step.id, body) }

  return (
    <aside
      className="pg-panelin pointer-events-auto absolute right-4 top-16 z-20 flex w-[300px] max-h-[calc(100%-140px)] flex-col overflow-hidden rounded-2xl border border-border bg-canvas/95 backdrop-blur-xl"
      style={{ boxShadow: 'var(--shadow-popover)' }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2">
        <span className={clsx('min-w-0 truncate text-[13px] font-medium', !step.title && 'text-secondary')} title={step.title}>{step.title || '未命名步驟'}</span>
        <button type="button" onClick={() => ed.setSelection(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-background-lite hover:text-primary" title="取消選取（Esc）"><X size={14} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">截圖</div>
          {(['light', 'dark'] as Theme[]).filter((t) => t === 'light' || themeHasWork(step, t)).map((theme) => {
            const status = statusOf(step, theme)
            const info = STATUS[status]
            return (
              <button
                key={theme} type="button"
                onClick={() => ed.openWorkspace(step.id, theme)}
                className="group -mx-2 flex w-[calc(100%+16px)] items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-background-lite"
              >
                <span className="flex items-center gap-2">
                  <StatusGlyph tone={info.tone} />
                  {THEME_LABEL[theme]}
                </span>
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  {info.label}
                  <ArrowRight size={12} className="text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </button>
            )
          })}
          {editable && !themeHasWork(step, 'dark') && (
            <button
              type="button"
              onClick={() => ed.openWorkspace(step.id, 'dark')}
              title="民眾用深色模式時會拿到深色版本；沒有就退回淺色"
              className="-mx-2 mt-0.5 flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-secondary transition-colors hover:bg-background-lite hover:text-primary"
            >
              <Plus size={12} /> 新增深色版本
            </button>
          )}
        </div>

        {step.is_end && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-muted">抵達這裡就取得</span>
              {ed.isAdmin && <button type="button" onClick={() => ed.openDialog({ kind: 'goals' })} className="text-[11px] text-secondary hover:text-accent">管理文件…</button>}
            </div>
            {ed.data.goals.length ? (
              <Picker value={step.goal_id ?? ''} disabled={!editable} onChange={(v) => save({ goal_id: v || null })}>
                <option value="">尚未指定文件</option>
                {ed.data.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Picker>
            ) : (
              <p className="text-[12px] leading-5 text-secondary">還沒有任何目標文件。{ed.isAdmin ? '先在「管理文件」新增一種。' : '請管理員先新增。'}</p>
            )}
          </div>
        )}

        {editable && (
          <div className="mt-3 border-t border-border pt-2">
            <button type="button" onClick={() => setMore((m) => !m)} className="-mx-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-primary">
              <ChevronRight size={12} className={clsx('transition-transform', more && 'rotate-90')} /> 更多
            </button>
            {more && (
              <div className="mt-1 space-y-2.5 pl-1">
                <Switch label="這是流程的終點" checked={step.is_end} disabled={!editable} onChange={(v) => save({ is_end: v })} />
                <Switch label="這是流程的起點" checked={step.is_start} disabled={!editable} onChange={(v) => save({ is_start: v })} />
                {copyOpen ? (
                  <CopyToFlow stepId={step.id} fromFlowId={step.flow_id} onDone={() => setCopyOpen(false)} />
                ) : (
                  <button type="button" onClick={() => setCopyOpen(true)} className="block text-[13px] text-muted hover:text-primary">複製到其他流程…</button>
                )}
                <button type="button" onClick={() => ed.deleteSteps([step.id])} className="block text-[13px] text-danger hover:opacity-80">刪除步驟</button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function StatusGlyph({ tone }: { tone: keyof typeof GLYPH }) {
  return GLYPH[tone]
}
const GLYPH = {
  idle: <span className="h-3.5 w-3.5 rounded-full border border-dashed border-tertiary" />,
  wait: <span className="h-3.5 w-3.5 rounded-full border-2 border-accent" />,
  busy: <Ring size={14} className="text-accent" />,
  done: <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-good-bg text-good"><Check size={9} strokeWidth={3} /></span>,
  failed: <span className="h-3.5 w-3.5 rounded-full bg-danger" />,
}

function CopyToFlow({ stepId, fromFlowId, onDone }: { stepId: string; fromFlowId: string; onDone: () => void }) {
  const ed = useEditor()
  const targets = ed.data.flows.filter((f) => f.id !== fromFlowId)
  const [target, setTarget] = useState(targets[0]?.id ?? '')
  if (!targets.length) return <div className="text-[12px] text-secondary">沒有其他流程可以複製。</div>
  return (
    <div className="space-y-1.5">
      <select
        value={target} onChange={(e) => setTarget(e.target.value)}
        className="h-8 w-full rounded-lg border border-border bg-canvas px-2 text-[13px] outline-none focus:border-accent"
      >
        {targets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <div className="flex justify-end gap-3 text-[12px]">
        <button type="button" onClick={onDone} className="text-muted">取消</button>
        <button type="button" onClick={() => { void ed.actions.duplicateStep(stepId, target); onDone() }} className="font-medium text-accent">複製</button>
      </div>
    </div>
  )
}
