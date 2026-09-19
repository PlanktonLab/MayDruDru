/**
 * The platform's shared context — 示範資料 (the one persona every replica of
 * the platform shows) and 共用區塊 (approved snippets every replica reuses).
 * Edited from the platform dialog and, since a clerk discovers the need for
 * them while looking at one screen, from the replica stages themselves.
 */

import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Blocks, ChevronDown, ChevronLeft, Plus, Trash2, X } from 'lucide-react'
import { del, get, patch } from '../../lib/api'
import { COMPONENT_KIND_LABEL, type ComponentKind, type DemoDataField, type Platform, type PlatformComponent } from '../../lib/types'
import { newId, useProtectedImage } from '../variant/hooks'
import { EmptyState, Skeleton, confirm, errMsg, useToast } from '../ui'
import { Picker, TextField } from '../../canvas/fields'
import { useEditor } from '../../canvas/context'

const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-1 text-[12px] font-medium text-muted">{children}</div>
)

/**
 * 示範資料 rows, with no fixed vocabulary: each platform names its own fields
 * (a 稅務 site wants 統一編號, a 銀行 App wants 卡號末四碼). A row is kept on
 * the server once it has a name; rows with no name or value stay local until
 * one is typed, so「新增欄位」never stores an empty field.
 */
export function DemoData({ platform, disabled, onSave, compact }: { platform: Platform; disabled: boolean; onSave: (v: DemoDataField[]) => void; compact?: boolean }) {
  const [rows, setRows] = useState<DemoDataField[]>(platform.demo_data ?? [])
  const [seen, setSeen] = useState(platform.demo_data)
  // Adopt the server's rows when they change underneath us, keeping unsaved blank rows.
  if (seen !== platform.demo_data) {
    setSeen(platform.demo_data)
    setRows((cur) => [...(platform.demo_data ?? []), ...cur.filter((r) => !r.label.trim() && !platform.demo_data?.some((f) => f.key === r.key))])
  }

  const persist = (next: DemoDataField[]) => {
    setRows(next)
    onSave(next.filter((f) => f.label.trim() !== '').map((f) => ({ ...f, label: f.label.trim(), value: f.value.trim() })))
  }
  const commit = (key: string, p: Partial<DemoDataField>) => {
    const next = rows.map((f) => (f.key === key ? { ...f, ...p } : f))
    const row = next.find((f) => f.key === key)!
    // A row named nothing yet is not worth a request; keep it local.
    if (!row.label.trim() && !platform.demo_data?.some((f) => f.key === key)) { setRows(next); return }
    persist(next)
  }
  const add = () => setRows((cur) => [...cur, { key: `f${newId()}`, label: '', value: '' }])
  const remove = (key: string) => persist(rows.filter((f) => f.key !== key))

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-[13px] leading-5 text-muted">
          AI 重製畫面時，資料區域會統一用這組資料，整條流程讀起來才像同一筆申請。欄位由你決定，例如申請人姓名、案件編號、金額。
          你填的值會一字不差出現在教學圖上，AI 不會自己改寫。
        </p>
      )}
      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-x-3 gap-y-2">
          <div className="text-[11px] font-medium text-muted">欄位</div>
          <div className="text-[11px] font-medium text-muted">值</div>
          <div />
          {rows.map((f) => (
            <RowFields key={f.key} f={f} disabled={disabled} commit={commit} onRemove={() => remove(f.key)} />
          ))}
        </div>
      )}
      {rows.length === 0 && <p className="text-[12px] text-secondary">還沒有欄位。</p>}
      {!disabled && (
        <button type="button" onClick={add} className="flex items-center gap-1 text-[13px] text-accent hover:underline underline-offset-4">
          <Plus size={13} /> 新增欄位
        </button>
      )}
    </div>
  )
}

function RowFields({ f, disabled, commit, onRemove }: { f: DemoDataField; disabled: boolean; commit: (key: string, p: Partial<DemoDataField>) => void; onRemove: () => void }) {
  return (
    <>
      <TextField value={f.label} disabled={disabled} placeholder="欄位名稱" required onSave={(v) => commit(f.key, { label: v })} />
      <TextField value={f.value} disabled={disabled} placeholder="值，留空表示不指定" onSave={(v) => commit(f.key, { value: v })} />
      <button type="button" onClick={onRemove} disabled={disabled} title="移除這個欄位" className="flex h-7 w-7 items-center justify-center rounded-lg text-secondary hover:bg-background-lite hover:text-danger disabled:opacity-40">
        <X size={13} />
      </button>
    </>
  )
}

/* ---- components (共用區塊) */

export function Components({ platform, compact }: { platform: Platform; compact?: boolean }) {
  const ed = useEditor()
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['components', platform.id], queryFn: () => get<PlatformComponent[]>(`/api/platforms/${platform.id}/components`) })
  const [picked, setPicked] = useState<string | null>(null)
  const c = q.data?.find((x) => x.id === picked) ?? null

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['components', platform.id] }),
    qc.invalidateQueries({ queryKey: ['canvas'] }),
    qc.invalidateQueries({ queryKey: ['platforms'] }),
  ])
  const save = async (id: string, body: { name?: string; kind?: ComponentKind }) => {
    try { await patch(`/api/components/${id}`, body); await refresh() } catch (e) { toast(errMsg(e), 'err') }
  }
  const remove = async (x: PlatformComponent) => {
    if (!await confirm({ title: `刪除「${x.name}」？`, body: '之後重製的畫面不會再沿用這塊。', action: '刪除', danger: true })) return
    try { await del(`/api/components/${x.id}`); setPicked(null); await refresh() } catch (e) { toast(errMsg(e), 'err') }
  }

  if (q.isLoading) return <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
  if (q.error || !q.data) return <p className="text-[13px] text-danger">共用區塊載入失敗</p>

  if (c) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setPicked(null)} className="-ml-1 flex items-center gap-1 text-[13px] text-muted hover:text-primary"><ChevronLeft size={14} /> 共用區塊</button>
        <Thumb url={c.thumb_url} className="h-32 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>名稱</Label>
            <TextField value={c.name} disabled={!ed.editable} placeholder="名稱" required onSave={(v) => void save(c.id, { name: v })} />
          </div>
          <div>
            <Label>類型</Label>
            <Picker value={c.kind} disabled={!ed.editable} onChange={(v) => void save(c.id, { kind: v as ComponentKind })}>
              {(Object.keys(COMPONENT_KIND_LABEL) as ComponentKind[]).map((k) => <option key={k} value={k}>{COMPONENT_KIND_LABEL[k]}</option>)}
            </Picker>
          </div>
        </div>
        <p className="text-[12px] text-secondary">{c.width}×{c.height} · {fmtDate(c.created_at)}</p>
        {ed.isAdmin && <button type="button" onClick={() => void remove(c)} className="flex items-center gap-1 text-[13px] text-danger hover:opacity-80"><Trash2 size={13} /> 刪除這塊</button>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!compact && <p className="text-[13px] leading-5 text-muted">跨畫面重複出現的區塊，例如底部 Tab bar、頂部導覽列。存起來之後，AI 重製每一張畫面都會沿用同一份，整條流程才會一致。</p>}
      {q.data.length === 0 ? (
        <EmptyState icon={<Blocks size={18} />} title="還沒有共用區塊" hint="在審核或標註畫面按「⋯」→「存為共用區塊」，框出 Tab bar 或導覽列就會出現在這裡。" className="py-4" />
      ) : (
        <div className={clsx('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-3')}>
          {q.data.map((x) => (
            <button key={x.id} type="button" onClick={() => setPicked(x.id)} className="rounded-xl border border-border p-2 text-left transition-colors hover:border-tertiary hover:bg-background-lite">
              <Thumb url={x.thumb_url} className="h-16" />
              <div className="mt-1.5 truncate text-[12px] font-medium" title={x.name}>{x.name}</div>
              <div className="truncate text-[11px] text-secondary">{COMPONENT_KIND_LABEL[x.kind] ?? x.kind}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A component thumbnail needs the JWT, so it goes through the protected-image cache. */
export function Thumb({ url, className }: { url: string | null; className?: string }) {
  const img = useProtectedImage(url)
  return (
    <div className={clsx('flex items-center justify-center overflow-hidden rounded-lg border border-border bg-background', className)}>
      {img.status === 'ok' && img.src
        ? <img src={img.src} alt="" className="max-h-full max-w-full object-contain" />
        : img.status === 'loading' ? <Skeleton className="h-full w-full rounded-none" /> : <span className="text-[10px] text-secondary">無縮圖</span>}
    </div>
  )
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}


/* ---- the panel the replica stages show */

/**
 * 示範資料 and 共用區塊 folded under one heading, so every replica stage
 * carries the platform-wide settings without becoming a settings page.
 */
export function PlatformContextPanel({ platform }: { platform: Platform }) {
  const ed = useEditor()
  const [open, setOpen] = useState<'demo' | 'components' | null>(null)
  const save = (demo_data: DemoDataField[]) => { void ed.actions.patchPlatform(platform.id, { demo_data }) }
  const filled = (platform.demo_data ?? []).filter((f) => f.value.trim() !== '').length
  const row = (k: 'demo' | 'components', title: string, count: number) => (
    <button type="button" onClick={() => setOpen((o) => (o === k ? null : k))} className="flex w-full items-center justify-between py-2 text-left text-[13px] text-primary">
      <span>{title}</span>
      <span className="flex items-center gap-2 text-[12px] text-secondary">
        {count > 0 && <span className="tabular-nums">{count}</span>}
        <ChevronDown size={13} className={clsx('transition-transform', open === k && 'rotate-180')} />
      </span>
    </button>
  )
  return (
    <div className="rounded-xl border border-border px-3">
      <div className="pt-2.5 text-[11px] font-medium text-muted">{platform.display_name} 的共用設定</div>
      {row('demo', '示範資料', filled)}
      {open === 'demo' && <div className="pb-3"><DemoData platform={platform} disabled={!ed.editable} onSave={save} compact /></div>}
      <div className="border-t border-border" />
      {row('components', '共用區塊', platform.component_count)}
      {open === 'components' && <div className="pb-3"><Components platform={platform} compact /></div>}
    </div>
  )
}
