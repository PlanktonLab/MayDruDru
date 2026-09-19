/**
 * 「存為元件」— framing a piece of an approved replica and storing it in the
 * platform's component library (SPEC §6.5). It lives here rather than in one
 * stage because the replica is on screen twice: in 審核 (next to the original)
 * and in 標註 (under the annotation tool), and the reviewer notices the reusable
 * furniture in either place.
 *
 * `useSaveComponent` returns the two pieces a stage has to place itself — the
 * picker overlay, which belongs on top of the replica image, and the naming
 * dialog — so both stages behave identically.
 */

import { useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, post } from '../../lib/api'
import { COMPONENT_KIND_LABEL, type ComponentKind, type PlatformComponent } from '../../lib/types'
import { Button, Input, Modal, Select, errMsg, useToast } from '../ui'

export interface Rect { x: number; y: number; w: number; h: number }

/** Fraction of the page a component rectangle has to cover before it is worth extracting. */
const MIN_RECT = 0.004
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Drag a rectangle over the replica; fractions of the image, which are fractions of the page. */
export function RectPicker({ onPick }: { onPick: (r: Rect) => void }) {
  const [drag, setDrag] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null)
  const at = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const rect = drag && { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy), w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ sx: p.x, sy: p.y, cx: p.x, cy: p.y }) }}
      onPointerMove={(e) => { if (!drag) return; const p = at(e); setDrag({ ...drag, cx: p.x, cy: p.y }) }}
      onPointerUp={(e) => {
        if (!rect) return
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
        setDrag(null)
        if (rect.w * rect.h >= MIN_RECT) onPick(rect)
      }}
    >
      {rect && rect.w > 0 && rect.h > 0 && (
        <div className="pointer-events-none absolute rounded-sm border-2 border-dashed border-accent"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, background: 'color-mix(in oklab, var(--accent) 10%, transparent)' }} />
      )}
    </div>
  )
}

export interface SaveComponent {
  /** True while the overlay is armed — the stage disables its own drawing then. */
  picking: boolean
  start: () => void
  cancel: () => void
  /** Render inside the replica's positioned wrapper; null when not picking. */
  overlay: ReactNode
  /** Render anywhere; null until a rectangle has been drawn. */
  dialog: ReactNode
}

/** Wires the picker to the naming dialog and to the caches the new component lands in. */
export function useSaveComponent(variantId: string): SaveComponent {
  const qc = useQueryClient()
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Rect | null>(null)

  const saved = async (c: PlatformComponent) => {
    setPicked(null)
    setPicking(false)
    // The response carries the platform, which the stage itself does not know.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['components', c.platform_id] }),
      qc.invalidateQueries({ queryKey: ['canvas'] }),
      qc.invalidateQueries({ queryKey: ['platforms'] }),
    ])
    toast('已存為元件')
  }

  return {
    picking,
    start: () => setPicking(true),
    cancel: () => { setPicking(false); setPicked(null) },
    overlay: picking ? <RectPicker onPick={setPicked} /> : null,
    dialog: picked
      ? <div data-overlay><SaveComponentModal variantId={variantId} rect={picked} onClose={() => setPicked(null)} onSaved={saved} /></div>
      : null,
  }
}

/** Names the rectangle the reviewer drew and stores it in the platform's component library. */
function SaveComponentModal({ variantId, rect, onClose, onSaved }: {
  variantId: string; rect: Rect; onClose: () => void; onSaved: (c: PlatformComponent) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ComponentKind>('tab_bar')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const c = await post<PlatformComponent>(`/api/variants/${variantId}/components`, { rect, name: name.trim(), kind })
      await onSaved(c)
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="存為共用元件" width={420}>
      <form onSubmit={(e) => { e.preventDefault(); void save() }} className="space-y-4">
        <div className="space-y-1.5">
          <Input autoFocus value={name} maxLength={80} placeholder="名稱，例如：底部 Tab bar" onChange={(e) => setName(e.target.value)} />
          <Select value={kind} onChange={(e) => setKind(e.target.value as ComponentKind)} className="w-full">
            {(Object.keys(COMPONENT_KIND_LABEL) as ComponentKind[]).map((k) => <option key={k} value={k}>{COMPONENT_KIND_LABEL[k]}</option>)}
          </Select>
        </div>
        <p className="text-xs leading-5 text-muted">這個平台之後的每一張復刻，只要畫面上有同樣的元件，都會直接沿用這一份。</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>儲存</Button>
        </div>
      </form>
    </Modal>
  )
}
