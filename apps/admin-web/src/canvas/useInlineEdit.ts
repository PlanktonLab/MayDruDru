/**
 * One behaviour for every inline text edit in the editor (inspector fields,
 * the sheet title, rename-in-place inputs, the connector label):
 *
 *  - a local draft that adopts an outside change while the field is not focused;
 *  - Enter commits (IME-safe: the Enter that picks a candidate is ignored;
 *    multiline fields keep Enter for new lines);
 *  - Escape cancels — the draft is thrown away, nothing is saved;
 *  - blur commits;
 *  - so does unmounting mid-edit: a panel that is replaced (another card gets
 *    selected) takes the focused field with it, and the browser fires no blur
 *    on a removed element, so the edit would be lost without this.
 *
 * `onCommit` only runs when the trimmed value differs from `value` (and is not
 * empty unless `allowEmpty`); every other ending calls `onCancel`.
 */

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { isCommitEnter, isComposing } from '../lib/keys'

interface Options {
  value: string
  onCommit: (v: string) => void
  onCancel?: () => void
  allowEmpty?: boolean
  multiline?: boolean
  /** Focus and select the text on mount (rename-in-place inputs). */
  autoSelect?: boolean
}

type Field = HTMLInputElement | HTMLTextAreaElement

/** Works for both <input> and <textarea>: spread `bind` onto either. */
export function useInlineEdit({
  value, onCommit, onCancel, allowEmpty = false, multiline = false, autoSelect = false,
}: Options) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const [seen, setSeen] = useState(value)
  const cancelled = useRef(false)
  /** `end` already ran for this focus session — do not commit the same edit twice. */
  const ended = useRef(true)
  // Latest values for the unmount commit, which runs outside render.
  const latest = useRef({ draft, value, focused, onCommit, allowEmpty })
  latest.current = { draft, value, focused, onCommit, allowEmpty }

  // Adopt an outside change, but never overwrite what the user is typing.
  if (seen !== value) {
    setSeen(value)
    if (!focused) setDraft(value)
  }

  useEffect(() => {
    if (!autoSelect) return
    ref.current?.focus()
    ref.current?.select()
  }, [autoSelect])

  // Commit a draft the field was still holding when it was taken off screen.
  useEffect(() => () => {
    const l = latest.current
    if (ended.current || cancelled.current || !l.focused) return
    const v = l.draft.trim()
    if ((!v && !l.allowEmpty) || v === l.value) return
    l.onCommit(v)
  }, [])

  const end = () => {
    ended.current = true
    setFocused(false)
    if (cancelled.current) {
      cancelled.current = false
      setDraft(value)
      onCancel?.()
      return
    }
    const v = draft.trim()
    if ((!v && !allowEmpty) || v === value) {
      setDraft(value)
      onCancel?.()
      return
    }
    onCommit(v)
  }

  return {
    ref,
    draft,
    bind: {
      ref,
      value: draft,
      onFocus: () => { ended.current = false; setFocused(true) },
      onChange: (e: ChangeEvent<Field>) => setDraft(e.target.value),
      onBlur: end,
      onKeyDown: (e: KeyboardEvent<Field>) => {
        if (!multiline && isCommitEnter(e)) { e.preventDefault(); e.currentTarget.blur(); return }
        if (e.key === 'Escape' && !isComposing(e)) {
          // Claimed: the sheet / canvas must not also act on this Escape.
          e.preventDefault()
          e.stopPropagation()
          cancelled.current = true
          e.currentTarget.blur()
        }
      },
    },
  }
}
