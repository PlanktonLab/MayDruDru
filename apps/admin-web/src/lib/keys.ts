/** Keyboard helpers shared by every text input and shortcut handler. */

export const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * Enter that means "done", not "pick this candidate". While an IME (注音、倉頡、
 * pinyin…) is composing, Enter confirms the candidate; acting on it would
 * commit the field and the IME would then insert the text a second time.
 * Safari reports the confirming Enter after compositionend with keyCode 229.
 */
export const isComposing = (e: { keyCode: number; nativeEvent: { isComposing: boolean } }) =>
  e.nativeEvent.isComposing || e.keyCode === 229

export const isCommitEnter = (e: { key: string; keyCode: number; nativeEvent: { isComposing: boolean } }) =>
  e.key === 'Enter' && !isComposing(e)

export const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
