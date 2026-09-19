/**
 * A messaging-app transcript and composer, nothing else: text bubbles, image
 * bubbles, a question with tappable answers, a typing indicator. Screenshots
 * come in by paste, drop or the attach button. Pure presentation — no auth /
 * API imports — so it can become the public web widget later (SPEC §10).
 */
import { clsx } from 'clsx'
import { ImagePlus, SendHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { isCommitEnter } from '../../lib/keys'
import { useDismiss } from '../ui'
import type { ChatItem, Outgoing } from './types'

interface ChatRoomProps {
  items: ChatItem[]
  /** A turn is in flight (or still being revealed): typing indicator, composer locked. */
  busy: boolean
  /** No chat yet (creating one, or it failed). */
  disabled?: boolean
  onSend: (m: Outgoing) => void
  /** Clicking an assistant bubble selects its turn (for the inspector). */
  selectedTurnId?: string | null
  onSelectTurn?: (turnId: string) => void
}

const pickImage = (files: FileList | File[] | null | undefined): File | null => {
  for (const f of Array.from(files ?? [])) if (f.type.startsWith('image/')) return f
  return null
}

export default function ChatRoom({ items, busy, disabled, onSend, selectedTurnId, onSelectTurn }: ChatRoomProps) {
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<{ file: File; url: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const zoomRef = useRef<HTMLImageElement>(null)
  useDismiss(!!zoom, () => setZoom(null), zoomRef)

  // one object URL per attachment; the previous one is revoked when it is replaced, cleared or sent
  const setFile = useCallback((f: File | null) => {
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return f ? { file: f, url: URL.createObjectURL(f) } : null
    })
  }, [])
  useEffect(() => () => setAttachment((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null }), [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items.length, busy])

  // the textarea grows with the draft, up to a few lines
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const locked = busy || !!disabled
  const file = attachment?.file ?? null
  const canSend = !locked && (!!text.trim() || !!file)
  const send = () => {
    if (!canSend) return
    onSend({ text: text.trim(), file })
    setText('')
    setFile(null)
    inputRef.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCommitEnter(e) && !e.shiftKey) { e.preventDefault(); send() }
  }
  /** Tapping an answer is the same as typing it. */
  const pick = (label: string) => {
    if (locked) return
    onSend({ text: label, file: null })
  }
  const onPaste = (e: ClipboardEvent) => {
    const f = pickImage(e.clipboardData?.files)
    if (f) { e.preventDefault(); setFile(f) }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = pickImage(e.dataTransfer?.files)
    if (f && !locked) setFile(f)
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-background text-primary"
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-6">
          {items.map((m, i) => <Bubble key={m.id} item={m} first={items[i - 1]?.role !== m.role} onZoom={setZoom} onPick={pick} picksLocked={locked}
            selected={!!m.turnId && m.turnId === selectedTurnId} onSelect={onSelectTurn} />)}
          {busy && (
            <div className="flex justify-start pg-risein">
              <div className="flex h-9 items-center gap-1 rounded-2xl rounded-tl-sm bg-canvas px-3.5" style={{ boxShadow: 'var(--shadow-card)' }} aria-label="回應中">
                {[0, 1, 2].map((i) => <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-1">
        <div className={clsx('mx-auto w-full max-w-2xl rounded-2xl border bg-canvas transition-colors', dragging ? 'border-accent' : 'border-border')} style={{ boxShadow: 'var(--shadow-card)' }}>
          {attachment && (
            <div className="flex items-center gap-2 px-3 pt-3">
              <div className="relative">
                <img src={attachment.url} alt="待傳送的截圖" className="h-16 w-16 rounded-lg border border-border object-cover" />
                <button type="button" onClick={() => setFile(null)} title="移除" aria-label="移除截圖"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-canvas shadow-control"><X size={11} /></button>
              </div>
              <span className="text-xs text-muted">截圖會隨這則訊息一起送出</span>
            </div>
          )}
          <div className="flex items-end gap-1 p-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = pickImage(e.target.files); if (f) setFile(f); e.target.value = '' }} />
            <button type="button" disabled={locked} onClick={() => fileRef.current?.click()} title="附上截圖" aria-label="附上截圖"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-background-lite hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">
              <ImagePlus size={18} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              disabled={locked}
              placeholder={disabled ? '正在建立對話…' : '輸入訊息，或直接貼上截圖'}
              className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted disabled:opacity-50"
            />
            <button type="button" disabled={!canSend} onClick={send} title="送出（Enter）" aria-label="送出"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30">
              <SendHorizontal size={16} />
            </button>
          </div>
        </div>
        <div className="mx-auto mt-1.5 max-w-2xl px-1 text-center text-[11px] text-muted">Enter 送出，Shift+Enter 換行；截圖可直接貼上或拖進來</div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-scrim pg-fadein">
          <div className="rounded-xl bg-canvas px-4 py-2 text-sm font-medium shadow-control">放開以附上截圖</div>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim-strong)] p-6 pg-fadein">
          <button type="button" className="absolute right-4 top-4 rounded-full bg-canvas p-2 text-primary shadow-control" onClick={() => setZoom(null)} title="關閉" aria-label="關閉"><X size={18} /></button>
          <img ref={zoomRef} src={zoom} alt="放大檢視" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}

function Bubble({ item: m, first, selected, onZoom, onSelect, onPick, picksLocked }: {
  item: ChatItem; first: boolean; selected: boolean; onZoom: (u: string) => void; onSelect?: (turnId: string) => void
  onPick: (label: string) => void; picksLocked: boolean
}) {
  if (m.role === 'user') {
    return (
      <div className={clsx('flex justify-end pg-risein', first && 'pt-3')}>
        {m.kind === 'image' ? (
          <button type="button" onClick={() => m.url && onZoom(m.url)} className="overflow-hidden rounded-2xl rounded-tr-sm border border-border bg-canvas" title="點擊放大">
            <img src={m.url} alt="民眾截圖" className="block max-h-56 max-w-[220px] object-contain" />
          </button>
        ) : (
          <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2 text-sm leading-6 text-on-accent">{m.text}</div>
        )}
      </div>
    )
  }
  const clickable = !!m.turnId && !!onSelect
  const select = () => m.turnId && onSelect?.(m.turnId)
  return (
    <div className={clsx('pg-risein', first && 'pt-3')}>
      {first && <div className="mb-1 pl-1 text-[11px] text-muted">線上客服</div>}
      <div className="flex justify-start">
        <div
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? select : undefined}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select() } } : undefined}
          className={clsx('max-w-[85%] rounded-2xl rounded-tl-sm bg-canvas transition-shadow', m.error && 'text-danger',
            clickable && 'cursor-pointer', selected && 'ring-2 ring-accent ring-offset-2 ring-offset-background')}
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          {m.kind === 'image' ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); if (m.url) onZoom(m.url) }} className="block w-[280px] max-w-full overflow-hidden rounded-2xl rounded-tl-sm bg-background-lite" title={m.alt ?? '點擊放大'}>
              <img src={m.previewUrl ?? m.url} alt={m.alt ?? '步驟圖'} className="mx-auto block max-h-[440px] w-auto max-w-full object-contain" />
            </button>
          ) : m.kind === 'choices' ? (
            <div className="w-[240px] max-w-full overflow-hidden rounded-2xl rounded-tl-sm">
              {m.text && <div className="whitespace-pre-wrap px-3.5 py-2 text-sm leading-6">{m.text}</div>}
              <div className="border-t border-border">
                {(m.options ?? []).map((o, i) => (
                  <button
                    key={i} type="button" disabled={picksLocked}
                    onClick={(e) => { e.stopPropagation(); onPick(o.label) }}
                    className="block w-full border-b border-border px-3.5 py-2 text-left text-sm leading-5 transition-colors last:border-b-0 hover:bg-background-lite disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap px-3.5 py-2 text-sm leading-6">{m.text}</div>
          )}
        </div>
      </div>
    </div>
  )
}
