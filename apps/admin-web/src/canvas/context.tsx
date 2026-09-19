/**
 * Editor context — what the canvas, the bars, the panel and the sheet all
 * need. Provided by CanvasEditor; the viewport itself is passed to the canvas
 * as props because it changes on every frame of a pan.
 */

import { createContext, useContext } from 'react'
import type { CanvasData, Flow, Platform, Theme, Validation } from '../lib/types'
import type { Box, Point } from './geometry'
import type { CanvasActions } from './actions'
import type { FlowScene } from './model'

/** What is selected on the canvas: steps or one connector. */
export type Selection =
  | { kind: 'steps'; ids: string[] }
  | { kind: 'edge'; id: string }
  | null

export const selSteps = (ids: string[]): Selection => (ids.length ? { kind: 'steps', ids } : null)
export const selEdge = (id: string): Selection => ({ kind: 'edge', id })
export const isStepSelected = (s: Selection, id: string) => s?.kind === 'steps' && s.ids.includes(id)

/** Shift+click toggle. */
export function toggleStep(s: Selection, id: string): Selection {
  const base = s?.kind === 'steps' ? s.ids : []
  return selSteps(base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
}

/** The step workspace sheet: one step, one theme, opened over the canvas. */
export interface Workspace { stepId: string; theme: Theme }

/** The dialogs the top bar and menus open. Only one is open at a time. */
export type Dialog =
  | { kind: 'platform'; id: string; tab?: 'basics' | 'demo' | 'components' | 'style' }
  | { kind: 'new-platform' }
  | { kind: 'new-flow'; platformId: string }
  | { kind: 'flow'; id: string }
  | { kind: 'goals' }
  | null

/** The check that stopped a publish, with the flow it belongs to. */
export interface PublishFailure { flowId: string; validation: Validation }

export interface EditorCtxValue {
  data: CanvasData
  /** The flow currently open on the canvas (null = nothing opened yet). */
  flow: Flow | null
  platform: Platform | null
  scene: FlowScene
  openFlow: (id: string) => void
  selection: Selection
  setSelection: (s: Selection) => void
  selectAll: () => void
  editable: boolean
  canReview: boolean
  isAdmin: boolean
  actions: CanvasActions
  /** Commit a finished drag (ids + world delta): apply locally, queue the silent save. */
  commitMove: (ids: string[], dx: number, dy: number) => void
  /** Move steps to absolute positions (整理排列). */
  setPositions: (moves: { id: string; x: number; y: number }[]) => void
  /** Pan/zoom so a box sits centred — used by the publish popover. */
  focusBox: (box: Box) => void
  /** Id of a step created a moment ago (plays the pop-in animation). */
  justAdded: string | null
  /** Steps whose screenshot is still being uploaded (card shows a spinner). */
  uploading: ReadonlySet<string>
  /** Local object URLs of screenshots dropped this session (instant card preview). */
  previews: ReadonlyMap<string, string>
  /** A card drag is in progress (floating chrome hides). */
  dragging: boolean

  /* ---- editing verbs (every entry point — menu, key, handle, drop — calls the same one) */
  createStepAt: (p: Point, connectFrom?: string) => Promise<void>
  appendAfter: (fromId: string) => void
  connect: (fromId: string, toId: string) => void
  renameStep: (id: string, title: string) => void
  setEndpoint: (id: string, which: 'start' | 'end', value: boolean) => void
  /** Set 起點 / 終點 from the connections (see structure.ts); toasts when the graph is ambiguous. */
  autoEndpoints: () => void
  deleteSelection: () => void
  deleteSteps: (ids: string[]) => void
  deleteEdge: (id: string) => void
  /** Lay the flow out left-to-right from its start. */
  arrange: () => void
  /**
   * Image files dropped / pasted / picked. With `targetStepId` the first file
   * replaces that step's light screenshot and the rest become new steps chained
   * after it; otherwise each file becomes a new step at `at` (laid out in a row
   * and chained). Nothing opens by itself, except the sheet after a single file
   * lands on a card.
   */
  importFiles: (files: File[], at: Point, targetStepId?: string) => Promise<void>
  /** Open the OS file picker: for one step, or for new steps at the view centre. */
  pickFiles: (stepId?: string) => void
  /** World point at the centre of the visible canvas. */
  viewCentre: () => Point

  /* ---- publish (the top bar's button and the guide bar share one path) */
  /** Validate, then publish; a failed check lands in `publishFailed` for the popover. */
  publish: () => void
  publishing: boolean
  publishFailed: PublishFailure | null
  dismissPublishFailed: () => void

  /* ---- workspace sheet */
  workspace: Workspace | null
  openWorkspace: (stepId: string, theme?: Theme) => void
  closeWorkspace: () => void

  /* ---- dialogs */
  dialog: Dialog
  openDialog: (d: Dialog) => void
}

export const EditorCtx = createContext<EditorCtxValue>(null!)
export const useEditor = () => useContext(EditorCtx)
