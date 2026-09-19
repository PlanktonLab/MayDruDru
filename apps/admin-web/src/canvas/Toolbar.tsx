/**
 * The floating toolbar at the bottom of the canvas — the four things a person
 * does to a flow as a whole: add a step, bring in screenshots, tidy the
 * layout, zoom. Every button carries its shortcut in the tooltip, so the
 * keyboard is discoverable without a cheat sheet.
 */

import { ImagePlus, Maximize2, Minus, Plus, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { MOD } from '../lib/keys'
import { useEditor } from './context'

interface Props { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; /** The guide bar is docked below: float above it. */ raised?: boolean }

export function Toolbar({ zoom, onZoomIn, onZoomOut, onFit, raised }: Props) {
  const ed = useEditor()
  const { editable, scene } = ed
  const btn = 'flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors hover:bg-background-lite disabled:opacity-40 disabled:hover:bg-transparent'
  const icon = 'flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-background-lite hover:text-primary disabled:opacity-40'

  return (
    <div className={clsx('pointer-events-none absolute inset-x-0 z-20 flex justify-center transition-[bottom] duration-200', raised ? 'bottom-[68px]' : 'bottom-4')}>
      <div className="pg-risein pointer-events-auto flex h-11 items-center gap-0.5 rounded-full border border-border bg-canvas/90 px-1.5 backdrop-blur-xl" style={{ boxShadow: 'var(--shadow-float)' }}>
        {editable && (
          <>
            <button type="button" onClick={() => void ed.createStepAt(ed.viewCentre())} className={clsx(btn, 'text-primary')} title="新增一個空白步驟（雙擊畫布空白處）">
              <Plus size={15} /> 新增步驟
            </button>
            <button type="button" onClick={() => ed.pickFiles()} className={clsx(btn, 'text-primary')} title={`選擇截圖檔，每張成為一個步驟（也可以直接拖進畫布或 ${MOD}V 貼上）`}>
              <ImagePlus size={15} /> 上傳截圖
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            <button type="button" onClick={ed.arrange} disabled={scene.steps.length < 2} className={icon} title="整理排列：依流程順序由左到右排好">
              <Sparkles size={15} />
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        <button type="button" onClick={onZoomOut} className={icon} title={`縮小（${MOD} −）`}><Minus size={14} /></button>
        <button type="button" onClick={onFit} className="h-9 min-w-12 rounded-full px-1 text-[12px] tabular-nums text-muted transition-colors hover:bg-background-lite hover:text-primary" title={`縮放至剛好（${MOD} 0）`}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={onZoomIn} className={icon} title={`放大（${MOD} +）`}><Plus size={14} /></button>
        <button type="button" onClick={onFit} className={icon} title={`看整條流程（${MOD} 0）`}><Maximize2 size={13} /></button>
      </div>
    </div>
  )
}
