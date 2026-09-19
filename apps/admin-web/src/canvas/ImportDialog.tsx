/**
 * Several screenshots at once: before they become steps, show them in a row
 * and let the clerk settle the order — the order *is* the flow. Files arrive
 * sorted by name (natural, so 截圖 2 comes before 截圖 10); one click sorts
 * by time or reverses; a tile can be dragged or nudged with its arrows. One
 * button puts them on the canvas, chained in that order.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Modal } from '../components/ui'
import { Toggle } from './fields'

export interface ImportDialogProps {
  files: File[]
  /** Where the first file goes when it replaces a card's screenshot (null = every file is a new step). */
  replacing: string | null
  onConfirm: (ordered: File[], chain: boolean) => void
  onClose: () => void
}

type Sort = 'name' | 'time' | 'custom'

const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
const byTime = (a: File, b: File) => a.lastModified - b.lastModified || byName(a, b)

export function ImportDialog({ files, replacing, onConfirm, onClose }: ImportDialogProps) {
  const [order, setOrder] = useState<File[]>(() => [...files].sort(byName))
  const [sort, setSort] = useState<Sort>('name')
  const [chain, setChain] = useState(true)
  const dragFrom = useRef<number | null>(null)
  const [over, setOver] = useState<{ index: number; before: boolean } | null>(null)

  // One object URL per file, released when the dialog goes.
  const urls = useMemo(() => new Map(files.map((f) => [f, URL.createObjectURL(f)])), [files])
  useEffect(() => () => { for (const u of urls.values()) URL.revokeObjectURL(u) }, [urls])

  const apply = (s: Exclude<Sort, 'custom'>) => { setSort(s); setOrder((o) => [...o].sort(s === 'name' ? byName : byTime)) }
  const reverse = () => { setSort('custom'); setOrder((o) => [...o].reverse()) }
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return
    setSort('custom')
    setOrder((o) => { const n = [...o]; const [f] = n.splice(from, 1); n.splice(to, 0, f); return n })
  }
  const dropAt = (index: number, before: boolean) => {
    const from = dragFrom.current
    dragFrom.current = null
    setOver(null)
    if (from === null) return
    let to = before ? index : index + 1
    if (from < to) to -= 1
    move(from, to)
  }

  // Confirm once, whether by the button or by Enter (a focused button gets both).
  const confirmed = useRef(false)
  const confirm = () => { if (confirmed.current) return; confirmed.current = true; onConfirm(order, chain) }
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); confirmRef.current() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seg = (s: Sort, label: string, onClick: () => void) => (
    <button
      type="button" onClick={onClick}
      className={clsx('h-7 rounded-full px-2.5 text-[12px] transition-colors', sort === s ? 'bg-background-lite font-medium text-primary' : 'text-muted hover:text-primary')}
    >
      {label}
    </button>
  )

  return (
    <Modal
      open onClose={onClose} width={720}
      title="排好順序再放進畫布"
      subtitle={replacing ? `第一張會換掉「${replacing}」的截圖，其餘依序接在它後面。` : '第一張就是第一步。拖曳縮圖調整順序，或直接用排序。'}
    >
      <div className="mb-3 flex items-center gap-1">
        {seg('name', '依檔名', () => apply('name'))}
        {seg('time', '依時間', () => apply('time'))}
        <button type="button" onClick={reverse} className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-muted transition-colors hover:text-primary" title="把順序整個倒過來">
          <ArrowLeftRight size={12} /> 反轉
        </button>
      </div>

      <ol className="flex max-h-[52vh] flex-wrap gap-3 overflow-auto p-0.5" onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null) }}>
        {order.map((f, i) => {
          const isOver = over?.index === i
          return (
            <li
              key={`${f.name}-${f.lastModified}-${f.size}`}
              draggable
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                setOver({ index: i, before: e.clientX < r.left + r.width / 2 })
              }}
              onDrop={(e) => { e.preventDefault(); dropAt(i, !!over?.before) }}
              onDragEnd={() => { dragFrom.current = null; setOver(null) }}
              className={clsx('group relative w-[120px] cursor-grab select-none rounded-xl border bg-canvas transition-shadow active:cursor-grabbing',
                'border-border hover:shadow-[var(--shadow-card)]')}
            >
              {isOver && <span className={clsx('absolute top-2 bottom-2 w-0.5 rounded bg-accent', over!.before ? '-left-[7px]' : '-right-[7px]')} />}
              <div className="flex h-[150px] items-center justify-center overflow-hidden rounded-t-xl bg-background-lite">
                <img src={urls.get(f)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
              </div>
              <span className="absolute left-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-on-accent">{i + 1}</span>
              <div className="flex h-8 items-center gap-1 px-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={f.name}>{f.name}</span>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-0.5 text-secondary hover:text-primary disabled:opacity-30" title="往前一步"><ChevronLeft size={13} /></button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} className="rounded p-0.5 text-secondary hover:text-primary disabled:opacity-30" title="往後一步"><ChevronRight size={13} /></button>
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-muted" title="關掉的話，只放進畫布，不畫連線">
          <Toggle checked={chain} onChange={setChain} label="依序連成一條流程" />
          依序連成一條流程
        </label>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={confirm}>放入 {order.length} 張</Button>
        </div>
      </div>
    </Modal>
  )
}
