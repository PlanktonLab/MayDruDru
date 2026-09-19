/**
 * Stage 3 「標註與產出」— mark what the citizen does on the replica, then
 * render the 教學圖. Everything the card prints is edited in the one column
 * beside the picture: the annotations, then the step's texts (title,
 * instruction, stuck hint), then the layout / focus editor and the one
 * primary button. The download, the shared-block picker and the admin HTML
 * editor live behind「⋯」.
 */
import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, Copy, Download, GripVertical, LayoutTemplate, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, post, put } from '../../lib/api'
import { ANNOTATION_COLOR, ANNOTATION_LABEL, type Annotation, type AnnotationType, type Step, type Variant } from '../../lib/types'
import { Button, Input, errMsg, useToast } from '../ui'
import { AIError, AIStatus } from '../ai/AIStatus'
import { ContextMenu, useContextMenu, type MenuItem } from '../../canvas/ContextMenu'
import { TextField } from '../../canvas/fields'
import { AdvancedHtmlModal } from './AdvancedHtmlModal'
import { BoxEditor, type Rect, type Stroke } from './BoxEditor'
import { GestureGlyph, effectiveDirection, gestureFrame, gestureFromStroke } from './GestureGlyph'
import { LayoutEditor } from './LayoutEditor'
import { newId, saveImage, useProtectedImage, type AnnotationMeta } from './hooks'
import { useSaveComponent } from './SaveComponent'
import { TextLink, ToolList, ZoomedImage, useImageZoom, type ToolOption } from './parts'
import { renderFailed, replicaUrl, STATUS, THEME_LABEL } from '../../canvas/status'

const TYPES: AnnotationType[] = ['tap', 'capture', 'input', 'gesture', 'note']
const POINT_TYPES: AnnotationType[] = ['tap', 'note']
const HINT: Record<AnnotationType, string> = {
  tap: '要按的按鈕或選項',
  capture: '申請時截圖必須看得到的資訊',
  input: '要填寫的欄位，可附範例文字',
  gesture: '從起點拖到終點畫出滑動；點一下是長按',
  note: '補充說明，不會畫在圖上',
}
const TOOL_OPTIONS: ToolOption<AnnotationType>[] = TYPES.map((t) => ({ v: t, label: ANNOTATION_LABEL[t], hint: HINT[t], color: ANNOTATION_COLOR[t] }))
const DIRECTIONS: { v: NonNullable<Annotation['direction']>; l: string }[] = [
  { v: 'up', l: '往上滑' }, { v: 'down', l: '往下滑' }, { v: 'left', l: '往左滑' }, { v: 'right', l: '往右滑' }, { v: 'long_press', l: '長按' },
]
const COUNTER_FROM = 25
const renumber = (list: Annotation[]) => list.map((a, i) => ({ ...a, number: i + 1 }))

interface Props {
  variant: Variant
  /** The step's texts go on the Step Card too: they are edited here, and their length is checked here. */
  step: Step
  onPatchStep: (body: Partial<Pick<Step, 'title' | 'instruction' | 'stuck_hint'>>) => void
  meta: AnnotationMeta | undefined; canEdit: boolean; isAdmin: boolean; onRefresh: () => Promise<unknown>
  /** Unsaved annotations — the sheet asks before it closes. */
  onDirtyChange?: (dirty: boolean) => void
}

export function AnnotateStage({ variant, step, onPatchStep, meta, canEdit, isAdmin, onRefresh, onDirtyChange }: Props) {
  const toast = useToast()
  const menu = useContextMenu()
  const labelLimit = meta?.limits.label ?? 30
  const [items, setItems] = useState<Annotation[]>(() => renumber(variant.annotations))
  const [dirty, setDirty] = useState(false)
  const [syncedAt, setSyncedAt] = useState(variant.updated_at)
  const [tool, setTool] = useState<AnnotationType>('tap')
  const [selected, setSelected] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  // The replica URL carries the render's version, so a redraw without a new
  // attempt (an admin HTML edit, a corrected value) reloads by itself.
  const replica = useProtectedImage(replicaUrl(variant))
  const saveComponent = useSaveComponent(variant.id)
  const info = STATUS[variant.status]
  const locked = info.busy
  const aspect = variant.replica_width && variant.replica_height ? variant.replica_width / variant.replica_height : 9 / 16
  const zoom = useImageZoom(aspect)
  // On-screen size of one replica px: the swipe glyph keeps its proportions at any zoom.
  const replicaW = variant.replica_width || 390
  const unit = zoom.width / replicaW

  // Adopt server state when the variant changes underneath us (unless there are unsaved edits).
  if (syncedAt !== variant.updated_at) { setSyncedAt(variant.updated_at); if (!dirty) setItems(renumber(variant.annotations)) }

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const editable = canEdit && !locked
  const completed = info.card
  const update = (next: Annotation[]) => { setItems(renumber(next)); setDirty(true) }
  const patch = (id: string, p: Partial<Annotation>) => update(items.map((a) => (a.id === id ? { ...a, ...p } : a)))
  const remove = (id: string) => { update(items.filter((a) => a.id !== id)); if (selected === id) setSelected(null) }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]; const [a] = next.splice(from, 1); next.splice(to, 0, a); update(next)
  }
  const onDraw = (r: Rect, stroke: Stroke) => {
    if (tool === 'gesture') {
      // The drag *is* the gesture: from where the finger goes down to where it comes up.
      const g = gestureFromStroke(stroke.from, stroke.to, replicaW, replicaW / aspect)
      const a: Annotation = { id: newId(), type: 'gesture', number: items.length + 1, label: '', example_text: '', ...g }
      update([...items, a]); setSelected(a.id)
      return
    }
    const tiny = r.w < 0.008 && r.h < 0.008
    const rect = !tiny ? r
      : POINT_TYPES.includes(tool) ? { x: r.x, y: r.y, w: 0, h: 0 }
        : { x: Math.min(r.x, 0.85), y: Math.min(r.y, 0.94), w: 0.15, h: 0.06 }
    const a: Annotation = { id: newId(), type: tool, number: items.length + 1, label: '', ...rect, example_text: '', direction: '' }
    update([...items, a]); setSelected(a.id)
  }
  const gestureColor = ANNOTATION_COLOR.gesture
  const strokePreview = (st: Stroke) => {
    const g = gestureFromStroke(st.from, st.to, replicaW, replicaW / aspect)
    const a: Annotation = { id: 'preview', type: 'gesture', number: 0, label: '', ...g }
    return <div className="pointer-events-none absolute" style={gestureFrame(a, unit, aspect)}><GestureGlyph direction={g.direction ?? ''} color={gestureColor} unit={unit} muted /></div>
  }

  const saveAnnotations = async () => { await put(`/api/variants/${variant.id}/annotations`, { annotations: items }); setDirty(false) }
  const render = async () => {
    setBusy(true)
    try {
      await saveAnnotations()
      await post(`/api/variants/${variant.id}/render-card`)
      await onRefresh()
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('已複製圖片網址')).catch(() => toast('複製失敗', 'err'))

  const limits = meta?.limits
  const warnings = [
    ...(limits && step.title.length > limits.title ? [`步驟標題超過 ${limits.title} 字`] : []),
    ...(limits && step.instruction.length > limits.instruction ? [`操作說明超過 ${limits.instruction} 字`] : []),
    ...items.filter((a) => a.label.length > labelLimit).map((a) => `標註 ${a.number} 的說明超過 ${labelLimit} 字`),
  ]

  const moreMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const ok = replica.status === 'ok'
    const items: MenuItem[] = [
      { label: '存為共用區塊…', disabled: !ok || saveComponent.picking, onSelect: saveComponent.start },
      { label: '下載介面圖', disabled: !ok, onSelect: () => saveImage(replica.src!, `${step.title || '介面圖'}-${THEME_LABEL[variant.theme]}`) },
    ]
    if (isAdmin) items.push('separator', { label: '直接編輯 HTML…', disabled: locked, onSelect: () => setAdvanced(true) })
    menu.open({ clientX: r.right, clientY: r.bottom + 6 }, items)
  }

  return (
    <div className="space-y-8 px-6 py-6">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_320px]">
        <ZoomedImage zoom={zoom}>
          {/* While a component is being framed the picker sits over the editor and owns the pointer. */}
          <div className="relative">
            <BoxEditor<Annotation>
              src={replica.src}
              placeholder={replica.status === 'loading' ? '載入復刻圖中…' : replica.message || '尚無復刻圖'}
              aspect={aspect}
              boxes={items}
              onChange={update}
              selectedId={selected}
              onSelect={setSelected}
              onDraw={onDraw}
              onDelete={remove}
              colorOf={(a) => ANNOTATION_COLOR[a.type]}
              badgeOf={(a) => a.number}
              isPoint={(a) => a.w === 0 && a.h === 0}
              frameOf={(a) => (a.type === 'gesture' ? gestureFrame(a, unit, aspect) : null)}
              renderBox={(a) => <GestureGlyph direction={effectiveDirection(a, aspect)} color={gestureColor} unit={unit} />}
              renderStroke={tool === 'gesture' ? strokePreview : undefined}
              showDelete={false}
              drawColor={ANNOTATION_COLOR[tool]}
              readOnly={!editable || replica.status !== 'ok' || saveComponent.picking}
            />
            {saveComponent.overlay}
          </div>
          <p className="mt-2 text-center text-xs text-secondary">
            {saveComponent.picking
              ? <span className="inline-flex items-center gap-2">框出要保存的區塊，例如底部 Tab bar <TextLink onClick={saveComponent.cancel}>取消</TextLink></span>
              : tool === 'gesture' ? '在圖上照民眾的手勢拖一下：從哪裡滑到哪裡。原地點一下就是長按。' : '拖曳畫框；「點按」與「說明」可以單擊放一個點。'}
          </p>
        </ZoomedImage>

        <div className="flex flex-col gap-4">
          <ToolList value={tool} options={TOOL_OPTIONS} onChange={setTool} disabled={!editable} />
          <div className="h-px bg-border" />
          {items.length === 0 ? (
            <p className="py-2 text-sm text-muted">還沒有標註。選一個工具，在圖上點一下或拖出一個框。</p>
          ) : (
            <ul className="-mx-2 max-h-[48vh] space-y-0.5 overflow-auto">
              {items.map((a, i) => (
                <li
                  key={a.id}
                  draggable={editable}
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null) }}
                  onDragEnd={() => setDragFrom(null)}
                  onClick={() => setSelected(a.id)}
                  className={clsx('group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors',
                    selected === a.id ? 'bg-background-lite' : 'hover:bg-background-lite')}
                >
                  <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none text-on-accent"
                    style={{ background: ANNOTATION_COLOR[a.type] }}>{a.number}</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <select
                        value={a.type}
                        disabled={!editable}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(a.id, { type: e.target.value as AnnotationType, direction: e.target.value === 'gesture' ? (a.direction || 'up') : '' })}
                        className="-ml-1 rounded bg-transparent px-1 py-0.5 text-xs text-muted outline-none hover:text-primary disabled:opacity-60"
                      >
                        {TYPES.map((t) => <option key={t} value={t}>{ANNOTATION_LABEL[t]}</option>)}
                      </select>
                      {editable && (
                        <span className="ml-auto flex items-center gap-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100">
                          <GripVertical size={13} className="cursor-grab text-tertiary" />
                          <button type="button" title="上移" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, i - 1) }} className="rounded p-0.5 hover:text-primary disabled:opacity-30"><ArrowUp size={13} /></button>
                          <button type="button" title="下移" disabled={i === items.length - 1} onClick={(e) => { e.stopPropagation(); move(i, i + 1) }} className="rounded p-0.5 hover:text-primary disabled:opacity-30"><ArrowDown size={13} /></button>
                          <button type="button" title="刪除" onClick={(e) => { e.stopPropagation(); remove(a.id) }} className="rounded p-0.5 hover:text-danger"><Trash2 size={13} /></button>
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        value={a.label}
                        disabled={!editable}
                        placeholder="這一步要做什麼"
                        maxLength={60}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(a.id, { label: e.target.value })}
                        className={clsx('h-8 text-sm', a.label.length > COUNTER_FROM && 'pr-12')}
                      />
                      {a.label.length > COUNTER_FROM && (
                        <span className={clsx('pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]',
                          a.label.length > labelLimit ? 'font-medium text-danger' : 'text-secondary')}>{a.label.length}/{labelLimit}</span>
                      )}
                    </div>
                    {a.type === 'input' && (
                      <Input value={a.example_text ?? ''} disabled={!editable} placeholder="範例文字（例：0912-345-678）"
                        onClick={(e) => e.stopPropagation()} onChange={(e) => patch(a.id, { example_text: e.target.value })} className="h-8 text-sm" />
                    )}
                    {a.type === 'gesture' && (
                      <select value={a.direction || 'up'} disabled={!editable} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(a.id, { direction: e.target.value as Annotation['direction'] })}
                        className="h-8 w-full rounded-lg border border-border bg-canvas px-2 text-sm outline-none focus:border-accent">
                        {DIRECTIONS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
                      </select>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="h-px bg-border" />
          {/* What the card prints besides the annotations — edited next to the picture it goes on. */}
          <div className="space-y-3">
            <div className="text-[12px] font-medium text-muted">文字</div>
            <TextField value={step.title} onSave={(v) => onPatchStep({ title: v })} placeholder="步驟標題" disabled={!canEdit} required
              maxLen={limits?.title} className="text-[15px] font-medium" />
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">操作說明</div>
              <TextField value={step.instruction} onSave={(v) => onPatchStep({ instruction: v })} disabled={!canEdit}
                placeholder="要民眾做什麼，一句話" multiline rows={2} maxLen={limits?.instruction} />
              <p className="mt-1 text-[11px] leading-4 text-secondary">標註都沒寫說明時，這句會印在標題下。</p>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">卡住時的提示</div>
              <TextField value={step.stuck_hint} onSave={(v) => onPatchStep({ stuck_hint: v })} disabled={!canEdit}
                placeholder="民眾找不到時可以提醒什麼" multiline rows={2} />
            </div>
          </div>

          <div className="h-px bg-border" />
          <div className="space-y-2">
            {locked ? (
              <AIStatus status={variant.status} progress={variant.progress} since={variant.updated_at} aside="排版與輸出通常不到一分鐘。" />
            ) : (
              <>
                {renderFailed(variant) && <AIError title="教學圖沒有產生成功" detail={variant.error} />}
                <Button variant="default" className="w-full justify-center" onClick={() => setLayoutOpen(true)}
                  disabled={!editable || busy || replica.status !== 'ok'}>
                  <LayoutTemplate size={14} /> 調整版面與聚焦
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="primary" className="flex-1 justify-center" onClick={render} loading={busy}
                    disabled={!editable || busy || replica.status !== 'ok'}>
                    <Sparkles size={14} /> {completed ? '重新產生教學圖' : '產生教學圖'}
                  </Button>
                  <Button variant="default" onClick={moreMenu} className="px-2.5" title="更多"><MoreHorizontal size={15} /></Button>
                </div>
              </>
            )}
            {warnings.length > 0 && <p className="text-xs leading-5 text-warn">{warnings.join('；')}</p>}
          </div>
        </div>
      </div>

      {completed && variant.stepcard_url && (
        <div className="space-y-3 border-t border-border pt-8">
          <div className="text-[12px] font-medium text-muted">教學圖</div>
          <img src={variant.stepcard_url} alt="教學圖" className="mx-auto block w-full max-w-3xl rounded-xl border border-border" style={{ boxShadow: 'var(--shadow-card)' }} />
          <div className="flex items-center justify-center gap-3">
            <Button variant="default" onClick={() => copy(variant.stepcard_url!)}><Copy size={13} /> 複製圖片網址</Button>
            <a href={variant.stepcard_url} download target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-canvas px-3.5 text-sm font-medium hover:bg-background-lite"><Download size={13} /> 下載</a>
          </div>
        </div>
      )}

      {saveComponent.dialog}
      {menu.menu && <ContextMenu menu={menu.menu} onClose={menu.close} />}
      {layoutOpen && <div data-overlay><LayoutEditor variant={variant} annotations={items} isAdmin={isAdmin} onClose={() => setLayoutOpen(false)}
        onSaved={onRefresh} /></div>}
      {isAdmin && advanced && <AdvancedHtmlModal open={advanced} onClose={() => setAdvanced(false)} variantId={variant.id} onSaved={async () => { setDirty(false); await onRefresh() }} />}
    </div>
  )
}
