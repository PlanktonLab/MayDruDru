/**
 * Canvas editor — the canvas is the whole screen. Everything else floats on it
 * and appears only when it is needed:
 *
 *  - top left, the platform / flow switcher; top right, 發布;
 *  - bottom centre, the toolbar (add, upload, arrange, zoom);
 *  - a panel on the right while exactly one step is selected;
 *  - a bar above the selected card with its immediate actions;
 *  - the screenshot pipeline as a sheet over the canvas, so the flow stays in view;
 *  - platform, flow and goal settings as dialogs, reached from the switcher.
 *
 * This file owns the editor state: which flow is open, the selection, the
 * local position overrides (optimistic moves waiting for the debounced save),
 * the viewport, the open sheet (mirrored in the URL as ?step=&theme=), the
 * open dialog and the keyboard shortcuts. Every editing verb lives here once
 * and is reached from several places — menu, key, handle, drop, toolbar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LayoutTemplate, Plus, Smartphone } from 'lucide-react'
import type { CanvasData, Theme, Validation } from '../lib/types'
import { useCanvas } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { get, upload } from '../lib/api'
import { Button, EmptyState, Skeleton, confirm, errMsg, useToast } from '../components/ui'
import type { Box, Point } from './geometry'
import { buildScene, freeSpot, GAP_X, nextStepPos, STEP_H, STEP_W, type DragDelta, type Overrides } from './model'
import { hasWork, isBusy, STATUS, variantOf } from './status'
import { canvasIgnores } from './keys'
import { useCanvasView } from './useCanvasView'
import { useLayoutSaver, type FlushedItem } from './useLayoutSaver'
import { useCanvasActions } from './actions'
import { arrangeSteps } from './arrange'
import { suggestEndpoints } from './structure'
import { EditorCtx, selSteps, useEditor, type Dialog, type PublishFailure, type Selection, type Workspace } from './context'
import { FlowCanvas } from './FlowCanvas'
import { TopBar } from './TopBar'
import { Toolbar } from './Toolbar'
import { StepPanel } from './StepPanel'
import { GuideBar } from './GuideBar'
import { ImportDialog } from './ImportDialog'
import { WorkspaceSheet } from './Workspace'
import { Dialogs } from './Dialogs'

const LS_FLOW = 'sop_canvas_flow'

/** A batch of screenshots waiting for the clerk to settle their order. */
interface PendingImport {
  files: File[]
  start: Point
  /** Chain the new steps after this one. */
  from?: string
  /** The first file (in the chosen order) replaces this card's screenshot. */
  replace: { stepId: string; variantId: string; title: string } | null
}

export default function CanvasEditor() {
  const { data, isLoading } = useCanvas()
  if (isLoading || !data) return <LoadingCanvas />
  return <Editor data={data} />
}

/** The shape of the editor while the tenant loads: chrome in place, cards as soft blocks. */
function LoadingCanvas() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-background" aria-busy>
      <Skeleton className="absolute left-4 top-4 h-9 w-64 rounded-full" />
      <Skeleton className="absolute right-4 top-4 h-9 w-20 rounded-full" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-[92px]">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="rounded-xl" style={{ width: STEP_W, height: STEP_H, animationDelay: `${i * 120}ms` }} />)}
      </div>
      <Skeleton className="absolute bottom-4 left-1/2 h-10 w-72 -translate-x-1/2 rounded-full" />
    </div>
  )
}

const isImage = (f: File) => f.type.startsWith('image/')

function Editor({ data }: { data: CanvasData }) {
  const { can } = useAuth()
  const editable = can('edit')
  const toast = useToast()
  const qc = useQueryClient()

  const [params, setParams] = useSearchParams()
  const [openFlowId, setOpenFlowId] = useState<string | null>(() => localStorage.getItem(LS_FLOW))
  const [selection, setSelection] = useState<Selection>(null)
  const [overrides, setOverrides] = useState<Overrides>(() => new Map())
  const [drag, setDrag] = useState<DragDelta | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const [uploading, setUploading] = useState<ReadonlySet<string>>(() => new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishFailed, setPublishFailed] = useState<PublishFailure | null>(null)
  // Local object URLs of screenshots dropped in this session, so a card shows
  // its picture the instant it lands — before the upload has even finished.
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map())
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  useEffect(() => () => { for (const u of previewsRef.current.values()) URL.revokeObjectURL(u) }, [])

  const actions = useCanvasActions()

  /* ------------------------------------------------------------ workspace */
  // The sheet is addressable: /canvas?step=…&theme=… (the review queue links here).
  const wsStepId = params.get('step')
  const wsTheme: Theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const wsStep = wsStepId ? data.steps.find((s) => s.id === wsStepId) ?? null : null
  const workspace = useMemo<Workspace | null>(() => (wsStep ? { stepId: wsStep.id, theme: wsTheme } : null), [wsStep, wsTheme])

  const openWorkspace = useCallback((stepId: string, theme: Theme = 'light') => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('step', stepId); n.set('theme', theme); return n }, { replace: true })
  }, [setParams])
  const closeWorkspace = useCallback(() => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete('step'); n.delete('theme'); return n }, { replace: true })
  }, [setParams])

  /* ------------------------------------------------------------ open flow */
  const flow = data.flows.find((f) => f.id === openFlowId) ?? null
  const flowId = flow?.id ?? null
  const platform = flow ? data.platforms.find((p) => p.id === flow.platform_id) ?? null : null

  // A deep link to a step opens its flow; a stale / deleted id falls back to the first flow.
  useEffect(() => {
    if (wsStep && wsStep.flow_id !== openFlowId) { setOpenFlowId(wsStep.flow_id); localStorage.setItem(LS_FLOW, wsStep.flow_id); return }
    if (flow || !data.flows.length) return
    setOpenFlowId(data.flows[0].id)
  }, [flow, data.flows, wsStep, openFlowId])

  const openFlow = useCallback((id: string) => {
    setOpenFlowId(id)
    setSelection(null)
    closeWorkspace()
    localStorage.setItem(LS_FLOW, id)
  }, [closeWorkspace])

  /* ---------------------------------------------------------------- scene */
  const steps = useMemo(() => data.steps.filter((s) => s.flow_id === flowId), [data.steps, flowId])
  const edges = useMemo(() => data.edges.filter((e) => e.flow_id === flowId), [data.edges, flowId])
  const scene = useMemo(() => buildScene(steps, edges, overrides, drag), [steps, edges, overrides, drag])

  // Drop selection entries that no longer exist (deleted elsewhere, flow switched).
  useEffect(() => {
    if (selection?.kind === 'steps') {
      const alive = selection.ids.filter((id) => scene.byId.has(id))
      if (alive.length !== selection.ids.length) setSelection(selSteps(alive))
    } else if (selection?.kind === 'edge' && !scene.edges.some((e) => e.id === selection.id)) setSelection(null)
  }, [scene, selection])

  /* ------------------------------------------------------------- viewport */
  const areaRef = useRef<HTMLDivElement>(null)
  const { view, setView, zoomAt, zoomIn, zoomOut, fitTo, focusOn } = useCanvasView(
    () => ({ w: areaRef.current?.clientWidth ?? 1, h: areaRef.current?.clientHeight ?? 1 }),
  )
  const fitAll = useCallback(() => fitTo(scene.steps.length ? scene.steps.map((s) => s.box) : [{ x: 0, y: 0, w: STEP_W, h: STEP_H }]), [fitTo, scene.steps])
  const viewCentre = useCallback((): Point => {
    const w = areaRef.current?.clientWidth ?? 0, h = areaRef.current?.clientHeight ?? 0
    return { x: (w / 2 - view.pan.x) / view.zoom - STEP_W / 2, y: (h / 2 - view.pan.y) / view.zoom - STEP_H / 2 }
  }, [view])

  // Frame the flow once, the first time it is opened on screen.
  const fitted = useRef<string | null>(null)
  useEffect(() => {
    if (!flowId || fitted.current === flowId) return
    fitted.current = flowId
    fitAll()
  }, [flowId, fitAll])

  /* --------------------------------------------------------- position save */
  const onFlushed = useCallback((items: FlushedItem[]) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const it of items) {
        const cur = next.get(it.id)
        if (cur && cur.gen <= it.gen) { next.delete(it.id); changed = true }
      }
      return changed ? next : prev
    })
  }, [])
  const saver = useLayoutSaver(onFlushed)

  const setPositions = useCallback((moves: { id: string; x: number; y: number }[]) => {
    if (!moves.length) return
    const gen = saver.enqueue(moves)
    setOverrides((prev) => {
      const next = new Map(prev)
      for (const m of moves) next.set(m.id, { x: m.x, y: m.y, gen })
      return next
    })
  }, [saver])

  /** Resolve the drag against the *base* positions (server value or a pending override). */
  const commitMove = useCallback((ids: string[], dx: number, dy: number) => {
    setPositions(ids.flatMap((id) => {
      const s = steps.find((x) => x.id === id)
      if (!s) return []
      const o = overrides.get(id)
      return [{ id, x: Math.round((o ? o.x : s.canvas_x) + dx), y: Math.round((o ? o.y : s.canvas_y) + dy) }]
    }))
  }, [setPositions, steps, overrides])

  const arrange = useCallback(() => {
    if (!editable || !steps.length) return
    const origin = { x: Math.min(...scene.steps.map((s) => s.box.x)), y: Math.min(...scene.steps.map((s) => s.box.y)) }
    const placed = arrangeSteps(steps, edges, origin)
    setPositions(placed)
    // Frame the new layout once the scene has it.
    window.setTimeout(() => fitTo(placed.map((p) => ({ x: p.x, y: p.y, w: STEP_W, h: STEP_H }))), 0)
  }, [editable, steps, edges, scene.steps, setPositions, fitTo])

  /* ----------------------------------------------------------- create/link */
  const flash = (id: string) => { setJustAdded(id); window.setTimeout(() => setJustAdded((c) => (c === id ? null : c)), 500) }

  /** New edge after the source's existing ones. `edges` may lag a batch that is still creating steps — order is a hint only. */
  const linkFrom = useCallback((fromId: string, toId: string, order?: number) => {
    if (!flow) return Promise.resolve(undefined)
    const sort = order ?? edges.filter((e) => e.from_step_id === fromId).length
    return actions.createEdge({ flow_id: flow.id, from_step_id: fromId, to_step_id: toId, condition_label: '', sort_order: sort })
  }, [flow, edges, actions])

  const createStep = useCallback(async (p: Point, connectFrom?: string, flags: { is_start?: boolean; is_end?: boolean } = {}) => {
    if (!flow || !editable) return null
    const s = await actions.createStep({
      flow_id: flow.id, title: '新步驟', instruction: '', stuck_hint: '',
      canvas_x: p.x, canvas_y: p.y, is_start: flags.is_start ?? !steps.length, is_end: flags.is_end ?? false,
    })
    if (!s) return null
    if (connectFrom) void linkFrom(connectFrom, s.id)
    flash(s.id)
    return s
  }, [flow, editable, actions, linkFrom, steps.length])

  const createStepAt = useCallback(async (p: Point, connectFrom?: string) => {
    const s = await createStep(freeSpot(scene, p), connectFrom)
    if (s) setSelection(selSteps([s.id]))
  }, [createStep, scene])

  const appendAfter = useCallback((fromId: string) => {
    const from = scene.byId.get(fromId)
    if (from) void createStepAt(nextStepPos(scene, from.box), fromId)
  }, [scene, createStepAt])

  const connect = useCallback((fromId: string, toId: string) => {
    if (edges.some((e) => e.from_step_id === fromId && e.to_step_id === toId)) return
    void linkFrom(fromId, toId)
  }, [edges, linkFrom])

  const renameStep = useCallback((id: string, title: string) => {
    const s = steps.find((x) => x.id === id)
    if (!s || !title || title === s.title) return
    void actions.patchStep(id, { title })
  }, [steps, actions])

  const setEndpoint = useCallback((id: string, which: 'start' | 'end', value: boolean) => {
    const s = steps.find((x) => x.id === id)
    if (!s) return
    void actions.patchStep(id, which === 'start' ? { is_start: value } : { is_end: value })
  }, [steps, actions])

  /** Read 起點 / 終點 off the connections (the guide bar's one-click fix). */
  const autoEndpoints = useCallback(async () => {
    if (!editable) return
    const patches = suggestEndpoints(steps, edges)
    if (!patches) { toast('連線還不夠清楚，先把步驟接起來', 'err'); return }
    // Clear old flags first so the server's "one start" rule never fights the new one.
    const clears = patches.filter((p) => p.is_start === false || p.is_end === false)
    const sets = patches.filter((p) => p.is_start === true || p.is_end === true)
    for (const batch of [clears, sets]) {
      await Promise.all(batch.map(({ id, ...body }) => actions.patchStep(id, body)))
    }
  }, [editable, steps, edges, actions, toast])

  /* -------------------------------------------------------------- publish */
  const publish = useCallback(async () => {
    if (!flow || publishing || !can('review')) return
    setPublishing(true)
    setPublishFailed(null)
    try {
      const v = await qc.fetchQuery({ queryKey: ['validate', flow.id], queryFn: () => get<Validation>(`/api/flows/${flow.id}/validate`), staleTime: 0 })
      if (!v.publishable) { setPublishFailed({ flowId: flow.id, validation: v }); return }
      const r = await actions.publishFlow(flow.id)
      if (r) toast('已發布，客服通道現在會用這個版本')
    } catch (e) {
      toast(errMsg(e), 'err')
    } finally {
      setPublishing(false)
    }
  }, [flow, publishing, can, qc, actions, toast])
  const dismissPublishFailed = useCallback(() => setPublishFailed(null), [])

  /* --------------------------------------------------------------- delete */
  const deleteSteps = useCallback(async (ids: string[]) => {
    if (!flow || !editable) return
    const chosen = steps.filter((s) => ids.includes(s.id))
    if (!chosen.length) return
    if (chosen.some(hasWork)) {
      const ok = await confirm({
        title: chosen.length > 1 ? `刪除 ${chosen.length} 個步驟？` : `刪除「${chosen[0].title || '未命名步驟'}」？`,
        body: '截圖、復刻結果與教學圖都會一起刪除，無法復原。',
        action: '刪除', danger: true,
      })
      if (!ok) return
    }
    setSelection(null)
    if (workspace && ids.includes(workspace.stepId)) closeWorkspace()
    void actions.deleteSteps(chosen.map((s) => s.id))
  }, [flow, editable, steps, actions, workspace, closeWorkspace])

  const deleteEdge = useCallback((id: string) => {
    if (!flow || !editable) return
    setSelection((s) => (s?.kind === 'edge' && s.id === id ? null : s))
    void actions.deleteEdge(id)
  }, [flow, editable, actions])

  const deleteSelection = useCallback(() => {
    if (selection?.kind === 'edge') deleteEdge(selection.id)
    else if (selection?.kind === 'steps') void deleteSteps(selection.ids)
  }, [selection, deleteEdge, deleteSteps])

  const selectAll = useCallback(() => setSelection(selSteps(scene.steps.map((s) => s.id))), [scene.steps])

  /* ------------------------------------------------------- screenshots in */
  const markUploading = (id: string, on: boolean) => setUploading((prev) => {
    const next = new Set(prev)
    if (on) next.add(id); else next.delete(id)
    return next
  })

  const setPreview = (stepId: string, url: string | null) => setPreviews((prev) => {
    const next = new Map(prev)
    const old = next.get(stepId)
    if (old && old !== url) URL.revokeObjectURL(old)
    if (url) next.set(stepId, url); else next.delete(stepId)
    return next
  })

  /** Upload one file as a step's light screenshot. The card shows the local copy meanwhile. Resolves to the step id on success. */
  const uploadTo = useCallback(async (stepId: string, variantId: string, file: File) => {
    markUploading(stepId, true)
    setPreview(stepId, URL.createObjectURL(file))
    try {
      await upload(`/api/variants/${variantId}/original`, file)
      void qc.invalidateQueries({ queryKey: ['variant', variantId] })
      return stepId
    } catch (e) {
      toast(`截圖上傳失敗：${errMsg(e)}`, 'err')
      setPreview(stepId, null)
      return null
    } finally {
      markUploading(stepId, false)
    }
  }, [qc, toast])

  /**
   * One new step per file, laid out in a row from `start` and — when `chain`
   * — linked one after another from `from`. Nothing waits for a refetch: each
   * step's upload and its edge start the moment the step exists. The chain's
   * last step becomes the flow's 終點 when the flow had none, or when it was
   * the step the chain continues from (the end moves down the chain).
   */
  const addStepsWithFiles = useCallback(async (files: File[], start: Point, from: string | undefined, chain: boolean) => {
    const created: string[] = []
    const uploads: Promise<string | null>[] = []
    const links: Promise<unknown>[] = []
    const fromStep = from ? steps.find((s) => s.id === from) : undefined
    const moveEnd = chain && (!steps.some((s) => s.is_end) || !!fromStep?.is_end)
    let prev = chain ? from : undefined
    let x = start.x
    for (const [i, file] of files.entries()) {
      const p = freeSpot(scene, { x, y: start.y })
      const last = i === files.length - 1
      const s = await createStep(p, undefined, { is_start: !steps.length && i === 0, is_end: moveEnd && last })
      if (!s) break
      created.push(s.id)
      const v = variantOf(s, 'light')
      if (v) uploads.push(uploadTo(s.id, v.id, file))
      if (prev) links.push(linkFrom(prev, s.id, prev === from ? undefined : 0))
      prev = s.id
      x = p.x + STEP_W + GAP_X
    }
    if (created.length && moveEnd && fromStep?.is_end) links.push(actions.patchStep(fromStep.id, { is_end: false }))
    return { created, uploads, links }
  }, [scene, steps, createStep, uploadTo, linkFrom, actions])

  /** Put an ordered batch on the canvas (after the order dialog, or straight away for one file). */
  const runImport = useCallback(async (files: File[], start: Point, from: string | undefined, chain: boolean, replace: PendingImport['replace']) => {
    const uploads: Promise<string | null>[] = []
    let rest = files
    if (replace) {
      setSelection(selSteps([replace.stepId]))
      uploads.push(uploadTo(replace.stepId, replace.variantId, files[0]))
      rest = files.slice(1)
    }
    const row = await addStepsWithFiles(rest, start, from, chain)
    if (!replace && row.created.length) setSelection(selSteps(row.created))

    const done = (await Promise.all([...uploads, ...row.uploads])).filter((id): id is string => !!id)
    await Promise.all(row.links)
    if (!done.length) return
    // One refetch for the whole batch; once the cards know about their
    // originals, the local previews are released.
    await actions.refreshCanvas()
    for (const id of done) setPreview(id, null)
    // A single screenshot dropped on a card opens it; a batch keeps the clerk dropping.
    if (replace && files.length === 1 && done.includes(replace.stepId)) openWorkspace(replace.stepId, 'light')
  }, [uploadTo, addStepsWithFiles, actions, openWorkspace])

  const importFiles = useCallback(async (files: File[], at: Point, targetStepId?: string) => {
    if (!flow || !editable) return
    const images = files.filter(isImage)
    if (!images.length) { toast('只能放入圖片檔', 'err'); return }

    let start = at
    // Without a target, a row continues from the one selected step (if any).
    let from = selection?.kind === 'steps' && selection.ids.length === 1 ? selection.ids[0] : undefined
    let replace: PendingImport['replace'] = null

    // A fresh flow holds one blank 起點 and nothing else: screenshots dropped
    // anywhere fill it rather than leaving it behind as an orphan.
    const blankStart = steps.length === 1 && !edges.length && steps[0].is_start && !hasWork(steps[0]) ? steps[0] : null
    const target = targetStepId ?? (blankStart?.id)

    // Onto an existing card → the first file replaces its light screenshot,
    // the rest become new steps chained after it.
    if (target) {
      const node = scene.byId.get(target)
      const v = node && variantOf(node.step, 'light')
      if (!node || !v) return
      const title = node.step.title || '這個步驟'
      if (isBusy(v.status)) { toast(`「${title}」正在處理中，完成後才能換截圖`, 'err'); return }
      if (STATUS[v.status].replica) {
        if (!await confirm({ title: `換掉「${title}」的截圖？`, body: '已有的復刻結果與教學圖會作廢，從頭開始。', action: '換截圖', danger: true })) return
      } else if (v.has_original) {
        if (!await confirm({ title: '換掉目前的截圖？', body: '已框的重點會一併清除。', action: '換截圖' })) return
      }
      replace = { stepId: node.id, variantId: v.id, title }
      start = nextStepPos(scene, node.box)
      from = node.id
    }

    // Two or more screenshots: the order is the flow, so the clerk settles it first.
    if (images.length >= 2) { setPending({ files: images, start, from, replace }); return }
    await runImport(images, start, from, true, replace)
  }, [flow, editable, selection, steps, edges, scene, runImport, toast])

  const confirmImport = useCallback((ordered: File[], chain: boolean) => {
    const p = pending
    setPending(null)
    if (p) void runImport(ordered, p.start, p.from, chain, p.replace)
  }, [pending, runImport])

  // Hidden picker: for one card, or for new steps in the middle of the view.
  const fileRef = useRef<HTMLInputElement>(null)
  const pickTarget = useRef<string | null>(null)
  const pickFiles = useCallback((stepId?: string) => {
    pickTarget.current = stepId ?? null
    if (fileRef.current) { fileRef.current.multiple = !stepId; fileRef.current.click() }
  }, [])

  // Paste an image from the clipboard → a new step in the middle of the view.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (canvasIgnores(e, !!workspace || !!dialog) || !areaRef.current) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImage)
      if (!files.length) return
      e.preventDefault()
      void importFiles(files, viewCentre())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [importFiles, viewCentre, workspace, dialog])

  /* ------------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the sheet or a dialog is open it owns the keyboard.
      if (canvasIgnores(e, !!workspace || !!dialog)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === '0') { e.preventDefault(); fitAll(); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return }
      if (mod && e.key === '-') { e.preventDefault(); zoomOut(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return }
      if (e.key === 'Escape') { setSelection(null); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
      if (e.key === 'Enter' && selection?.kind === 'steps' && selection.ids.length === 1) { e.preventDefault(); openWorkspace(selection.ids[0]); return }
      if (e.key.startsWith('Arrow') && selection?.kind === 'steps' && editable) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        commitMove(selection.ids, dx, dy)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitAll, zoomIn, zoomOut, selectAll, deleteSelection, selection, workspace, dialog, openWorkspace, commitMove, editable])

  /* ----------------------------------------------------------------- render */
  const focusBox = useCallback((box: Box) => focusOn(box), [focusOn])
  const openDialog = useCallback((d: Dialog) => setDialog(d), [])

  const ctx = {
    data, flow, platform, scene, openFlow, selection, setSelection, selectAll,
    editable, canReview: can('review'), isAdmin: can('admin'),
    actions,
    commitMove, setPositions, focusBox, justAdded, uploading, previews, dragging: drag !== null,
    createStepAt, appendAfter, connect, renameStep, setEndpoint, autoEndpoints: () => { void autoEndpoints() }, deleteSelection,
    deleteSteps: (ids: string[]) => { void deleteSteps(ids) }, deleteEdge, arrange,
    importFiles, pickFiles, viewCentre,
    publish: () => { void publish() }, publishing, publishFailed, dismissPublishFailed,
    workspace, openWorkspace, closeWorkspace,
    dialog, openDialog,
  }

  const singleStep = selection?.kind === 'steps' && selection.ids.length === 1 ? scene.byId.get(selection.ids[0])?.step ?? null : null
  const guideShown = !!flow && !workspace

  return (
    <EditorCtx.Provider value={ctx}>
      <div ref={areaRef} className="absolute inset-0 overflow-hidden bg-background">
        {flow ? (
          <>
            <FlowCanvas view={view} setView={setView} zoomAt={zoomAt} setDrag={setDrag} />
            <Toolbar zoom={view.zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fitAll} raised={guideShown} />
            {singleStep && !workspace && <StepPanel key={singleStep.id} step={singleStep} />}
            {guideShown && <GuideBar />}
          </>
        ) : (
          <Welcome />
        )}
        <TopBar />

        {workspace && wsStep && <WorkspaceSheet step={wsStep} theme={workspace.theme} />}
        <Dialogs />
        {pending && (
          <ImportDialog
            files={pending.files}
            replacing={pending.replace?.title ?? null}
            onConfirm={confirmImport}
            onClose={() => setPending(null)}
          />
        )}

        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            const target = pickTarget.current
            e.target.value = ''
            pickTarget.current = null
            if (!files.length) return
            void importFiles(files, target ? { x: 0, y: 0 } : viewCentre(), target ?? undefined)
          }}
        />
      </div>
    </EditorCtx.Provider>
  )
}

/** No flow open: one sentence and one button, nothing else on the screen. */
function Welcome() {
  const ed = useEditor()
  const { data, editable } = ed
  const platform = data.platforms[0]
  return (
    <div className="flex h-full items-center justify-center">
      {!data.platforms.length ? (
        <EmptyState
          icon={<Smartphone size={20} />}
          title="先建立一個平台"
          hint="平台是民眾操作的 App 或網站，例如「市民服務 App」。之後的每一條流程都掛在平台底下。"
          action={editable && <Button variant="primary" onClick={() => ed.openDialog({ kind: 'new-platform' })}><Plus size={14} /> 新增平台</Button>}
        />
      ) : (
        <EmptyState
          icon={<LayoutTemplate size={20} />}
          title="建立第一條流程"
          hint={`一條流程是「在 ${platform.display_name} 取得某份文件」的步驟。建立後把截圖拖進畫布就能開始。`}
          action={editable && <Button variant="primary" onClick={() => ed.openDialog({ kind: 'new-flow', platformId: platform.id })}><Plus size={14} /> 新增流程</Button>}
        />
      )}
    </div>
  )
}
