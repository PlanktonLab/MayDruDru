/**
 * The path from an empty flow to a published one, as five stages a clerk can
 * see at a glance: screenshots in, steps in order, AI replicas reviewed, Step
 * Cards made, published. Each stage knows whether it is done and, when it is
 * the one to work on, says in one sentence what to do and offers the one
 * action that does it. Pure: the bar draws it, the editor performs it.
 */

import type { Edge, Flow, Step } from '../lib/types'
import { renderFailed, STATUS, statusOf, variantOf } from './status'
import { flowStructure, suggestEndpoints } from './structure'

export type StageKey = 'screenshots' | 'order' | 'review' | 'cards' | 'publish'

export interface Stage {
  key: StageKey
  label: string
  done: boolean
  /** Progress for the counted stages (steps finished / steps). */
  n?: number
  total?: number
}

/** The one thing the bar offers to do for the stage on screen. */
export type GuideAction =
  | { kind: 'upload'; label: string }
  | { kind: 'focus'; label: string; ids: string[] }
  | { kind: 'open'; label: string; stepId: string }
  | { kind: 'endpoints'; label: string }
  | { kind: 'publish'; label: string }

export interface StageAdvice {
  /** One sentence: what is missing, or what is happening. */
  hint: string
  action: GuideAction | null
  /** The bar is waiting on a background job, not on the person. */
  busy?: boolean
}

export interface Guide {
  stages: Stage[]
  /** Index of the first stage not yet done (stages.length once everything is). */
  current: number
  advice: (stage: StageKey) => StageAdvice
}

const count = (n: number, unit = '個步驟') => `${n} ${unit}`

export function buildGuide(flow: Flow, steps: Step[], edges: Edge[]): Guide {
  const total = steps.length
  const light = (s: Step) => statusOf(s, 'light')
  const info = (s: Step) => STATUS[light(s)]
  const uploaded = steps.filter((s) => light(s) !== 'not_uploaded')
  const reviewed = steps.filter((s) => info(s).stage >= 2)
  const finished = steps.filter((s) => info(s).card)
  const st = flowStructure(steps, edges)
  // a reachable 終點 must say which document the citizen holds there (the server refuses to publish otherwise)
  const endsWithoutGoal = steps.filter((s) => s.is_end && !s.goal_id && !st.unreachable.includes(s.id)).map((s) => s.id)
  const published = flow.status === 'published'

  const work: Stage[] = [
    { key: 'screenshots', label: '截圖', done: total > 0 && uploaded.length === total, n: uploaded.length, total },
    { key: 'order', label: '順序', done: st.ok && !endsWithoutGoal.length },
    { key: 'review', label: '復刻審核', done: total > 0 && reviewed.length === total, n: reviewed.length, total },
    { key: 'cards', label: '教學圖', done: total > 0 && finished.length === total, n: finished.length, total },
  ]
  const ready = work.every((s) => s.done)
  const stages: Stage[] = [...work, { key: 'publish', label: '發布', done: published && ready }]
  const current = stages.findIndex((s) => !s.done)

  const advice = (key: StageKey): StageAdvice => {
    switch (key) {
      case 'screenshots': {
        if (!total) return { hint: '把截圖拖進畫布，每一張會變成一個步驟。', action: { kind: 'upload', label: '上傳截圖' } }
        const missing = steps.filter((s) => light(s) === 'not_uploaded').map((s) => s.id)
        if (!missing.length) return { hint: '每個步驟都有截圖了。', action: null }
        return { hint: `還有 ${count(missing.length)}沒有截圖，把截圖拖到卡片上就行。`, action: { kind: 'focus', label: '找出來', ids: missing } }
      }
      case 'order': {
        if (!total) return { hint: '有了步驟之後，再決定它們的先後順序。', action: null }
        if (st.cycle) return { hint: '流程繞成了圈，請刪掉一條往回走的連線。', action: null }
        if (st.ok && endsWithoutGoal.length) {
          return { hint: `有 ${count(endsWithoutGoal.length, '個終點')}還沒說明民眾在那裡取得哪份文件，選取終點卡片就能指定。`, action: { kind: 'focus', label: '找出來', ids: endsWithoutGoal } }
        }
        if (st.ok) return { hint: '起點到終點都連得起來，每個終點也都指定了文件。', action: null }
        const auto = suggestEndpoints(steps, edges)
        if (st.starts.length !== 1 || !st.ends.length || !st.endReachable) {
          if (auto) return { hint: '流程要有一個起點和至少一個終點，可以依照連線自動判斷。', action: { kind: 'endpoints', label: '自動判斷起點與終點' } }
          if (st.noPrev.length > 1) return { hint: `有 ${count(st.noPrev.length)}沒有前一步，先用卡片右側的「+」或拖線把它們接起來。`, action: { kind: 'focus', label: '找出來', ids: st.noPrev } }
        }
        if (st.unreachable.length) return { hint: `有 ${count(st.unreachable.length)}還沒連進流程，從前一步拖一條線到它。`, action: { kind: 'focus', label: '找出來', ids: st.unreachable } }
        return { hint: '起點和終點的位置和連線對不上，可以依照連線重新判斷。', action: auto ? { kind: 'endpoints', label: '自動判斷起點與終點' } : null }
      }
      case 'review': {
        if (!uploaded.length) return { hint: '截圖上傳後，AI 會把畫面復刻成去個資的教學圖，再請你審核。', action: null }
        const failed = uploaded.filter((s) => light(s) === 'failed')
        if (failed.length) return { hint: `有 ${count(failed.length, '張截圖')}復刻失敗，可以調整重點後再試一次。`, action: { kind: 'open', label: '重試', stepId: failed[0].id } }
        const toReview = uploaded.filter((s) => light(s) === 'pending_review')
        if (toReview.length) return { hint: `有 ${count(toReview.length, '張復刻結果')}等你審核。`, action: { kind: 'open', label: '審核', stepId: toReview[0].id } }
        const toStart = uploaded.filter((s) => info(s).stage === 0 && !info(s).busy)
        if (toStart.length) return { hint: `有 ${count(toStart.length, '張截圖')}還沒交給 AI 復刻，框出要保留的重點就能開始。`, action: { kind: 'open', label: '開始復刻', stepId: toStart[0].id } }
        const working = uploaded.filter((s) => light(s) === 'processing')
        if (working.length) return { hint: `AI 正在復刻 ${count(working.length, '張截圖')}，完成後會請你審核。`, action: null, busy: true }
        const waiting = uploaded.find((s) => info(s).stage < 2)
        if (waiting) return { hint: '還有步驟在等待復刻。', action: { kind: 'open', label: '前往', stepId: waiting.id } }
        return { hint: '所有復刻結果都審核過了。', action: null }
      }
      case 'cards': {
        if (!reviewed.length) return { hint: '審核通過後，在復刻圖上標出民眾要按的位置，就會產生教學圖。', action: null }
        const failed = reviewed.filter((s) => renderFailed(variantOf(s, 'light')))
        if (failed.length) return { hint: `有 ${count(failed.length, '張教學圖')}產生失敗，可以再試一次。`, action: { kind: 'open', label: '重試', stepId: failed[0].id } }
        const toAnnotate = reviewed.filter((s) => light(s) === 'annotating')
        if (toAnnotate.length) return { hint: `有 ${count(toAnnotate.length)}等你標註民眾要按的位置。`, action: { kind: 'open', label: '標註', stepId: toAnnotate[0].id } }
        const busy = reviewed.filter((s) => info(s).busy)
        if (busy.length) return { hint: `正在產生 ${count(busy.length, '張教學圖')}。`, action: null, busy: true }
        if (finished.length === total) return { hint: '每個步驟都有教學圖了。', action: null }
        return { hint: '還有步驟在等待前面的階段。', action: null }
      }
      case 'publish': {
        if (published && ready) return { hint: '已發布，客服通道正在用這條流程。', action: null }
        if (!ready) return { hint: '前面四個階段都完成後就能發布。', action: null }
        return { hint: '全部就緒。發布後，客服通道就會用這條流程引導民眾。', action: { kind: 'publish', label: '發布' } }
      }
    }
  }

  return { stages, current: current === -1 ? stages.length : current, advice }
}
