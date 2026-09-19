/**
 * Connectors: smooth beziers with a small arrowhead, plus the live preview
 * while dragging a new one.
 *
 * The <svg> is pointer-transparent; only an invisible wide stroke under each
 * curve takes clicks, so panning still works everywhere else. The midpoint
 * chip (condition label / delete) is plain HTML positioned in world
 * coordinates — see `EdgeChips` — because it contains an inline text input.
 */

import { useEffect, useState, type MouseEvent } from 'react'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { pathToPoint, type Point } from './geometry'
import type { EdgeNode, FlowScene } from './model'
import { useInlineEdit } from './useInlineEdit'

export interface ConnectState { fromId: string; to: Point; targetId: string | null }

const MARGIN = 1200

interface LayerProps {
  scene: FlowScene
  selectedId: string | null
  hoveredId: string | null
  connect: ConnectState | null
  /** Connectors of the selected card: drawn in the accent so the neighbours read at a glance. */
  lit?: ReadonlySet<string>
  onEdgeDown: (e: MouseEvent, id: string) => void
  onEdgeMenu: (e: MouseEvent, id: string) => void
  onHover: (id: string | null) => void
}

export function EdgeLayer({ scene, selectedId, hoveredId, connect, lit, onEdgeDown, onEdgeMenu, onHover }: LayerProps) {
  const b = scene.bounds
  const x = b.x - MARGIN, y = b.y - MARGIN, w = b.w + MARGIN * 2, h = b.h + MARGIN * 2
  const source = connect ? scene.byId.get(connect.fromId) : undefined
  const target = connect?.targetId ? scene.byId.get(connect.targetId) : undefined

  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} style={{ position: 'absolute', left: x, top: y, width: w, height: h, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <Arrow id="sop-arrow" color="var(--secondary)" />
        <Arrow id="sop-arrow-on" color="var(--accent)" />
      </defs>
      {scene.edges.map((en) => {
        const on = selectedId === en.id || hoveredId === en.id || !!lit?.has(en.id)
        return (
          <g key={en.id}>
            <path
              d={en.path.d} fill="none" stroke="transparent" strokeWidth={18}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseDown={(e) => onEdgeDown(e, en.id)}
              onContextMenu={(e) => onEdgeMenu(e, en.id)}
              onMouseEnter={() => onHover(en.id)}
              onMouseLeave={() => onHover(null)}
            />
            <path d={en.path.d} fill="none" stroke={on ? 'var(--accent)' : 'var(--secondary)'} strokeWidth={on ? 2 : 1.5}
              strokeLinecap="round" markerEnd={on ? 'url(#sop-arrow-on)' : 'url(#sop-arrow)'} />
          </g>
        )
      })}
      {connect && source && (
        <path
          d={pathToPoint(source.box, target ? { x: target.box.x, y: target.box.y + target.box.h / 2 } : connect.to)}
          fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round" strokeDasharray="5 5" markerEnd="url(#sop-arrow-on)"
        />
      )}
    </svg>
  )
}

function Arrow({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} markerUnits="userSpaceOnUse" orient="auto">
      <path d="M0,0.6 L8,4 L0,7.4 Z" fill={color} />
    </marker>
  )
}

/* ------------------------------------------------------------------ chips */

interface ChipsProps {
  scene: FlowScene
  selectedId: string | null
  hoveredId: string | null
  editable: boolean
  /** goal id → name, for the implied label of a branch. */
  goalNames: ReadonlyMap<string, string>
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onLabel: (id: string, label: string) => void
  onDelete: (id: string) => void
}

/**
 * Midpoint chips. A chip is shown for a 分岔 (the source has 2+ outgoing
 * edges, so the label decides which branch a citizen takes), for any edge that
 * already has a label, and while hovering or selecting an edge. An unlabelled
 * branch that leads to one document reads as that document — the fork between
 * 信用卡帳單 and 帳戶餘額 needs no condition, the goal decides it.
 */
export function EdgeChips({ scene, selectedId, hoveredId, editable, goalNames, onHover, onSelect, onLabel, onDelete }: ChipsProps) {
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => { if (editing && !scene.edges.some((e) => e.id === editing)) setEditing(null) }, [scene.edges, editing])

  return (
    <>
      {scene.edges.map((en) => {
        const active = selectedId === en.id || hoveredId === en.id || editing === en.id
        if (!active && !en.edge.condition_label && !en.branch) return null
        const implied = en.goalsBelow.length === 1 ? goalNames.get(en.goalsBelow[0]) ?? null : null
        return (
          <Chip
            key={en.id} node={en} active={active} editing={editing === en.id} editable={editable} implied={implied}
            onHover={onHover} onSelect={onSelect} onDelete={onDelete}
            onEdit={() => editable && setEditing(en.id)}
            onCommit={(v) => { setEditing(null); onLabel(en.id, v) }}
            onCancel={() => setEditing(null)}
          />
        )
      })}
    </>
  )
}

interface ChipProps {
  node: EdgeNode; active: boolean; editing: boolean; editable: boolean
  /** What the branch leads to when it has no label of its own. */
  implied: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit: () => void
  onCommit: (value: string) => void
  onCancel: () => void
}

function Chip({ node, active, editing, editable, implied, onHover, onSelect, onDelete, onEdit, onCommit, onCancel }: ChipProps) {
  const { mid } = node.path
  const label = node.edge.condition_label

  return (
    <div
      className="absolute flex items-center gap-1"
      style={{ left: mid.x, top: mid.y, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onMouseDown={(e) => { e.stopPropagation(); onSelect(node.id) }}
    >
      {editing ? (
        <LabelInput value={label} onCommit={onCommit} onCancel={onCancel} />
      ) : (
        <button
          onClick={onEdit}
          className={clsx('h-5 max-w-[140px] truncate rounded-full border bg-canvas px-2 text-[11px] leading-none',
            active ? 'border-accent text-accent' : 'border-border text-muted',
            label || implied ? '' : 'text-secondary')}
          style={{ cursor: editable ? 'text' : 'default' }}
          title={implied && !label ? `通往「${implied}」；民眾要這份文件時會自動走這邊${editable ? '，點一下可另外寫條件' : ''}` : editable ? '點一下輸入分岔條件' : label}
        >
          {label || (implied ? `→ ${implied}` : node.branch ? '分岔條件' : '＋ 條件')}
        </button>
      )}
      {editable && active && !editing && (
        <button
          onClick={() => onDelete(node.id)}
          title="刪除連線"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-canvas text-muted hover:border-danger hover:text-danger"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function LabelInput({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const { bind } = useInlineEdit({ value, onCommit, onCancel, allowEmpty: true, autoSelect: true })
  return <input {...bind} placeholder="條件" className="h-6 w-28 rounded-full border border-accent bg-canvas px-2.5 text-[11px] outline-none" />
}
