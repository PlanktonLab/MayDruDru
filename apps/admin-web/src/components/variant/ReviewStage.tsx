/**
 * Stage 2 「審核」— compare the original with the AI's replica, then approve
 * or send it back with a note. The verdict comes first, in one sentence; the
 * lists behind it are one click away.
 */
import { Lock } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ApiError, post } from '../../lib/api'
import type { Platform, Variant } from '../../lib/types'
import { Button, Textarea, confirm, errMsg, useToast } from '../ui'
import { fmtTime, reviewProblems, useProtectedImage, visualPassed, visualReview, type ImageState } from './hooks'
import { FakeDataList, useFakeDataSync } from './FakeDataSync'
import { useSaveComponent } from './SaveComponent'
import { replicaUrl } from '../../canvas/status'
import { PlatformContextPanel } from '../platform/PlatformParts'
import { Disclosure, Problems, TextList, TextLink, ZoomControl } from './parts'

const DECISION_LABEL: Record<string, string> = { approve: '通過', regenerate: '請 AI 重做', revalue: '改了畫面上的假資料', advanced_edit: '直接改了 HTML' }

function Pane({ title, aside, img, zoom, forbidden, overlay }: { title: string; aside?: ReactNode; img: ImageState; zoom: number; forbidden?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted"><span>{title}</span>{aside}</div>
      <div className="h-[56vh] overflow-auto rounded-xl border border-border bg-background">
        {img.status === 'ok' && img.src ? (
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            <img src={img.src} alt={title} className="block w-full" style={{ maxWidth: 'none' }} />
            {overlay}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
            {img.status === 'loading' ? <div className="pg-skeleton h-full w-full" /> : img.status === 'forbidden' ? (forbidden ?? img.message) : img.status === 'idle' ? '無圖片' : img.message}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props { variant: Variant; platform: Platform | null; canReview: boolean; canEdit: boolean; isAdmin: boolean; onRefresh: () => Promise<unknown> }

export function ReviewStage({ variant, platform, canReview, canEdit, onRefresh }: Props) {
  const toast = useToast()
  const [zoom, setZoom] = useState(1)
  const save = useSaveComponent(variant.id)
  // 假資料同步 (SPEC §6.5): a quiet line, never a dialog in anyone's face.
  const fake = useFakeDataSync(variant, platform, canEdit, onRefresh)
  const [redo, setRedo] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const original = useProtectedImage(variant.has_original ? `/api/variants/${variant.id}/original.png` : null, variant.original_version ?? undefined)
  const replica = useProtectedImage(replicaUrl(variant))
  const problems = reviewProblems(variant)
  const vis = visualReview(variant)
  const visOk = visualPassed(vis)

  const decide = async (decision: 'approve' | 'regenerate') => {
    setBusy(true)
    try {
      await post(`/api/variants/${variant.id}/review`, { decision, feedback: decision === 'regenerate' ? feedback : '' })
      setRedo(false); setFeedback('')
      await onRefresh()
      toast(decision === 'approve' ? '已通過，原圖已刪除，接下來標註' : '已送回給 AI 重做')
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }
  const approve = async () => {
    if (!await confirm({ title: '通過這張復刻？', body: '原始截圖會被永久刪除（這是去個資的最後一步），接著進入標註。', action: '通過' })) return
    void decide('approve')
  }

  // The verdict in one sentence.
  const verdict = problems.length
    ? `有 ${problems.length} 個地方要看一下`
    : visOk ? 'AI 自檢通過，版面與原圖相符' : '請比對左右兩張圖'
  const detail = `保留了 ${variant.kept_texts.length} 段文字，替換了 ${variant.fake_data.length} 筆資料`

  return (
    <div className="space-y-6 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className={problems.length ? 'text-[15px] font-medium text-danger' : 'text-[15px] font-medium'}>{verdict}</div>
          <div className="mt-0.5 text-[13px] text-muted">{detail}</div>
        </div>
        <ZoomControl zoom={zoom} onIn={() => setZoom((z) => Math.min(2.5, z * 1.15))} onOut={() => setZoom((z) => Math.max(0.5, z / 1.15))} onReset={() => setZoom(1)} />
      </div>

      {fake.notice}

      <div className="grid gap-4 sm:grid-cols-2">
        <Pane title="原圖" img={original} zoom={zoom} forbidden={<span className="inline-flex items-center gap-1"><Lock size={12} /> 只有上傳者與管理員可檢視原圖</span>} />
        <Pane
          title="AI 復刻"
          aside={save.picking
            ? <span className="flex items-center gap-2"><span>在圖上框出要保存的區塊</span><TextLink onClick={save.cancel}>取消</TextLink></span>
            : <TextLink onClick={save.start} disabled={replica.status !== 'ok'} title="把 Tab bar、導覽列存起來，之後每張畫面都沿用">存為共用區塊</TextLink>}
          img={replica} zoom={zoom} overlay={save.overlay}
        />
      </div>

      <Problems items={problems} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!canReview || busy} onClick={() => void approve()}>通過</Button>
          {/* … : this opens the box, it does not send anything yet */}
          <Button variant="default" disabled={!canReview || busy} onClick={() => setRedo((r) => !r)}>請 AI 重做…</Button>
          {!canReview && <span className="text-xs text-muted">需要審核者或管理員權限</span>}
        </div>
        {redo && (
          <div className="pg-dropin space-y-2">
            <p className="text-[12px] leading-5 text-muted">
              寫下要改什麼，按「送出」才會重畫這一頁。只是想換掉畫面上的某個值的話，用下面的「這頁的假資料」改，不必整張重畫。
            </p>
            <Textarea rows={3} autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)}
              placeholder="告訴 AI 要改什麼。例如：底部少了「設定」分頁；金額還是原圖的數字。" />
            {variant.prompt_notes && <p className="text-[12px] leading-5 text-secondary">復刻前的補充說明仍然有效：{variant.prompt_notes}</p>}
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={() => void decide('regenerate')} loading={busy} disabled={!feedback.trim()}>送出</Button>
              <TextLink onClick={() => { setRedo(false); setFeedback('') }} disabled={busy}>取消</TextLink>
            </div>
          </div>
        )}
      </div>

      {platform && <PlatformContextPanel platform={platform} />}

      <div className="rounded-xl border border-border bg-canvas px-4">
        <Disclosure title={`保留的文字（${variant.kept_texts.length}）`}><TextList items={variant.kept_texts} /></Disclosure>
        <Disclosure title={`這頁的假資料（${variant.fake_data.length}）`}>
          <FakeDataList rows={variant.fake_data} />
          {fake.canOpen && variant.fake_data.length > 0 && (
            <div className="mt-2"><TextLink onClick={fake.open}>加入共用假資料…</TextLink></div>
          )}
        </Disclosure>
        <Disclosure title={`審核紀錄（${variant.review_history.length}）`}>
          {variant.review_history.length === 0 ? <span className="text-sm text-secondary">（無）</span> : (
            <ul className="space-y-1.5 text-xs">
              {[...variant.review_history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="text-primary">{DECISION_LABEL[h.decision] ?? h.decision}</span>
                  <span className="text-muted">　{h.by}　{fmtTime(h.at)}</span>
                  {h.feedback && <div className="mt-0.5 whitespace-pre-wrap text-muted">{h.feedback}</div>}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>

      {save.dialog}
      {fake.dialog}
    </div>
  )
}
