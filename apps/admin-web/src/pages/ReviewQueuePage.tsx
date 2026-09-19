/** /review — a plain list of variants waiting for review (SPEC §6.4). */
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Inbox } from 'lucide-react'
import { EmptyState } from '@maydru/ui'
import { useNavigate } from 'react-router-dom'
import { sinceText } from '../components/variant/hooks'
import { THEME_LABEL } from '../canvas/status'
import { Spinner, errMsg } from '../components/ui'
import { get } from '../lib/api'
import type { ReviewQueueItem } from '../lib/types'

export default function ReviewQueuePage() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['review-queue'], queryFn: () => get<ReviewQueueItem[]>('/api/review/queue'), refetchInterval: 10_000 })
  const items = q.data ?? []

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-lg font-semibold tracking-tight">審核佇列</h1>

      {q.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>
      ) : q.error ? (
        <p className="mt-8 text-sm text-danger">{errMsg(q.error)}</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="目前沒有待審核"
          hint="有人送出新的變體時會出現在這裡。"
        />
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-canvas">
          {items.map((it) => (
            <li key={it.variant_id}>
              <button
                type="button"
                onClick={() => navigate(`/canvas?step=${it.step_id}&theme=${it.theme}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background-lite"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {it.flow_name} · <span className="font-medium">{it.step_title}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {it.platform_name}　{THEME_LABEL[it.theme]}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-secondary">{sinceText(it.updated_at)}</span>
                <ChevronRight size={14} className="shrink-0 text-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
