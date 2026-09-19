/** Stage 1 「截圖與重點」— upload, focus boxes, start the replica. */
import { clsx } from 'clsx'
import { ImagePlus, Lock, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, del, post, put, upload } from '../../lib/api'
import type { FocusBox, FocusBoxType, Platform, Variant } from '../../lib/types'
import { Button, Textarea, confirm, errMsg, useToast } from '../ui'
import { PlatformContextPanel } from '../platform/PlatformParts'
import { AIError, AIStatus, Ring } from '../ai/AIStatus'
import { BoxEditor, type Rect } from './BoxEditor'
import { newId, useProtectedImage, type AnnotationMeta } from './hooks'
import { TextLink, ToolList, ZoomedImage, useImageZoom, type ToolOption } from './parts'
import { STATUS } from '../../canvas/status'

const FB_COLOR: Record<FocusBoxType, string> = { keep_text: 'var(--fb-keep)', data_region: 'var(--fb-data)', block: 'var(--fb-block)' }
const FB_LABEL: Record<FocusBoxType, string> = { keep_text: '保留文字', data_region: '換成示範資料', block: '遮成色塊' }
const FB_OPTIONS: ToolOption<FocusBoxType>[] = [
  { v: 'keep_text', label: FB_LABEL.keep_text, hint: '標題、按鈕等文字逐字保留', color: FB_COLOR.keep_text },
  { v: 'data_region', label: FB_LABEL.data_region, hint: '保留版面，金額、日期、店名換掉', color: FB_COLOR.data_region },
  { v: 'block', label: FB_LABEL.block, hint: '廣告、橫幅、輪播整塊蓋掉，不重製', color: FB_COLOR.block },
]
const PRIVACY = '截圖加密存放，7 天未處理自動刪除，審核通過後立即刪除。'
/** Area the clerk asked to keep — a block hides content, so it does not count. */
const totalArea = (boxes: FocusBox[]) => Math.min(1, boxes.reduce((s, b) => s + (b.type === 'block' ? 0 : b.w * b.h), 0))
const NOTES_MAX = 1000

interface Props {
  variant: Variant; platform: Platform | null; meta: AnnotationMeta | undefined; canEdit: boolean; onRefresh: () => Promise<unknown>
  /** Unsaved focus boxes — the sheet asks before it closes. */
  onDirtyChange?: (dirty: boolean) => void
}

export function CaptureStage({ variant, platform, meta, canEdit, onRefresh, onDirtyChange }: Props) {
  const toast = useToast()
  const limit = meta?.focus_area_limit ?? 0.6
  const [boxes, setBoxes] = useState<FocusBox[]>(variant.focus_boxes)
  const [notes, setNotes] = useState(variant.prompt_notes)
  const [dirty, setDirty] = useState(false)
  const [syncedAt, setSyncedAt] = useState(variant.updated_at)
  const [tool, setTool] = useState<FocusBoxType>('keep_text')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'upload' | 'start' | 'delete'>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const original = useProtectedImage(variant.has_original ? `/api/variants/${variant.id}/original.png` : null, variant.original_version ?? undefined)
  const aspect = variant.original_width && variant.original_height ? variant.original_width / variant.original_height : 9 / 16
  const zoom = useImageZoom(aspect)

  // Adopt server state when the variant changes underneath us (unless there are unsaved edits).
  if (syncedAt !== variant.updated_at) { setSyncedAt(variant.updated_at); if (!dirty) { setBoxes(variant.focus_boxes); setNotes(variant.prompt_notes) } }

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const locked = STATUS[variant.status].busy
  const failed = variant.status === 'failed'
  const area = totalArea(boxes)
  const over = area > limit
  const editable = canEdit && !locked

  const run = async (kind: typeof busy, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(kind)
    try { await fn(); await onRefresh(); if (ok) toast(ok) } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy('') }
  }
  const pickFile = (files: FileList | null) => {
    const f = files?.[0]
    if (f && canEdit) void run('upload', async () => { await upload(`/api/variants/${variant.id}/original`, f); setBoxes([]); setDirty(false) }, '截圖已上傳')
  }
  const start = () => run('start', async () => {
    await put(`/api/variants/${variant.id}/focus-boxes`, { boxes, prompt_notes: notes.trim() }); setDirty(false)
    await post(`/api/variants/${variant.id}/process`)
  })
  const removeOriginal = async () => {
    if (!await confirm({ title: '移除這張截圖？', body: '已框的重點也會一併清除。', action: '移除', danger: true })) return
    void run('delete', async () => { await del(`/api/variants/${variant.id}/original`); setBoxes([]); setDirty(false) }, '截圖已移除')
  }

  const update = (next: FocusBox[]) => { setBoxes(next); setDirty(true) }
  const onDraw = (r: Rect) => {
    if (r.w < 0.01 || r.h < 0.01) return
    const b: FocusBox = { id: newId(), type: tool, x: r.x, y: r.y, w: r.w, h: r.h, note: '' }
    update([...boxes, b]); setSelected(b.id)
  }
  const fileInput = <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickFile(e.target.files); e.target.value = '' }} />

  if (!variant.has_original) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12">
        {fileInput}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files) }}
          onClick={() => canEdit && !busy && fileRef.current?.click()}
          className={clsx('flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-canvas text-center transition-colors',
            canEdit && !busy && 'cursor-pointer hover:border-accent')}
        >
          {busy === 'upload' ? <Ring size={26} className="text-accent" /> : <ImagePlus size={26} className="text-secondary" />}
          <div className="text-base font-medium">
            {busy === 'upload' ? '上傳中…' : canEdit ? '把 App 截圖拖進來，或點一下選擇' : '尚未上傳截圖'}
          </div>
          {canEdit && busy !== 'upload' && <div className="text-[12px] text-secondary">PNG 或 JPG，手機原始截圖最好</div>}
        </div>
        <p className="mt-3 text-center text-xs text-secondary">{PRIVACY}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-8 px-6 py-6 md:grid-cols-[minmax(0,1fr)_300px]">
      {fileInput}
      <ZoomedImage zoom={zoom}>
        <BoxEditor<FocusBox>
          src={original.src}
          placeholder={original.status === 'loading' ? '載入截圖中…'
            : original.status === 'forbidden' ? <span className="inline-flex items-center gap-1"><Lock size={12} /> 只有上傳者與管理員可檢視原圖</span>
              : original.message || '無法載入截圖'}
          aspect={aspect}
          boxes={boxes}
          onChange={update}
          selectedId={selected}
          onSelect={setSelected}
          onDraw={onDraw}
          onDelete={(id) => { update(boxes.filter((b) => b.id !== id)); if (selected === id) setSelected(null) }}
          colorOf={(b) => FB_COLOR[b.type]}
          drawColor={FB_COLOR[tool]}
          readOnly={!editable || original.status !== 'ok'}
        />
      </ZoomedImage>

      <div className="flex flex-col gap-5">
        {locked ? (
          <AIStatus status={variant.status} progress={variant.progress} since={variant.updated_at}
            aside="可以先關掉這個視窗去處理其他步驟，完成後卡片會自己更新。" />
        ) : (
          <>
            {failed && (
              <AIError title="這次復刻沒有成功" detail={variant.error} />
            )}
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted">框出要保留的地方</div>
              <ToolList value={tool} options={FB_OPTIONS} onChange={setTool} disabled={!editable} />
              <p className="mt-2 text-[12px] leading-[18px] text-secondary">在圖上拖出方框。沒框到的地方會被色塊化，個資不會留下。</p>
            </div>
            {over && <p className="text-xs text-danger">框住的範圍超過畫面 {(limit * 100).toFixed(0)}%，請縮小一點</p>}
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted">給 AI 的補充說明</div>
              <Textarea
                rows={3} value={notes} disabled={!editable} maxLength={NOTES_MAX}
                onChange={(e) => { setNotes(e.target.value); setDirty(true) }}
                placeholder="可留空。例如：中間的輪播是廣告，整塊遮掉；「立即申請」按鈕要保留；下方清單只留前兩列。"
              />
              <p className="mt-1 text-[12px] leading-[18px] text-secondary">復刻與之後的重做都會帶上這段話。</p>
            </div>
            <Button variant="primary" className="w-full justify-center" onClick={start} loading={busy === 'start'}
              disabled={!canEdit || over || busy !== ''}>
              <Sparkles size={14} /> {failed ? '重新 AI 復刻' : '開始 AI 復刻'}
            </Button>
            <div className="flex items-center gap-4">
              <TextLink disabled={!editable || busy !== ''} onClick={() => fileRef.current?.click()}>換一張截圖</TextLink>
              <TextLink disabled={!editable || busy !== ''} onClick={() => void removeOriginal()}>移除截圖</TextLink>
            </div>
          </>
        )}
        {platform && <PlatformContextPanel platform={platform} />}
        <p className="text-xs leading-5 text-secondary">{PRIVACY}</p>
      </div>
    </div>
  )
}
