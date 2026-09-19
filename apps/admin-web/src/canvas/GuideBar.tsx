/**
 * The guide bar along the bottom of the canvas: the five stages between an
 * empty flow and a published one, which are done, and — for the stage in
 * hand — one sentence saying what to do next and the one button that does it.
 * A clerk never has to guess whether 起點 / 終點 are required or what the
 * publish button will complain about: the bar says so before they ask.
 *
 * Clicking a stage shows its own advice; the bar follows the first unfinished
 * stage otherwise, and rests on 發布 once they are all done. It folds into a
 * small pill when someone wants the room.
 */

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '../components/ui'
import { Ring } from '../components/ai/AIStatus'
import { unionBoxes } from './geometry'
import { buildGuide, type GuideAction, type StageKey } from './guide'
import { selSteps, useEditor } from './context'

const LS_COLLAPSED = 'sop_guide_collapsed'
/** How tall the docked bar is; the toolbar sits above it. */
export const GUIDE_BAR_H = 52

export function GuideBar() {
  const ed = useEditor()
  const { flow, scene, editable, canReview } = ed
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_COLLAPSED) === '1')
  // A stage the person clicked to read, remembered with the stage that was
  // current at the time: once the work moves on, the bar follows the work again.
  const [pick, setPick] = useState<{ key: StageKey; when: StageKey | null } | null>(null)

  const steps = useMemo(() => scene.steps.map((n) => n.step), [scene.steps])
  const edges = useMemo(() => scene.edges.map((n) => n.edge), [scene.edges])
  const guide = useMemo(() => (flow ? buildGuide(flow, steps, edges) : null), [flow, steps, edges])

  const currentKey = guide && guide.current < guide.stages.length ? guide.stages[guide.current].key : null
  const picked = pick && pick.when === currentKey ? pick.key : null
  const setPicked = (key: StageKey | null) => setPick(key ? { key, when: currentKey } : null)

  if (!flow || !guide) return null
  // Nothing left to do is still worth saying: once every stage is done the bar
  // rests on 發布 instead of vanishing, so the five ticks stay on screen and a
  // stage can still be clicked to read back what it covered.
  const lastKey = guide.stages[guide.stages.length - 1].key
  const shownKey = picked ?? currentKey ?? lastKey
  const advice = guide.advice(shownKey)
  const toggle = () => setCollapsed((c) => { localStorage.setItem(LS_COLLAPSED, c ? '0' : '1'); return !c })

  const perform = (a: GuideAction) => {
    switch (a.kind) {
      case 'upload': ed.pickFiles(); break
      case 'endpoints': ed.autoEndpoints(); break
      case 'publish': ed.publish(); break
      case 'open': ed.openWorkspace(a.stepId, 'light'); break
      case 'focus': {
        const boxes = a.ids.flatMap((id) => { const n = scene.byId.get(id); return n ? [n.box] : [] })
        const box = unionBoxes(boxes)
        ed.setSelection(selSteps(a.ids))
        if (box) ed.focusBox(box)
        break
      }
    }
  }
  const allowed = (a: GuideAction) => (a.kind === 'publish' ? canReview : editable)
  const doneCount = guide.stages.filter((s) => s.done).length

  if (collapsed) {
    return (
      <button
        type="button" onClick={toggle}
        className="pg-risein pointer-events-auto absolute bottom-4 left-4 z-20 flex h-9 items-center gap-2 rounded-full border border-border bg-canvas/90 pl-3 pr-2 text-[12px] text-muted backdrop-blur-xl hover:text-primary"
        style={{ boxShadow: 'var(--shadow-float)' }}
        title="展開發布前的進度"
      >
        <span className="font-medium text-primary">發布準備</span>
        <span className="tabular-nums">{doneCount}/{guide.stages.length}</span>
        <ChevronUp size={13} />
      </button>
    )
  }

  return (
    <div
      className="pg-risein pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t border-border bg-canvas/90 px-4 backdrop-blur-xl"
      style={{ height: GUIDE_BAR_H }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ol className="flex shrink-0 items-center">
        {guide.stages.map((s, i) => {
          const isCurrent = i === guide.current
          const isShown = s.key === shownKey
          return (
            <li key={s.key} className="flex items-center">
              {i > 0 && <span className={clsx('mx-1 h-px w-4', guide.stages[i - 1].done ? 'bg-good/50' : 'bg-border')} />}
              <button
                type="button"
                onClick={() => setPicked(s.key === currentKey ? null : s.key)}
                className={clsx('flex h-8 items-center gap-1.5 rounded-full px-2 text-[12px] transition-colors hover:bg-background-lite',
                  isShown ? 'text-primary' : 'text-muted')}
                title={s.done ? '完成' : isCurrent ? '現在做這個' : '之後'}
              >
                <span className={clsx('flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                  s.done ? 'bg-good-bg text-good' : isCurrent ? 'bg-accent text-on-accent' : 'border border-tertiary text-secondary')}>
                  {s.done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className={clsx(isShown && 'font-medium')}>{s.label}</span>
                {s.total !== undefined && s.total > 0 && !s.done && (
                  <span className="tabular-nums text-secondary">{s.n}/{s.total}</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
          {advice.busy && <Ring size={13} className="shrink-0 text-accent" />}
          <span className={clsx('truncate', advice.busy && 'pg-shimmer')}>{advice.hint}</span>
        </span>
        {advice.action && allowed(advice.action) && (
          <Button
            size="sm"
            variant={advice.action.kind === 'publish' ? 'primary' : 'default'}
            loading={advice.action.kind === 'publish' && ed.publishing}
            onClick={() => perform(advice.action!)}
            className="shrink-0"
          >
            {advice.action.label}
          </Button>
        )}
        <button type="button" onClick={toggle} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-background-lite hover:text-primary" title="收起">
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
  )
}
