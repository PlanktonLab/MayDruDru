/**
 * The canvas surface: one flow's steps and connectors on a dotted grid.
 *
 * Panning never touches React — the world transform is written directly in a
 * rAF, and state is updated once on mouse-up. Node dragging does go through
 * state (a handful of cards, cheap) and is committed to the layout saver when
 * the mouse is released.
 *
 * Input model: drag empty space = pan, wheel = zoom at cursor, Shift+drag on
 * empty space = marquee select, click a card = select (Shift toggles), click
 * the "+" handle = append, drag it = connect. Selecting a card lights its
 * connectors; nothing else on the canvas changes, so the eye is never pulled
 * away from what was picked.
 *
 * Files from the desktop can be dropped anywhere — on a card they become its
 * screenshot, on empty space they become new steps (see importFiles). A right
 * click on a card, a connector or the empty canvas opens a menu with everything
 * that can be done to it; the selected card also gets a floating bar with the
 * main actions, so the menu is a convenience rather than the only way.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react'
import { ArrowRight, ImagePlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { boxContains, screenToWorld, type Box, type Point, type Viewport } from './geometry'
import { dropPos, GRID, STEP_H, STEP_W, type DragDelta } from './model'
import { EdgeChips, EdgeLayer, type ConnectState } from './EdgeLayer'
import { StepCard } from './StepCard'
import { SelectionBar, type BarAction } from './SelectionBar'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { isStepSelected, selEdge, selSteps, toggleStep, useEditor } from './context'
import { MOD } from '../lib/keys'
import { canvasIgnores } from './keys'
import { cardInfo, themeHasWork } from './status'

interface Props {
  view: Viewport
  setView: Dispatch<SetStateAction<Viewport>>
  zoomAt: (cx: number, cy: number, factor: number) => void
  /** Live drag offset, lifted so the editor can build the scene with it. */
  setDrag: (d: DragDelta | null) => void
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; z: number; liveX: number; liveY: number; moved: boolean }
  | { kind: 'move'; sx: number; sy: number; z: number; ids: Set<string>; moved: boolean; last: DragDelta }
  | { kind: 'handle'; fromId: string; sx: number; sy: number; moved: boolean; targetId: string | null }
  | { kind: 'marquee'; sx: number; sy: number; additive: boolean }

/** Files being dragged over the canvas: the ghost card follows the cursor, or a card lights up. */
interface FileHover { at: Point; targetId: string | null; count: number }

/** Screen-space (viewport-local) rectangle from two corners. */
const rectOf = (a: Point, b: Point): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

const GRID_MARGIN = 4000
/** Where the very first screenshot lands (also where the invitation card sits). */
const FIRST_SPOT: Point = { x: 0, y: 0 }

export function FlowCanvas({ view, setView, zoomAt, setDrag }: Props) {
  const ed = useEditor()
  const goalNames = useMemo(() => new Map(ed.data.goals.map((g) => [g.id, g.name])), [ed.data.goals])
  const { scene, selection, setSelection, editable } = ed

  const [connect, setConnect] = useState<ConnectState | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [fileHover, setFileHover] = useState<FileHover | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const menu = useContextMenu()

  const drag = useRef<Drag | null>(null)
  const spaceRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const panFrame = useRef<number | null>(null)
  const pendingPan = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const dragDepth = useRef(0)

  // "latest" refs so the window-level handlers never read stale closures.
  const overlayOpen = !!ed.workspace || !!ed.dialog
  const latest = useRef({ view, selection, scene, setSelection, commitMove: ed.commitMove, connect: ed.connect, appendAfter: ed.appendAfter, overlayOpen })
  latest.current = { view, selection, scene, setSelection, commitMove: ed.commitMove, connect: ed.connect, appendAfter: ed.appendAfter, overlayOpen }

  const toLocal = useCallback((cx: number, cy: number): Point => {
    const r = viewportRef.current?.getBoundingClientRect()
    return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) }
  }, [])
  const toWorld = useCallback((cx: number, cy: number) => screenToWorld(toLocal(cx, cy), latest.current.view), [toLocal])
  const hitStep = useCallback((p: Point) => latest.current.scene.steps.find((s) => boxContains(s.box, p)) ?? null, [])

  /* --------------------------------------------------- world transform */
  useLayoutEffect(() => {
    if (worldRef.current) worldRef.current.style.transform = `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`
  }, [view])

  /* --------------------------------------------------- space = pan tool */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || canvasIgnores(e, latest.current.overlayOpen) || spaceRef.current) return
      e.preventDefault()
      spaceRef.current = true
      setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  /* --------------------------------------------------- global drag loop */
  useEffect(() => {
    const flushPan = () => {
      panFrame.current = null
      const p = pendingPan.current
      pendingPan.current = null
      if (p && worldRef.current) worldRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.zoom})`
    }
    const queuePan = (x: number, y: number, zoom: number) => {
      pendingPan.current = { x, y, zoom }
      if (panFrame.current === null) panFrame.current = window.requestAnimationFrame(flushPan)
    }

    const onMove = (e: globalThis.MouseEvent) => {
      const d = drag.current
      if (!d) return
      if (d.kind === 'pan') {
        d.liveX = d.ox + (e.clientX - d.sx)
        d.liveY = d.oy + (e.clientY - d.sy)
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true
        queuePan(d.liveX, d.liveY, d.z)
      } else if (d.kind === 'marquee') {
        setMarquee(rectOf(toLocal(d.sx, d.sy), toLocal(e.clientX, e.clientY)))
      } else if (d.kind === 'move') {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return
        d.moved = true
        d.last = { ids: d.ids, dx: (e.clientX - d.sx) / d.z, dy: (e.clientY - d.sy) / d.z }
        setDrag(d.last)
      } else {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
        d.moved = true
        const p = toWorld(e.clientX, e.clientY)
        const hit = latest.current.scene.steps.find((s) => s.id !== d.fromId && boxContains(s.box, p))
        d.targetId = hit?.id ?? null
        setConnect({ fromId: d.fromId, to: p, targetId: d.targetId })
      }
    }

    const onUp = () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      const L = latest.current
      if (d.kind === 'pan') {
        if (panFrame.current !== null) { window.cancelAnimationFrame(panFrame.current); panFrame.current = null }
        pendingPan.current = null
        if (d.moved) {
          if (worldRef.current) worldRef.current.style.transform = `translate(${d.liveX}px, ${d.liveY}px) scale(${d.z})`
          setView((v) => ({ ...v, pan: { x: d.liveX, y: d.liveY } })) // the only pan update React sees
        } else L.setSelection(null)
      } else if (d.kind === 'marquee') {
        setMarquee((r) => {
          if (r && (r.w > 3 || r.h > 3)) {
            const v = L.view
            const world: Box = { x: (r.x - v.pan.x) / v.zoom, y: (r.y - v.pan.y) / v.zoom, w: r.w / v.zoom, h: r.h / v.zoom }
            const hit = L.scene.steps.filter((n) => intersects(n.box, world)).map((n) => n.id)
            const prev = d.additive && L.selection?.kind === 'steps' ? L.selection.ids : []
            L.setSelection(selSteps([...new Set([...prev, ...hit])]))
          }
          return null
        })
      } else if (d.kind === 'move') {
        if (d.moved) L.commitMove([...d.ids], d.last.dx, d.last.dy)
        setDrag(null)
      } else {
        if (!d.moved) L.appendAfter(d.fromId)
        else if (d.targetId) L.connect(d.fromId, d.targetId)
        setConnect(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (panFrame.current !== null) window.cancelAnimationFrame(panFrame.current)
    }
  }, [setView, setDrag, toWorld, toLocal])

  /* --------------------------------------------------- wheel: zoom / pan */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toLocal(e.clientX, e.clientY)
      zoomAt(p.x, p.y, e.deltaY > 0 ? 0.9 : 1.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, toLocal])

  /* --------------------------------------------------- mouse-down entries */
  const startPan = useCallback((e: ReactMouseEvent) => {
    const v = latest.current.view
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: v.pan.x, oy: v.pan.y, z: v.zoom, liveX: v.pan.x, liveY: v.pan.y, moved: false }
  }, [])

  const onSurfaceDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return
    if (e.shiftKey && !spaceRef.current) {
      drag.current = { kind: 'marquee', sx: e.clientX, sy: e.clientY, additive: true }
      setMarquee(rectOf(toLocal(e.clientX, e.clientY), toLocal(e.clientX, e.clientY)))
      return
    }
    startPan(e)
  }, [startPan, toLocal])

  const onSurfaceDoubleClick = useCallback((e: ReactMouseEvent) => {
    if (!editable || e.target !== e.currentTarget) return
    void ed.createStepAt(dropPos(toWorld(e.clientX, e.clientY)))
  }, [editable, ed, toWorld])

  const onCardDown = useCallback((e: ReactMouseEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (spaceRef.current) { startPan(e); return }
    const { selection: sel, setSelection: set, view: v } = latest.current
    if (e.shiftKey) { set(toggleStep(sel, id)); return }
    const already = isStepSelected(sel, id)
    const ids = already && sel?.kind === 'steps' ? sel.ids : [id]
    if (!already) set(selSteps([id]))
    if (!editable) return
    drag.current = { kind: 'move', sx: e.clientX, sy: e.clientY, z: v.zoom, ids: new Set(ids), moved: false, last: { ids: new Set(ids), dx: 0, dy: 0 } }
  }, [editable, startPan])

  const onHandleDown = useCallback((e: ReactMouseEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind: 'handle', fromId: id, sx: e.clientX, sy: e.clientY, moved: false, targetId: null }
  }, [])

  const onEdgeDown = useCallback((e: ReactMouseEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    latest.current.setSelection(selEdge(id))
  }, [])

  /* --------------------------------------------------- menus */
  /** Bounding box of the steps still on the canvas; null when none of them are. */
  const unionOf = useCallback((ids: string[]): Box | null => {
    const boxes = ids.map((i) => scene.byId.get(i)?.box).filter((b): b is Box => !!b)
    if (!boxes.length) return null
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
  }, [scene.byId])

  /** Everything that can be done to one step — the「⋯」and the right-click share it. */
  const stepItems = useCallback((id: string): MenuItem[] => {
    const step = scene.byId.get(id)?.step
    if (!step) return []
    const uploaded = themeHasWork(step, 'light')
    return [
      { label: '開啟', shortcut: '↩', onSelect: () => ed.openWorkspace(id, 'light') },
      { label: uploaded ? '換一張截圖…' : '上傳截圖…', disabled: !editable, onSelect: () => ed.pickFiles(id) },
      ...(themeHasWork(step, 'dark')
        ? [{ label: '開啟深色版本', onSelect: () => ed.openWorkspace(id, 'dark') }]
        : [{ label: '新增深色版本…', disabled: !editable, onSelect: () => ed.openWorkspace(id, 'dark') }]),
      'separator',
      { label: '新增下一步', disabled: !editable, onSelect: () => ed.appendAfter(id) },
      { label: '重新命名', disabled: !editable, onSelect: () => setRenaming(id) },
      { label: step.is_start ? '取消起點' : '設為起點', disabled: !editable, onSelect: () => ed.setEndpoint(id, 'start', !step.is_start) },
      { label: step.is_end ? '取消終點' : '設為終點', disabled: !editable, onSelect: () => ed.setEndpoint(id, 'end', !step.is_end) },
      'separator',
      { label: '刪除步驟', shortcut: '⌫', danger: true, disabled: !editable, onSelect: () => ed.deleteSteps([id]) },
    ]
  }, [ed, editable, scene.byId])

  const stepMenu = useCallback((e: ReactMouseEvent, id: string) => {
    const sel = latest.current.selection
    const ids = isStepSelected(sel, id) && sel?.kind === 'steps' ? sel.ids : [id]
    if (ids.length === 1) setSelection(selSteps([id]))
    const items: MenuItem[] = ids.length > 1
      ? [
        { label: '縮放至所選', onSelect: () => { const b = unionOf(ids); if (b) ed.focusBox(b) } },
        'separator',
        { label: `刪除 ${ids.length} 個步驟`, shortcut: '⌫', danger: true, disabled: !editable, onSelect: () => ed.deleteSteps(ids) },
      ]
      : stepItems(id)
    menu.open(e, items)
  }, [ed, editable, menu, setSelection, unionOf, stepItems])

  const edgeMenu = useCallback((e: ReactMouseEvent, id: string) => {
    setSelection(selEdge(id))
    menu.open(e, [
      { label: '刪除連線', shortcut: '⌫', danger: true, disabled: !editable, onSelect: () => ed.deleteEdge(id) },
    ])
  }, [ed, editable, menu, setSelection])

  const surfaceMenu = useCallback((e: ReactMouseEvent) => {
    const p = dropPos(toWorld(e.clientX, e.clientY))
    menu.open(e, [
      { label: '在這裡新增步驟', shortcut: '雙擊', disabled: !editable, onSelect: () => void ed.createStepAt(p) },
      { label: '上傳截圖…', disabled: !editable, onSelect: () => ed.pickFiles() },
      'separator',
      { label: '整理排列', disabled: !editable || scene.steps.length < 2, onSelect: ed.arrange },
      { label: '全選', shortcut: `${MOD}A`, disabled: !scene.steps.length, onSelect: ed.selectAll },
      { label: '縮放至剛好', shortcut: `${MOD}0`, disabled: !scene.steps.length, onSelect: () => ed.focusBox(scene.bounds) },
    ])
  }, [ed, editable, menu, scene, toWorld])

  /* --------------------------------------------------- files from the desktop */
  const onDragEnter = useCallback((e: DragEvent) => {
    if (!editable || !hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
  }, [editable])

  const onDragOver = useCallback((e: DragEvent) => {
    if (!editable || !hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const p = toWorld(e.clientX, e.clientY)
    const hit = hitStep(p)
    const count = e.dataTransfer.items?.length || 1
    setFileHover((cur) => {
      const next = { at: p, targetId: hit?.id ?? null, count }
      return cur && cur.targetId === next.targetId && cur.targetId ? cur : next
    })
  }, [editable, toWorld, hitStep])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setFileHover(null)
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setFileHover(null)
    if (!editable) return
    const files = Array.from(e.dataTransfer.files)
    const p = toWorld(e.clientX, e.clientY)
    const hit = hitStep(p)
    void ed.importFiles(files, hit ? p : scene.steps.length ? dropPos(p) : FIRST_SPOT, hit?.id)
  }, [editable, ed, toWorld, hitStep, scene.steps.length])

  /* --------------------------------------------------- render */
  const b = scene.bounds
  const grid = useMemo(() => ({
    x: Math.floor((b.x - GRID_MARGIN) / GRID) * GRID,
    y: Math.floor((b.y - GRID_MARGIN) / GRID) * GRID,
    w: Math.ceil((b.w + GRID_MARGIN * 2) / GRID) * GRID,
    h: Math.ceil((b.h + GRID_MARGIN * 2) / GRID) * GRID,
  }), [b.x, b.y, b.w, b.h])

  const selectedEdge = selection?.kind === 'edge' ? selection.id : null
  const single = selection?.kind === 'steps' && selection.ids.length === 1 ? scene.byId.get(selection.ids[0]) ?? null : null
  // Connectors of the selected card light up; nothing dims.
  const lit = useMemo(() => {
    if (!single) return undefined
    return new Set(scene.edges.filter((e) => e.edge.from_step_id === single.id || e.edge.to_step_id === single.id).map((e) => e.id))
  }, [single, scene.edges])
  const ghost = fileHover && !fileHover.targetId ? { ...(scene.steps.length ? dropPos(fileHover.at) : FIRST_SPOT), count: fileHover.count } : null
  // The bar needs a box to sit on. A selected id can outlive its step for one
  // render (a poll drops a step someone else deleted; the editor clears the
  // selection in an effect afterwards), so ask the scene, never assume.
  const barBox: Box | null = selection?.kind !== 'steps' ? null
    : selection.ids.length > 1 ? unionOf(selection.ids)
      : single?.box ?? null
  const showBar = !ed.dragging && !connect && !marquee && !fileHover && !renaming && !!barBox

  const barActions = (): BarAction[] => {
    if (!selection || selection.kind !== 'steps') return []
    if (selection.ids.length > 1) {
      return [
        { label: `已選 ${selection.ids.length} 步`, onClick: () => { const b = unionOf(selection.ids); if (b) ed.focusBox(b) }, title: '縮放至所選' },
        ...(editable ? [{ icon: <Trash2 size={13} />, danger: true, title: '刪除所選（⌫）', onClick: () => ed.deleteSteps(selection.ids) }] : []),
      ]
    }
    const id = selection.ids[0]
    const step = scene.byId.get(id)?.step
    if (!step) return []
    const info = cardInfo(step)
    const open: BarAction = { icon: <ArrowRight size={13} />, label: info.action ?? '開啟', title: '開啟截圖工作區（↩）', onClick: () => ed.openWorkspace(id, 'light') }
    if (!editable) return [open]
    return [
      open,
      { icon: <ImagePlus size={13} />, title: themeHasWork(step, 'light') ? '換一張截圖' : '上傳截圖', onClick: () => ed.pickFiles(id) },
      { icon: <Pencil size={13} />, title: '重新命名', onClick: () => setRenaming(id) },
      { icon: <Plus size={13} />, title: '新增下一步', onClick: () => ed.appendAfter(id) },
      { icon: <MoreHorizontal size={13} />, title: '更多', onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open({ clientX: r.left, clientY: r.bottom + 6 }, stepItems(id)) } },
    ]
  }

  return (
    <div
      ref={viewportRef}
      data-surface="1"
      onMouseDown={onSurfaceDown}
      onDoubleClick={onSurfaceDoubleClick}
      onContextMenu={surfaceMenu}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="select-none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--background)', cursor: spaceDown ? 'grab' : 'default' }}
    >
      <div ref={worldRef} style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', pointerEvents: 'none' }}>
        <div
          data-surface="1"
          style={{
            position: 'absolute', left: grid.x, top: grid.y, width: grid.w, height: grid.h,
            backgroundImage: 'radial-gradient(circle, var(--pg-grid) 1px, transparent 1px)', backgroundSize: `${GRID}px ${GRID}px`, opacity: 0.5,
          }}
        />

        <EdgeLayer scene={scene} selectedId={selectedEdge} hoveredId={hoveredEdge} connect={connect} lit={lit} onEdgeDown={onEdgeDown} onEdgeMenu={edgeMenu} onHover={setHoveredEdge} />

        {scene.steps.map((n) => (
          <StepCard
            key={n.id}
            node={n}
            goalName={n.step.is_end ? (goalNames.get(n.step.goal_id ?? '') ?? null) : undefined}
            selected={isStepSelected(selection, n.id)}
            dropTarget={connect?.targetId === n.id}
            fileTarget={fileHover?.targetId === n.id}
            editable={editable}
            justAdded={ed.justAdded === n.id}
            uploading={ed.uploading.has(n.id)}
            preview={ed.previews.get(n.id) ?? null}
            renaming={renaming === n.id}
            onMouseDown={(e) => onCardDown(e, n.id)}
            onDoubleClick={(e) => { e.stopPropagation(); if (renaming !== n.id) ed.openWorkspace(n.id, 'light') }}
            onContextMenu={(e) => stepMenu(e, n.id)}
            onHover={() => {}}
            onHandleDown={(e) => onHandleDown(e, n.id)}
            onRenameStart={() => setRenaming(n.id)}
            onRenameEnd={(title) => { setRenaming(null); if (title) ed.renameStep(n.id, title) }}
            onAction={() => ed.openWorkspace(n.id, 'light')}
          />
        ))}

        <EdgeChips
          goalNames={goalNames}
          scene={scene} selectedId={selectedEdge} hoveredId={hoveredEdge} editable={editable}
          onHover={setHoveredEdge}
          onSelect={(id) => setSelection(selEdge(id))}
          onLabel={(id, label) => { void ed.actions.patchEdge(id, { condition_label: label }) }}
          onDelete={(id) => ed.deleteEdge(id)}
        />

        {showBar && barBox && <SelectionBar box={barBox} zoom={view.zoom} actions={barActions()} />}

        {ghost && (
          <div
            className="pg-fadein flex flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl border-2 border-dashed border-accent bg-accent-bg text-[12px] font-medium text-accent"
            style={{ position: 'absolute', left: ghost.x, top: ghost.y, width: STEP_W, height: STEP_H }}
          >
            {ghost.count > 1 ? `${ghost.count} 個新步驟` : '新步驟'}
            {ghost.count > 1 && <span className="text-[11px] font-normal opacity-80">依序連成一列</span>}
          </div>
        )}

        {editable && !scene.steps.length && !ghost && <FirstStep />}
      </div>

      {marquee && (
        <div
          style={{ position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
                   border: '1px solid var(--accent)', background: 'var(--accent-bg)', pointerEvents: 'none' }}
        />
      )}

      {menu.menu && <ContextMenu menu={menu.menu} onClose={menu.close} />}
    </div>
  )
}

/**
 * The invitation on an empty flow: a real card-shaped drop target where the
 * first step will appear, with the one alternative (a file picker) inside it.
 */
function FirstStep() {
  const ed = useEditor()
  return (
    <div
      className="pg-fadein flex flex-col items-center justify-center gap-2 whitespace-nowrap rounded-xl border-2 border-dashed border-tertiary bg-canvas/60 text-center"
      style={{ position: 'absolute', left: FIRST_SPOT.x, top: FIRST_SPOT.y, width: STEP_W, height: STEP_H, pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ImagePlus size={22} strokeWidth={1.5} className="text-secondary" />
      <div className="text-[13px] font-medium text-primary">把截圖拖進來</div>
      <button type="button" onClick={() => ed.pickFiles()} className="text-[12px] text-accent hover:underline underline-offset-4">或選擇檔案</button>
    </div>
  )
}
