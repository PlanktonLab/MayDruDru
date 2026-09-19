/**
 * 假資料同步 (SPEC §6.5) — what the AI put on a screen in place of real data,
 * and what to keep from it.
 *
 * A replica has to invent whatever the platform's 示範資料 does not cover: the
 * 刷卡時間 nobody thought of, an order number. Left alone, the next screen
 * invents a different one and the batch stops reading as one application — so
 * every replica reports what it placed. Values that came from the shared set
 * are 沿用 and need no attention; the ones it made up wait for a decision.
 *
 * Nothing interrupts: the review stage carries one quiet line and the dialog
 * opens only when asked, because the clerk may be in the middle of something
 * else. Adopting writes into the platform's 示範資料, so every screen processed
 * after this one uses the same values; when a value was corrected rather than
 * accepted, this screen can be drawn again in the same breath.
 */

import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Sparkles, X } from 'lucide-react'
import { ApiError, post } from '../../lib/api'
import type { DemoDataField, FakeDataPick, FakeDatum, Platform, Variant } from '../../lib/types'
import { Button, Input, Modal, errMsg, useToast } from '../ui'
import { TextLink } from './parts'

/** Mirrors DEMO_DATA_MAX_FIELDS in backend/app/schemas.py. */
const MAX_SHARED_FIELDS = 20
const MAX_LABEL = 40
const MAX_VALUE = 60

const isNew = (f: FakeDatum) => f.source === 'new'
const rowName = (f: FakeDatum) => f.label || f.value

/** A row of the dialog: one reported value, plus whether it is being kept.
 *  `was` is what the replica actually shows, kept while `value` is edited. */
interface Row extends FakeDatum { adopt: boolean; was: string }

export interface FakeDataSync {
  /** The quiet line for the top of the stage; null when nothing is waiting. */
  notice: ReactNode
  /** Render anywhere; null until the dialog is asked for. */
  dialog: ReactNode
  /** Open it from elsewhere — the 假資料 list keeps its own way in. */
  open: () => void
  /** There is a shared set to write to and the rights to write it. */
  canOpen: boolean
}

/**
 * Wires the notice, the dialog and the caches the adopted values land in.
 * `onRefresh` is the stage's own refresh (variant + canvas).
 */
export function useFakeDataSync(variant: Variant, platform: Platform | null, canEdit: boolean, onRefresh: () => Promise<unknown>): FakeDataSync {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fresh = (variant.fake_data ?? []).filter(isNew)
  const waiting = !variant.fake_data_reviewed && fresh.length > 0
  const canOpen = !!platform && canEdit

  const done = async () => {
    // The platform's 示範資料 rides on the canvas payload; other pages read ['platforms'].
    await Promise.all([onRefresh(), qc.invalidateQueries({ queryKey: ['platforms'] })])
  }
  const dismiss = async () => {
    setBusy(true)
    try {
      await post(`/api/variants/${variant.id}/fake-data`, { adopt: [], regenerate: false })
      await done()
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }

  return {
    canOpen,
    open: () => setOpen(true),
    notice: waiting ? (
      <div className="pg-dropin flex items-start gap-3 rounded-xl border border-border bg-background-lite px-3.5 py-3">
        <Sparkles size={15} className="mt-[3px] shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-primary">AI 在這頁編了 {fresh.length} 筆共用假資料裡沒有的資料</div>
          <div className="mt-0.5 truncate text-[12px] text-muted">{[...new Set(fresh.map(rowName))].join('、')}</div>
        </div>
        <TextLink onClick={() => setOpen(true)} disabled={!canOpen} title={canEdit ? undefined : '需要編輯者權限'}>檢視</TextLink>
        <button
          type="button" onClick={() => void dismiss()} disabled={busy} title="先不處理；之後可從下方的假資料清單再開"
          className="-mr-1 -mt-0.5 rounded-lg p-1 text-secondary transition-colors hover:bg-background hover:text-primary disabled:opacity-40"
          aria-label="先不處理"
        >
          <X size={14} />
        </button>
      </div>
    ) : null,
    dialog: open && platform
      ? <div data-overlay><FakeDataDialog variant={variant} platform={platform} onClose={() => setOpen(false)} onDone={done} /></div>
      : null,
  }
}

/** The report as the review stage lists it: what it is, what it says, where it came from. */
export function FakeDataList({ rows }: { rows: FakeDatum[] }) {
  if (rows.length === 0) return <span className="text-sm text-secondary">（無）</span>
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((f, i) => (
        <li key={`${f.label}-${f.value}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          {f.label && <span className="text-muted">{f.label}</span>}
          <span className="break-all text-primary">{f.value}</span>
          <span className={clsx('text-[11px]', isNew(f) ? 'text-secondary' : 'text-good')}>{isNew(f) ? '這頁新編的' : '沿用共用'}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The decision itself. New values are checked by default — the whole point is
 * that nobody thought of them — up to whatever room the shared set has left.
 * A 沿用 row is editable too: correcting it here corrects it for the platform.
 *
 * Correcting a value also leaves this screen showing the wrong one, so the
 * second action offers to fix the picture: the server swaps those words in the
 * replica and renders again, without redrawing the interface.
 */
function FakeDataDialog({ variant, platform, onClose, onDone }: {
  variant: Variant; platform: Platform; onClose: () => void; onDone: () => Promise<void>
}) {
  const toast = useToast()
  const demo = platform.demo_data ?? []
  const [rows, setRows] = useState<Row[]>(() => initialRows(variant.fake_data ?? [], demo))
  const [busy, setBusy] = useState(false)

  const fresh = rows.filter(isNew)
  const reused = rows.filter((r) => !isNew(r))
  const picks = toPicks(rows, demo)
  // One name is one field, so only names the shared set does not have yet take a slot.
  const owned = names(demo.map((d) => d.label))
  const picked = names(fresh.filter((r) => r.adopt).map((r) => r.label))
  const full = [...picked].filter((l) => !owned.has(l)).length >= MAX_SHARED_FIELDS - demo.length
  const clash = [...picked].filter((l) => owned.has(l))
  // Only a value that differs from what the picture shows gives the redo something to do.
  const edits = picks.filter((p) => p.replaces && p.replaces !== p.value)
  const set = (i: number, p: Partial<Row>) => setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...p } : r)))

  const save = async (regenerate: boolean) => {
    setBusy(true)
    try {
      await post(`/api/variants/${variant.id}/fake-data`, { adopt: picks, regenerate })
      await onDone()
      toast(regenerate ? `已儲存，正在把這張圖上的 ${edits.length} 個值換掉`
        : picks.length ? `已加入共用假資料，之後的畫面都會用這 ${picks.length} 筆` : '已記下，這頁不再提醒')
      onClose()
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }

  return (
    <Modal
      open onClose={() => !busy && onClose()} width={580}
      title="AI 在這頁放的假資料"
      subtitle="勾起來的會變成這個平台的共用假資料，之後每一張圖都用同一個值。"
    >
      <div className="space-y-5">
        {fresh.length > 0 && (
          <section className="space-y-2">
            <Heading>這頁新編的（{fresh.length}）</Heading>
            <div className="grid grid-cols-[auto_1fr_1.3fr] items-center gap-x-2.5 gap-y-2">
              {/* `key` is the position: the list never reorders, and a key that
                  followed the text would remount the field on every keystroke. */}
              {rows.map((r, i) => isNew(r) && (
                <RowFields
                  key={i} row={r} disabled={busy}
                  lock={full && !r.adopt && !owned.has(r.label.trim()) && !picked.has(r.label.trim())
                    ? `共用假資料最多 ${MAX_SHARED_FIELDS} 個欄位，已經滿了` : undefined}
                  onChange={(p) => set(i, p)}
                />
              ))}
            </div>
            {clash.length > 0 && (
              <p className="text-[12px] leading-5 text-secondary">
                共用假資料已經有「{clash.join('、')}」，存下去會換成這裡的值；想要兩筆分開就把名稱改掉。
              </p>
            )}
          </section>
        )}

        {reused.length > 0 && (
          <section className="space-y-2">
            <Heading>沿用共用假資料（{reused.length}）</Heading>
            <div className="grid grid-cols-[auto_1fr_1.3fr] items-center gap-x-2.5 gap-y-2">
              {rows.map((r, i) => !isNew(r) && (
                <RowFields key={i} row={r} disabled={busy} onChange={(p) => set(i, p)} />
              ))}
            </div>
            <p className="text-[12px] leading-5 text-secondary">在這裡改值會一起改掉共用假資料，之後的畫面跟著換；已經做好的畫面不會回頭重做。</p>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {variant.status === 'pending_review' && (
            <Button
              variant="default" disabled={busy || edits.length === 0} onClick={() => void save(true)}
              title={edits.length
                ? '只把畫面上這幾個值換掉再重新產生圖，不重畫整個介面；萬一找不到原本的字，才會請 AI 重做'
                : '改掉某個值之後才需要更新這張圖'}
            >
              儲存並更新這張圖
            </Button>
          )}
          <Button variant="primary" loading={busy} onClick={() => void save(false)}>
            {picks.length ? `加入共用假資料（${picks.length}）` : '知道了'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const Heading = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] font-medium text-muted">{children}</div>
)

function RowFields({ row, disabled, lock, onChange }: {
  row: Row; disabled: boolean; lock?: string; onChange: (p: Partial<Row>) => void
}) {
  const shared = !isNew(row)
  return (
    <>
      <div className="flex w-5 justify-center">
        {shared ? (
          <span className="h-1.5 w-1.5 rounded-full bg-good" title="已經在共用假資料裡" />
        ) : (
          <input
            type="checkbox" checked={row.adopt} disabled={disabled || (!row.adopt && !!lock)} title={lock}
            onChange={(e) => onChange({ adopt: e.target.checked })}
            aria-label={`${rowName(row)} 加入共用假資料`} className="accent-[var(--accent)]"
          />
        )}
      </div>
      <Input
        value={row.label} disabled={disabled} maxLength={MAX_LABEL} placeholder="欄位名稱"
        onChange={(e) => onChange({ label: e.target.value })} className="h-8 px-2.5 text-[13px]"
      />
      <Input
        value={row.value} disabled={disabled} maxLength={MAX_VALUE} placeholder="值"
        onChange={(e) => onChange({ value: e.target.value })} className="h-8 px-2.5 text-[13px]"
      />
    </>
  )
}

const names = (labels: string[]) => new Set(labels.map((l) => l.trim()).filter(Boolean))

/** New values start checked, in reported order, until the shared set is full. */
function initialRows(fake: FakeDatum[], demo: DemoDataField[]): Row[] {
  const owned = names(demo.map((d) => d.label))
  let room = MAX_SHARED_FIELDS - demo.length
  return fake.map((f) => {
    const label = f.label.trim()
    const fits = room > 0 || owned.has(label)
    if (isNew(f) && fits && !owned.has(label)) { room -= 1; owned.add(label) }
    return { ...f, adopt: isNew(f) && fits, was: f.value }
  })
}

/** What to send: the 新增 rows that are checked, and the 沿用 rows that changed. */
function toPicks(rows: Row[], demo: DemoDataField[]): FakeDataPick[] {
  const picks: FakeDataPick[] = []
  for (const r of rows) {
    const label = r.label.trim()
    const value = r.value.trim()
    if (!label) continue
    if (isNew(r)) {
      if (r.adopt) picks.push({ key: '', label, value, replaces: r.was })
      continue
    }
    // A 沿用 row only travels when the clerk actually changed it.
    const field = demo.find((d) => d.key === r.key)
    if (field && (field.label !== label || field.value !== value)) picks.push({ key: r.key, label, value, replaces: r.was })
  }
  return picks
}
