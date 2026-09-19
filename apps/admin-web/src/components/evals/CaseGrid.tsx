/** Grid of existing eval cases with private thumbnails. */
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { del } from '../../lib/api'
import { useInvalidate } from '../../lib/hooks'
import type { EvalCase } from '../../lib/types'
import { Badge, Button, Empty, Modal, Spinner, confirmDialog, errMsg, useToast } from '../ui'
import { useEvalCases } from './queries'
import { useProtectedImage } from '../variant/hooks'
import type { EvalLookup } from './lookup'

export default function CaseGrid({ lookup, canEdit }: { lookup: EvalLookup; canEdit: boolean }) {
  const cases = useEvalCases()
  const [zoom, setZoom] = useState<EvalCase | null>(null)
  if (cases.isLoading) return <div className="flex justify-center p-6"><Spinner /></div>
  if (cases.error) return <Empty>載入失敗：{errMsg(cases.error)}</Empty>
  const list = cases.data ?? []
  if (list.length === 0) return <Empty>尚無評測樣本，先在上方新增一張測試截圖。</Empty>
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {list.map((c) => <CaseCard key={c.id} c={c} lookup={lookup} canEdit={canEdit} onZoom={() => setZoom(c)} />)}
      </div>
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${lookup.platform(zoom.platform_id)} · ${lookup.step(zoom.step_id)}` : ''} width={720}>
        {zoom && <ZoomImage url={zoom.image_url} />}
      </Modal>
    </>
  )
}

const FORBIDDEN = '需要編輯權限才能檢視'

function ZoomImage({ url }: { url: string }) {
  const { src, status } = useProtectedImage(url)
  if (status === 'forbidden') return <Empty>{FORBIDDEN}</Empty>
  if (status === 'error') return <Empty>無法載入圖片</Empty>
  if (!src) return <div className="flex justify-center p-6"><Spinner /></div>
  return <img src={src} alt="評測樣本" className="mx-auto max-h-[75vh] w-auto max-w-full object-contain" />
}

function CaseCard({ c, lookup, canEdit, onZoom }: { c: EvalCase; lookup: EvalLookup; canEdit: boolean; onZoom: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const { src, status } = useProtectedImage(c.image_url)
  const [deleting, setDeleting] = useState(false)
  const remove = async () => {
    if (!confirmDialog('確定刪除此評測樣本？圖片會一併刪除。')) return
    setDeleting(true)
    try { await del(`/api/evals/cases/${c.id}`); toast('已刪除'); await invalidate('eval-cases') } catch (e) { toast(errMsg(e), 'err'); setDeleting(false) }
  }
  const flow = lookup.flowOfStep(c.step_id)
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-canvas">
      <button type="button" onClick={onZoom} className="flex h-40 items-center justify-center bg-background" title="點擊放大">
        {src ? <img src={src} alt="" className="h-full w-full object-contain" />
          : status === 'forbidden' ? <span className="px-3 text-xs text-secondary">{FORBIDDEN}</span>
          : status === 'error' ? <span className="text-xs text-danger">圖片載入失敗</span>
          : <Spinner />}
      </button>
      <div className="space-y-1 p-2.5 text-xs">
        <div className="flex items-center gap-1.5"><Badge tone="accent">{lookup.platform(c.platform_id)}</Badge>{c.goal_id && <Badge>{lookup.goal(c.goal_id)}</Badge>}</div>
        <div className="truncate font-medium" title={flow ? `${flow} / ${lookup.step(c.step_id)}` : undefined}>{c.step_id ? <>{flow && <span className="text-muted">{flow} / </span>}{lookup.step(c.step_id)}</> : <span className="text-muted">未指定步驟</span>}</div>
        {c.text && <div className="line-clamp-2 text-muted" title={c.text}>「{c.text}」</div>}
        {c.note && <div className="line-clamp-1 text-[11px] text-secondary" title={c.note}>{c.note}</div>}
        <div className="flex items-center justify-between pt-1 text-[11px] text-secondary">
          <span>{new Date(c.created_at).toLocaleDateString('zh-TW')}</span>
          {canEdit && <Button size="sm" variant="ghost" className="text-danger" loading={deleting} onClick={remove}><Trash2 size={12} /> 刪除</Button>}
        </div>
      </div>
    </div>
  )
}
