/** 右下角的申請文件準備助手（第 4、5 步）。
 *
 * 「找不到扣款證明」是話務量最高的問題之一，而教學只講得了通例——各家銀行的
 * App 長得不一樣，選單名稱也不同。這個對話補的是「我家的 App 不長這樣」那一段。
 *
 * 只在準備與上傳這兩步出現：那是市民真的放下手機去翻銀行 App 的時刻。
 * 填欄位、送出的步驟它幫不上忙，掛在那裡只會跟主要動作搶注意力（SPEC §15.1）。
 *
 * **第一版只收文字，不收圖。** SPEC §11 的外送清單允許送「市民 SOP 截圖」，
 * 但**不含證明文件**；開一個能貼圖的框給匿名流量，等於等著有人把信用卡帳單
 * 貼進來。要收圖就得跟 `/sop` 一樣強制先走遮罩編輯器，那是之後的事。
 */

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { Button, Spinner, cx } from '@maydru/ui'
import { sendHelpChat, type HelpChatMessage } from '../lib/helpChat'

const GREETING: HelpChatMessage = {
  role: 'assistant',
  text: '找不到扣款證明嗎？說說你用哪一家銀行或電信、卡在哪一步，我幫你找。',
}

export function HelpChat() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<HelpChatMessage[]>([GREETING])
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 新訊息一律捲到底；人不該為了看回覆自己捲一次。
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [open, messages])

  // 打開時把游標放進輸入框——按下泡泡的人就是要打字。
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setError('')
    setMessages((current) => [...current, { role: 'user', text }])
    setBusy(true)
    try {
      const reply = await sendHelpChat(text)
      setMessages((current) => [...current, reply])
    } catch {
      setError('現在問不到，請稍後再試，或直接洽承辦單位。')
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // 手機底部有導覽列（56px），泡泡要讓開，不然會蓋住「說明」那一格。
        className={cx(
          'fixed right-4 bottom-20 z-30 flex min-h-13 items-center gap-2 rounded-full px-5',
          'bg-accent text-[15px] font-medium text-on-accent lg:bottom-6',
        )}
        style={{ boxShadow: 'var(--shadow-lift)' }}
      >
        <MessageCircle size={18} aria-hidden />
        找不到？問問看
      </button>
    )

  return (
    <div
      role="dialog"
      aria-label="申請文件準備助手"
      className={cx(
        'fixed right-0 bottom-0 z-30 flex w-full flex-col overflow-hidden bg-canvas',
        'h-[70vh] rounded-t-2xl',
        'sm:right-4 sm:bottom-4 sm:h-[520px] sm:w-[380px] sm:rounded-2xl',
      )}
      style={{ boxShadow: 'var(--shadow-popover)' }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-[15px] font-semibold text-primary">申請文件準備助手</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="關閉"
          className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-background-lite"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((message, index) => (
          <p
            key={index}
            className={cx(
              'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap',
              message.role === 'user'
                ? 'ml-auto bg-accent text-on-accent'
                : 'bg-background-lite text-primary',
            )}
          >
            {message.text}
          </p>
        ))}
        {busy && <Spinner label="正在查…" />}
        {error && (
          <p role="alert" className="text-[13px] leading-5 text-danger">
            {error}
          </p>
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label className="sr-only" htmlFor="help-chat-input">
          你的問題
        </label>
        <input
          ref={inputRef}
          id="help-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="例如：我用玉山，找不到帳單查詢"
          autoComplete="off"
          className={cx(
            'h-11 min-w-0 flex-1 rounded-xl border border-transparent bg-[var(--field)] px-3.5',
            'text-[16px] text-primary outline-none placeholder:text-secondary',
            'focus-visible:border-accent focus-visible:bg-canvas',
          )}
        />
        <Button type="submit" variant="primary" size="md" disabled={!draft.trim() || busy} aria-label="送出問題">
          <Send size={16} aria-hidden />
        </Button>
      </form>
    </div>
  )
}
