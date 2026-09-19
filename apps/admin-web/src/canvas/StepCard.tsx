/**
 * A step on the canvas. The card speaks one visual language for its state:
 *
 *  - nothing yet: a dashed picture area that says where the screenshot goes;
 *  - the AI at work: the picture breathes behind a blur with a shimmering
 *    word for the phase, and sharpens the moment the result lands;
 *  - waiting for a person: one accent button in the footer with the verb;
 *  - failed: the same button in red, reading「重試」;
 *  - finished: a small green tick and nothing else.
 *
 * Hovering reveals the "+" handle on the right edge — click to append, drag
 * to connect. Double-click opens the sheet; double-click the title to rename.
 * Positioning, dragging and selection all live in FlowCanvas.
 */

import { clsx } from 'clsx'
import { ArrowRight, Check, ImagePlus } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useProtectedImage } from '../components/variant/hooks'
import { AIStatusInline, Ring } from '../components/ai/AIStatus'
import { cardInfo, originalUrl, replicaUrl, thumbnailCandidates, variantOf } from './status'
import type { StepNode } from './model'
import { useInlineEdit } from './useInlineEdit'

interface Props {
  node: StepNode
  /** On a 終點: the document it delivers, printed on the tag. */
  goalName?: string | null
  selected: boolean
  /** A connector is being dragged and this card is under the cursor. */
  dropTarget: boolean
  /** An image file is being dragged over this card (it would replace the screenshot). */
  fileTarget: boolean
  editable: boolean
  justAdded: boolean
  uploading: boolean
  /** Local object URL of a screenshot just dropped on this card. */
  preview: string | null
  renaming: boolean
  onMouseDown: (e: MouseEvent) => void
  onDoubleClick: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
  onHover: (hover: boolean) => void
  /** mousedown on the "+" — FlowCanvas turns it into a click (append) or a drag (connect). */
  onHandleDown: (e: MouseEvent) => void
  onRenameStart: () => void
  onRenameEnd: (title: string | null) => void
  /** The footer button — opens the sheet on this step. */
  onAction: () => void
}

export function StepCard({
  node, goalName, selected, dropTarget, fileTarget, editable, justAdded, uploading, preview, renaming,
  onMouseDown, onDoubleClick, onContextMenu, onHover, onHandleDown, onRenameStart, onRenameEnd, onAction,
}: Props) {
  const { step, box } = node
  const light = variantOf(step, 'light')
  const info = cardInfo(step)
  // Picture priority: finished Step Card → AI replica → the screenshot itself
  // (the local copy while it uploads, the server original after a reload).
  // The small thumbnail may be missing on older cards: fall back on error.
  const [brokenCards, setBrokenCards] = useState<ReadonlySet<string>>(() => new Set())
  const card = thumbnailCandidates(step).find((u) => !brokenCards.has(u)) ?? null
  const replicaSrc = card ? null : replicaUrl(light)
  const replica = useProtectedImage(replicaSrc)
  const original = useProtectedImage(card || replicaSrc || preview ? null : originalUrl(light), light?.original_version ?? undefined)
  const src = card ?? replica.src ?? preview ?? original.src
  const busy = uploading || info.busy
  const failed = info.tone === 'failed'
  const empty = !light || light.status === 'not_uploaded'
  const ring = selected || dropTarget || fileTarget

  // When a job ends and a new picture arrives, let it sharpen in.
  const wasBusy = useRef(busy)
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    if (wasBusy.current && !busy && src) { setReveal(true); const t = window.setTimeout(() => setReveal(false), 700); return () => window.clearTimeout(t) }
    wasBusy.current = busy
  }, [busy, src])
  useEffect(() => { wasBusy.current = busy }, [busy])

  return (
    <div
      className={clsx('group/step select-none', justAdded && 'pg-nodepop')}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, cursor: editable ? 'grab' : 'default', pointerEvents: 'auto' }}
    >
      <div
        className={clsx('flex h-full flex-col overflow-hidden rounded-xl border bg-canvas transition-[box-shadow,border-color] duration-150',
          ring ? 'border-accent' : 'border-border group-hover/step:border-tertiary')}
        style={{ boxShadow: ring ? '0 0 0 3px var(--accent-bg), var(--shadow-lift)' : 'var(--shadow-card)' }}
      >
        {/* picture */}
        <div className="relative min-h-0 flex-1 bg-background">
          {src ? (
            <>
              <img
                src={src} alt="" draggable={false}
                className={clsx('h-full w-full object-cover object-top', busy && 'pg-working-img', reveal && 'pg-reveal')}
                onError={() => { if (src === card) setBrokenCards((b) => new Set(b).add(src)) }}
              />
              {busy && (
                <div className="pg-fadein absolute bottom-2 left-2 flex h-6 items-center rounded-full border border-border bg-canvas/90 px-2 backdrop-blur">
                  {uploading
                    ? <span className="inline-flex items-center gap-1.5"><Ring size={12} className="text-accent" /><span className="pg-shimmer text-[11px] font-medium">上傳中</span></span>
                    : <AIStatusInline status={light!.status} progress={light!.progress} />}
                </div>
              )}
            </>
          ) : (
            <div className={clsx('m-2 flex h-[calc(100%-16px)] flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors',
              failed ? 'border-danger/40 text-danger' : 'border-tertiary text-secondary group-hover/step:border-secondary')}>
              {busy ? <Ring size={18} className="text-accent" /> : <ImagePlus size={20} strokeWidth={1.5} />}
              <span className="text-[11px]">
                {busy ? (uploading ? '上傳中' : info.label) : failed ? info.label : empty ? (editable ? '拖入截圖' : '尚未上傳') : '截圖已上傳'}
              </span>
            </div>
          )}
          {fileTarget && (
            <div className="pg-fadein absolute inset-0 flex items-center justify-center bg-accent-bg text-[12px] font-medium text-accent backdrop-blur-[2px]">
              {src ? '換成這張截圖' : '放入截圖'}
            </div>
          )}
          {(step.is_start || step.is_end) && (
            <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-canvas/90 px-1.5 py-0.5 text-[10px] font-medium text-muted backdrop-blur" title={step.is_end ? (goalName ?? '這個終點還沒指定要取得的文件') : undefined}>
              {[step.is_start && '起點', step.is_end && (goalName ? `終點・${goalName}` : '終點・未指定文件')].filter(Boolean).join('　')}
            </span>
          )}
        </div>

        {/* footer */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-2.5 text-[13px] leading-5">
          {renaming ? (
            <RenameInput value={step.title} onDone={onRenameEnd} />
          ) : (
            <span
              className={clsx('min-w-0 flex-1 truncate', !step.title && 'text-secondary')}
              title={step.title}
              onDoubleClick={(e) => { if (!editable) return; e.stopPropagation(); onRenameStart() }}
            >
              {step.title || '未命名步驟'}
            </span>
          )}
          {!renaming && !uploading && info.action && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={onAction}
              className={clsx('flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full pl-2 pr-1.5 text-[11px] font-medium transition-opacity hover:opacity-85',
                failed ? 'bg-danger text-on-accent' : 'bg-accent text-on-accent')}
            >
              {info.action} <ArrowRight size={10} />
            </button>
          )}
          {!renaming && info.tone === 'done' && (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-good-bg text-good" title="教學圖已完成">
              <Check size={10} strokeWidth={3} />
            </span>
          )}
        </div>
      </div>

      {editable && (
        <button
          onMouseDown={onHandleDown}
          title="新增下一步，或拖曳到其他步驟建立連線"
          className="absolute flex items-center justify-center rounded-full border border-border bg-canvas text-muted opacity-0 transition-opacity hover:border-accent hover:text-accent group-hover/step:opacity-100"
          style={{ width: 22, height: 22, right: -11, top: box.h / 2 - 11, cursor: 'crosshair', pointerEvents: 'auto', boxShadow: 'var(--shadow-card)' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  )
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const { bind } = useInlineEdit({ value, onCommit: onDone, onCancel: () => onDone(null), autoSelect: true })
  return (
    <input
      {...bind}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-canvas px-1 text-[13px] outline-none"
    />
  )
}
