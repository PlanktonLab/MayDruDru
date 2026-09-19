/**
 * Right-click menu, macOS style: a small translucent panel, 28px rows, the
 * accent colour as the highlight, shortcuts right-aligned in a lighter tone.
 *
 * The menu is stateless about *what* it shows — callers build the item list
 * at the moment of the right-click, so every item can close over the exact
 * object under the cursor. `useContextMenu` holds the open/closed state.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { clsx } from 'clsx'
import { Check } from 'lucide-react'

export type MenuItem =
  | { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; /** A radio-style tick on the left (switchers). */ checked?: boolean; onSelect: () => void }
  | 'separator'

export interface MenuState { x: number; y: number; items: MenuItem[] }

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const open = useCallback((e: ReactMouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) => {
    if ('preventDefault' in e) { e.preventDefault(); e.stopPropagation() }
    if (!items.length) return
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return { menu, open, close }
}

const PAD = 8

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const [active, setActive] = useState(-1)
  const enabled = menu.items.map((it, i) => (it !== 'separator' && !it.disabled ? i : -1)).filter((i) => i >= 0)
  const hasChecks = menu.items.some((it) => it !== 'separator' && it.checked !== undefined)

  // Keep the whole panel on screen (flip up / left near the edges).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(PAD, Math.min(menu.x, window.innerWidth - r.width - PAD)),
      y: Math.max(PAD, Math.min(menu.y, window.innerHeight - r.height - PAD)),
    })
  }, [menu])

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    // Capture phase, so the menu sees keys first; every key it handles is
    // claimed (preventDefault + stopPropagation) and never reaches the canvas.
    const claim = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { claim(e); onClose(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        claim(e)
        if (!enabled.length) return
        setActive((a) => {
          const k = enabled.indexOf(a)
          const n = e.key === 'ArrowDown' ? (k + 1) % enabled.length : (k - 1 + enabled.length) % enabled.length
          return enabled[n]
        })
        return
      }
      if (e.key === 'Enter' && active >= 0) {
        claim(e)
        const it = menu.items[active]
        if (it !== 'separator') { onClose(); it.onSelect() }
      }
    }
    const onAway = () => onClose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onAway, { passive: true })
    window.addEventListener('resize', onAway)
    window.addEventListener('blur', onAway)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onAway)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('blur', onAway)
    }
  }, [menu, onClose, active, enabled])

  return (
    <div
      ref={ref}
      role="menu"
      // pointer-events-auto: the menu is mounted wherever its caller lives, and
      // the floating chrome (top bar, toolbar) is a pass-through layer.
      className="pg-menupop pointer-events-auto fixed z-[80] min-w-[188px] select-none rounded-[10px] border border-border bg-canvas/95 p-1 text-[13px] backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y, boxShadow: 'var(--shadow-popover)' }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => setActive(-1)}
    >
      {menu.items.map((it, i) => {
        if (it === 'separator') return <div key={i} className="mx-1 my-1 h-px bg-border" />
        const on = active === i
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => { if (it.disabled) return; onClose(); it.onSelect() }}
            className={clsx(
              'flex h-7 w-full items-center justify-between gap-8 rounded-md px-2.5 text-left transition-colors duration-75',
              it.disabled ? 'text-secondary' : on ? (it.danger ? 'bg-danger text-on-accent' : 'bg-accent text-on-accent') : it.danger ? 'text-danger' : 'text-primary',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {hasChecks && <span className="flex w-3.5 shrink-0 justify-center">{it.checked && <Check size={12} strokeWidth={2.5} />}</span>}
              <span className="truncate">{it.label}</span>
            </span>
            {it.shortcut && <span className={clsx('shrink-0 text-[11px] tabular-nums', on ? 'text-on-accent/70' : 'text-secondary')}>{it.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
