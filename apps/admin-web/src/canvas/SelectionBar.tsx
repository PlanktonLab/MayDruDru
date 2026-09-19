/**
 * The bar that floats above the selected card(s). It carries the two or three
 * things a person does next and a「⋯」for the rest, so the main actions are
 * visible on the canvas itself instead of hidden behind a right-click.
 *
 * It lives inside the world layer (so it pans with the canvas at 60fps) and
 * is counter-scaled, so it stays the same size at every zoom.
 */

import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import type { Box } from './geometry'

export interface BarAction { icon?: ReactNode; label?: string; title?: string; danger?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }

export function SelectionBar({ box, zoom, actions }: { box: Box; zoom: number; actions: BarAction[] }) {
  const s = 1 / zoom
  return (
    <div
      className="absolute whitespace-nowrap"
      // The world layer has no width, so an absolute child would shrink to its
      // min-content and wrap CJK text one character per line: size to content.
      style={{ left: box.x + box.w / 2, top: box.y - 10 * s, width: 'max-content', transform: `translate(-50%, -100%) scale(${s})`, transformOrigin: 'bottom center', pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="pg-dropin flex h-8 items-center gap-0.5 rounded-full border border-border bg-canvas/95 px-1 backdrop-blur-xl" style={{ boxShadow: 'var(--shadow-menu)' }}>
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            title={a.title}
            onClick={a.onClick}
            className={clsx('flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full text-[12px] transition-colors',
              a.label ? 'px-2' : 'w-6 justify-center',
              a.danger ? 'text-danger hover:bg-danger-bg' : 'text-primary hover:bg-background-lite')}
          >
            {a.icon}{a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
