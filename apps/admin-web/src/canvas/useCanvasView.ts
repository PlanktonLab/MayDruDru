/**
 * Viewport hook — owns pan/zoom and the "fit to content" framing. Ported from
 * ChillJudge; the difference is that sizes come from the canvas area element
 * (not the window) because the editor shares the screen with a side panel.
 */

import { useCallback, useRef, useState } from 'react'
import { clampZoom, fitView, focusView, type Box, type Viewport } from './geometry'

export interface Size { w: number; h: number }

export function useCanvasView(getSize: () => Size) {
  const sizeRef = useRef(getSize)
  sizeRef.current = getSize

  const [view, setView] = useState<Viewport>({ pan: { x: 60, y: 60 }, zoom: 1 })

  /** Zoom around a point given in viewport-relative screen pixels. */
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const z = v.zoom
      const nz = clampZoom(z * factor)
      const wx = (cx - v.pan.x) / z
      const wy = (cy - v.pan.y) / z
      return { zoom: nz, pan: { x: cx - wx * nz, y: cy - wy * nz } }
    })
  }, [])

  const zoomIn = useCallback(() => { const s = sizeRef.current(); zoomAt(s.w / 2, s.h / 2, 1.15) }, [zoomAt])
  const zoomOut = useCallback(() => { const s = sizeRef.current(); zoomAt(s.w / 2, s.h / 2, 0.87) }, [zoomAt])

  /** Frame all given boxes. */
  const fitTo = useCallback((boxes: Box[]) => { const s = sizeRef.current(); setView(fitView(boxes, s.w, s.h)) }, [])

  /** Pan/zoom so a single box sits centred in the visible area. */
  const focusOn = useCallback((box: Box) => {
    const s = sizeRef.current()
    setView((v) => focusView(box, s.w, s.h, v.zoom))
  }, [])

  return { view, setView, zoomAt, zoomIn, zoomOut, fitTo, focusOn }
}
