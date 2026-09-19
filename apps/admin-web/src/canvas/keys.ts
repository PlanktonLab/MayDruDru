/**
 * Keyboard ownership for the canvas. A key belongs to the canvas only when
 * nothing else claimed it: not a text field, not a handler that already called
 * preventDefault (menus, the sheet's own editors), never while the step sheet
 * is open, and never while anything is layered over the canvas — a dialog, a
 * confirmation, the layout editor. Those mark themselves `data-overlay`, and
 * while one is up Enter, Delete and Escape belong to it, not to the canvas.
 */

import { isTyping } from '../lib/keys'

export const overlayOpen = () => !!document.querySelector('[data-overlay]')

export const canvasIgnores = (e: Event, blocked: boolean) => blocked || e.defaultPrevented || isTyping(e.target) || overlayOpen()
