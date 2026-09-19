/**
 * 內容助理 (b) 的 FAQ 建議卡（SPEC §8.6 b / §9.6）。
 *
 * 一群問不出答案的句子收斂成一則建議。卡片上刻意把三件事擺在一起：民眾原本怎麼問的
 * （已去識別化）、助理寫的答案、以及每一句的依據。沒有依據的句子帶著「待查證」，
 * 用警示色標出來——那是承辦人員唯一非看不可的部分。
 *
 * 「採用」建出來的是一則**停用中**的 FAQ：採用代表「這題值得回答」，不代表「這段
 * 答案可以直接對外說」。要啟用，去常見問題頁（決策 D8 的同一條規矩）。
 */

import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { Badge, Button } from '../../components/ui'
import type { FaqSuggestion } from '../schemes/types'

export const UNVERIFIED = '（待查證）'

export function SuggestionCard({ suggestion, canWrite, busy, onAccept, onDismiss }: {
  suggestion: FaqSuggestion
  canWrite: boolean
  busy: boolean
  onAccept: () => void
  onDismiss: () => void
}) {
  const lines = suggestion.answer_draft.split('\n').filter(Boolean)
  return (
    <li className="rounded-xl border border-border bg-canvas p-4" style={{ boxShadow: 'var(--shadow-float)' }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{suggestion.question || '（助理沒有寫出問題）'}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{suggestion.cluster_size} 個人問過類似的</Badge>
            {suggestion.unverified > 0
              ? <Badge tone="warn">{suggestion.unverified} 句待查證</Badge>
              : <Badge tone="good">每一句都有依據</Badge>}
            {suggestion.category && <Badge tone="muted">{suggestion.category}</Badge>}
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-1">
            <Button size="sm" variant="good" loading={busy} onClick={onAccept}
                    aria-label={`採用 ${suggestion.question}`}>
              <Check size={13} /> 採用
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}
                    aria-label={`忽略建議 ${suggestion.question}`}>
              <X size={13} /> 不用
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-0.5 text-sm leading-6">
        {lines.map((line, i) => (
          <p key={i} className={line.includes(UNVERIFIED) ? 'text-warn' : undefined}>{line}</p>
        ))}
      </div>

      {!!suggestion.citations.length && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-secondary">
          {suggestion.citations.map((c, i) => (
            <li key={i}><span className="font-mono">[{i}] {c.source_type}/{c.source_id}</span>　{c.quote}</li>
          ))}
        </ul>
      )}

      {!!suggestion.sample_messages_masked.length && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">民眾原本怎麼問的（已去識別化）</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {suggestion.sample_messages_masked.map((s, i) => <li key={i} className="list-disc">{s}</li>)}
          </ul>
        </details>
      )}
    </li>
  )
}

export function SuggestionList({ items, canWrite, busyId, onAccept, onDismiss }: {
  items: FaqSuggestion[]
  canWrite: boolean
  busyId: string | null
  onAccept: (s: FaqSuggestion) => void
  onDismiss: (s: FaqSuggestion) => void
}) {
  if (!items.length) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">FAQ 建議</h2>
      <p className="text-xs text-muted">
        採用之後會建出一則<strong>停用中</strong>的常見問題，改完再到
        <Link to="/line/faqs" className="mx-1 text-accent underline">常見問題</Link>
        頁啟用它。
      </p>
      <ul className="space-y-2">
        {items.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            canWrite={canWrite}
            busy={busyId === s.id}
            onAccept={() => onAccept(s)}
            onDismiss={() => onDismiss(s)}
          />
        ))}
      </ul>
    </section>
  )
}
