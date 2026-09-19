/**
 * The step workspace — a sheet that slides in over the right of the canvas
 * and walks one screenshot through three stages: 截圖與重點 → 審核 → 標註與產出.
 *
 * It is a sheet, not a page, so the flow stays visible behind it and the
 * clerk never loses their place; a toggle widens it to the whole screen for
 * the side-by-side review. Light is the theme that matters (it is what a
 * flow needs to publish); dark only appears once someone adds it.
 *
 * While open, the sheet owns the keyboard: the canvas ignores every key
 * (see keys.ts) and Escape closes the sheet. Leaving with unsaved focus boxes
 * or annotations — Escape, ×, the scrim, or switching theme — asks first.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Maximize2, Minimize2, Pencil, Plus, X } from 'lucide-react'
import type { Step, Theme } from '../lib/types'
import { isTyping } from '../lib/keys'
import { AnnotateStage } from '../components/variant/AnnotateStage'
import { CaptureStage } from '../components/variant/CaptureStage'
import { ReviewStage } from '../components/variant/ReviewStage'
import { useMeta, useRefreshVariant, useVariant } from '../components/variant/hooks'
import { Segmented } from '../components/variant/parts'
import { EmptyState, Skeleton, confirm, errMsg } from '../components/ui'
import { STATUS, THEME_LABEL, themeHasWork } from './status'
import { useEditor } from './context'
import { useInlineEdit } from './useInlineEdit'

const STAGES = ['截圖與重點', '審核', '標註與產出']
const LS_WIDE = 'sop_sheet_wide'

export function WorkspaceSheet({ step, theme }: { step: Step; theme: Theme }) {
  const ed = useEditor()
  const { editable, canReview, isAdmin, closeWorkspace, openWorkspace, platform } = ed
  const qc = useQueryClient()
  const meta = useMeta()
  const variantId = step.variants.find((v) => v.theme === theme)?.id
  const variant = useVariant(variantId)
  const refreshVariant = useRefreshVariant(variantId)
  const [wide, setWide] = useState(() => localStorage.getItem(LS_WIDE) === '1')
  const toggleWide = () => setWide((w) => { localStorage.setItem(LS_WIDE, w ? '0' : '1'); return !w })
  // After a mutation the card must follow; once a job is running the canvas polls by itself.
  const refresh = async () => { await Promise.all([refreshVariant(), qc.invalidateQueries({ queryKey: ['canvas'] })]) }

  /* ------------------------------------------------------- leaving the sheet */
  const dirty = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => { dirty.current = d }, [])
  const leave = useCallback(async (go: () => void) => {
    if (dirty.current && !await confirm({ title: '離開這個步驟？', body: '還沒儲存的框或標註會消失。', action: '離開', danger: true })) return
    dirty.current = false
    go()
  }, [])
  const close = useCallback(() => { void leave(closeWorkspace) }, [leave, closeWorkspace])

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      // A dialog inside a stage closes itself first.
      if (document.querySelector('[data-overlay]')) return
      e.preventDefault()
      // In a text field Escape only leaves the field.
      if (isTyping(e.target)) { (e.target as HTMLElement).blur(); return }
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const darkShown = theme === 'dark' || themeHasWork(step, 'dark')
  const status = variant.data?.status
  const stage = status ? STATUS[status].stage : 0

  return (
    <div ref={rootRef} className="absolute inset-0 z-30 flex justify-end" data-workspace="1">
      {/* scrim: the canvas stays visible; a click on it puts the sheet away */}
      <div className="pg-fadein absolute inset-0 bg-scrim" onMouseDown={close} />

      <section
        className="pg-sheetin relative flex h-full flex-col border-l border-border bg-canvas transition-[width] duration-200"
        style={{ width: wide ? '100%' : 'min(960px, calc(100% - 96px))', boxShadow: 'var(--shadow-sheet)' }}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border pl-4 pr-2">
          <div className="min-w-0 flex-1">
            {stage === 2
              // the title is edited in the annotation column, with the rest of the card's text
              ? <div className={clsx('truncate pl-2.5 text-[15px] font-medium', !step.title && 'text-secondary')}>{step.title || '未命名步驟'}</div>
              : <TitleInput value={step.title} disabled={!editable} onSave={(v) => ed.renameStep(step.id, v)} />}
          </div>

          <ol className="flex items-center gap-1 text-[12px]" aria-label="階段">
            {STAGES.map((label, i) => {
              const on = i === stage, done = i < stage
              return (
                <li key={label} className="flex items-center gap-1">
                  <span className={clsx('flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1 pr-2.5',
                    on ? 'bg-background-lite font-medium text-primary' : done ? 'text-muted' : 'text-secondary')}>
                    <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full text-[10px] leading-none',
                      on ? 'bg-primary text-canvas' : done ? 'bg-good-bg text-good' : 'border border-border')}>
                      {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={clsx(!on && 'hidden lg:inline')}>{label}</span>
                  </span>
                  {i < STAGES.length - 1 && <span className="h-px w-3 bg-border" />}
                </li>
              )
            })}
          </ol>

          <div className="flex shrink-0 items-center gap-1">
            {darkShown ? (
              <Segmented<Theme>
                value={theme}
                options={[{ v: 'light', l: THEME_LABEL.light }, { v: 'dark', l: THEME_LABEL.dark }]}
                onChange={(t) => t !== theme && void leave(() => openWorkspace(step.id, t))}
              />
            ) : (
              <button
                type="button" disabled={!editable}
                onClick={() => void leave(() => openWorkspace(step.id, 'dark'))}
                title="深色版本是選配：民眾用深色模式時會拿到它，沒有就退回淺色"
                className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-muted transition-colors hover:bg-background-lite hover:text-primary disabled:opacity-40"
              >
                <Plus size={12} /> 深色
              </button>
            )}
            <button type="button" onClick={toggleWide} title={wide ? '縮回側欄' : '放大到全螢幕'} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background-lite hover:text-primary">
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button type="button" onClick={close} title="關閉（Esc）" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background-lite hover:text-primary">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {!variantId ? (
            <EmptyState title={`這個步驟還沒有${THEME_LABEL[theme]}版本`} hint="請重新整理後再試一次。" />
          ) : variant.isLoading ? (
            <div className="grid gap-8 px-6 py-6 md:grid-cols-[minmax(0,1fr)_300px]">
              <Skeleton className="mx-auto h-[60vh] w-full max-w-[380px] rounded-xl" />
              <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="mt-6 h-9" /></div>
            </div>
          ) : variant.error || !variant.data ? (
            <EmptyState title="載入不到這個步驟" hint={variant.error ? errMsg(variant.error) : undefined} />
          ) : stage === 1 ? (
            // `key`: a stage instance never outlives its variant (light ↔ dark must not share unsaved boxes).
            <ReviewStage key={variant.data.id} variant={variant.data} platform={platform} canReview={canReview} canEdit={editable} isAdmin={isAdmin} onRefresh={refresh} />
          ) : stage === 2 ? (
            <AnnotateStage key={variant.data.id} onDirtyChange={onDirtyChange} variant={variant.data} step={step} meta={meta.data} canEdit={editable} isAdmin={isAdmin}
              onRefresh={refresh} onPatchStep={(body) => void ed.actions.patchStep(step.id, body)} />
          ) : (
            <CaptureStage key={variant.data.id} onDirtyChange={onDirtyChange} variant={variant.data} platform={platform} meta={meta.data} canEdit={editable} onRefresh={refresh} />
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * The step title in the sheet header, for the first two stages. It has to
 * read as editable at rest — a filled field with a pencil — not only on
 * hover, since the clerk comes here straight from dropping a screenshot and
 * the title is still「新步驟」. In the last stage the title moves into the
 * annotation column, beside the rest of the card's text.
 */
function TitleInput({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const { bind } = useInlineEdit({ value, onCommit: onSave })
  return (
    <label className="group relative flex max-w-[360px] items-center">
      <input
        {...bind}
        disabled={disabled} placeholder="步驟標題" aria-label="步驟標題"
        onFocus={(e) => { bind.onFocus(); e.currentTarget.select() }}
        className="h-8 w-full rounded-lg border border-transparent bg-background pl-2.5 pr-8 text-[15px] font-medium outline-none transition-colors placeholder:text-secondary hover:border-border focus:border-accent focus:bg-canvas disabled:bg-transparent"
      />
      {!disabled && <Pencil size={13} className="pointer-events-none absolute right-2.5 text-secondary transition-opacity group-focus-within:opacity-0" />}
    </label>
  )
}
