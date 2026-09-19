/**
 * Playground (SPEC §10): a blank chat with the 虛擬客服. Open the page, the
 * agent says hello once, then you type or paste a screenshot and it answers
 * with plain messages and Step Card images — the whole tool-calling pipeline
 * runs behind it. An inspector for the current turn is a click away.
 */
import { clsx } from 'clsx'
import { Activity, MessageSquarePlus, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ChatRoom from '../components/playground/ChatRoom'
import TurnInspector, { type TurnRecord } from '../components/playground/TurnInspector'
import type { ChatItem, Outgoing } from '../components/playground/types'
import { Button, Field, IconButton, Input, Select, Spinner, Textarea, errMsg, useDismiss, useToast } from '../components/ui'
import { api, get, post, put } from '../lib/api'
import type { ChatTurnMessage, ChatTurnResponse, TenantPolicy, TenantPolicyResponse } from '../lib/types'

type ContentMode = 'published' | 'draft'
const LS_INSPECTOR = 'sop_playground_inspector'

let seq = 0
const mid = () => `m${Date.now()}_${++seq}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const toItem = (m: ChatTurnMessage, turnId: string): ChatItem => {
  if (m.kind === 'image') return { id: mid(), role: 'assistant', kind: 'image', url: m.url, previewUrl: m.preview_url ?? m.url, alt: m.alt, turnId }
  if (m.kind === 'choices') return { id: mid(), role: 'assistant', kind: 'choices', text: m.text, options: m.options ?? [], turnId }
  return { id: mid(), role: 'assistant', kind: 'text', text: m.text, turnId }
}

export default function PlaygroundPage() {
  const [contentMode, setContentMode] = useState<ContentMode>('published')
  const [chatId, setChatId] = useState<string | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(true)  // a chat is being created on mount
  const [turns, setTurns] = useState<TurnRecord[]>([])
  const [selectedTurn, setSelectedTurn] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [inspector, setInspector] = useState(() => localStorage.getItem(LS_INSPECTOR) === '1')
  useEffect(() => { localStorage.setItem(LS_INSPECTOR, inspector ? '1' : '0') }, [inspector])
  const objectUrls = useRef<string[]>([])
  const generation = useRef(0)  // bumps on 新對話 so a slow reveal from the old chat stops

  useEffect(() => () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  /** Assistant messages land one by one, like someone typing them. */
  const reveal = useCallback(async (msgs: ChatTurnMessage[], turnId: string, gen: number) => {
    for (const [i, m] of msgs.entries()) {
      if (i > 0) await sleep(m.kind === 'image' ? 500 : 350)
      if (generation.current !== gen) return
      setItems((s) => [...s, toItem(m, turnId)])
    }
  }, [])

  /** Creates the chat and lets the agent say hello. Only sets state after the request, so it is safe to call from the mount effect. */
  const open = useCallback(async (mode: ContentMode, gen: number) => {
    try {
      const res = await post<ChatTurnResponse>('/api/playground/chats', { content_mode: mode })
      if (generation.current !== gen) return
      setChatId(res.chat_id)
      setBusy(false)
      await reveal(res.messages, 'greeting', gen)
    } catch (e) {
      if (generation.current !== gen) return
      setBusy(false)
      setItems([{ id: mid(), role: 'assistant', kind: 'text', text: `無法建立對話：${errMsg(e)}`, error: true }])
    }
  }, [reveal])

  useEffect(() => { void open('published', ++generation.current) }, [open])

  const restart = (mode: ContentMode) => {
    const gen = ++generation.current
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u))
    objectUrls.current = []
    setContentMode(mode)
    setChatId(null)
    setItems([])
    setTurns([])
    setSelectedTurn(null)
    setBusy(true)
    void open(mode, gen)
  }

  const send = async ({ text, file }: Outgoing) => {
    if (!chatId || busy) return
    const gen = generation.current
    const turnId = mid()
    const mine: ChatItem[] = []
    if (file) {
      const url = URL.createObjectURL(file)
      objectUrls.current.push(url)
      mine.push({ id: mid(), role: 'user', kind: 'image', url })
    }
    if (text) mine.push({ id: mid(), role: 'user', kind: 'text', text })
    setItems((s) => [...s, ...mine])
    setBusy(true)
    const form = new FormData()
    if (text) form.append('text', text)
    if (file) form.append('file', file)
    try {
      const res = await api<ChatTurnResponse>(`/api/playground/chats/${chatId}/messages`, { method: 'POST', form })
      if (generation.current !== gen) return
      setTurns((s) => [...s, { id: turnId, index: s.length + 1, userText: text, debug: res._debug ?? null }])
      setSelectedTurn(turnId)
      await reveal(res.messages, turnId, gen)
    } catch (e) {
      if (generation.current !== gen) return
      setItems((s) => [...s, { id: mid(), role: 'assistant', kind: 'text', text: `請求失敗：${errMsg(e)}`, error: true, turnId }])
    } finally {
      if (generation.current === gen) setBusy(false)
    }
  }

  const turn = turns.find((t) => t.id === selectedTurn) ?? turns[turns.length - 1] ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-canvas px-4">
        <div className="text-sm font-semibold">測試對話</div>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5" title="內容模式（切換會開新對話）">
            {([['published', '已發布'], ['draft', '草稿']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => v !== contentMode && restart(v)} disabled={busy && !chatId}
                className={clsx('h-6 rounded-md px-2 text-xs font-medium transition-colors', contentMode === v ? 'bg-accent-bg text-accent' : 'text-muted hover:text-primary')}>{l}</button>
            ))}
          </div>
          <IconButton active={inspector} onClick={() => setInspector((v) => !v)} title={inspector ? '隱藏回合檢視' : '檢視這一回合做了什麼'} aria-label="回合檢視"><Activity size={16} /></IconButton>
          <Button size="sm" onClick={() => restart(contentMode)} disabled={busy && !chatId}><MessageSquarePlus size={14} /> 新對話</Button>
          <div className="relative">
            <IconButton active={settings} onClick={() => setSettings((v) => !v)} title="客服策略" aria-label="客服策略"><Settings size={16} /></IconButton>
            {settings && <PolicyPopover onClose={() => setSettings(false)} onSaved={() => { setSettings(false); restart(contentMode) }} />}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          <ChatRoom items={items} busy={busy} disabled={!chatId} onSend={send}
            selectedTurnId={inspector ? turn?.id ?? null : null} onSelectTurn={(id) => { setSelectedTurn(id); setInspector(true) }} />
        </div>
        {inspector && (
          <aside className="min-h-0 w-[380px] shrink-0 overflow-y-auto border-l border-border bg-canvas pg-panelin">
            <TurnInspector turn={turn} />
          </aside>
        )}
      </div>
    </div>
  )
}

const LANGUAGES: [string, string][] = [
  ['zh-TW', '台灣正體中文'], ['en', 'English'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['ja', '日本語'],
  ['th', 'ภาษาไทย'], ['tl', 'Filipino'], ['ko', '한국어'], ['zh-CN', '简体中文'],
]
const NO_TEMPLATES_HINT = '語言有內建句子時才會用該語言的預設文案，其他語言由客服模型自行翻譯'

/** The screenshot outcomes a clerk can decide about, in the order they are met. */
type OutcomeKey = 'on_ambiguous' | 'on_off_flow' | 'on_not_app_screen' | 'on_unknown_platform' | 'on_unreadable'
const OUTCOMES: { key: OutcomeKey; label: string; options: [string, string][] }[] = [
  { key: 'on_ambiguous', label: '不確定是哪一步', options: [['ask', '列候選確認'], ['best_guess', '直接當作定位到']] },
  { key: 'on_off_flow', label: '不在流程內', options: [['restart', '回首頁從步驟 1'], ['ask_goal', '問要辦哪一項'], ['handoff', '轉人工']] },
  { key: 'on_not_app_screen', label: '非 App 畫面', options: [['restart', '回首頁從步驟 1'], ['ask_platform', '問平台'], ['handoff', '轉人工']] },
  { key: 'on_unknown_platform', label: '平台不明', options: [['ask_platform', '問平台'], ['handoff', '轉人工']] },
  { key: 'on_unreadable', label: '無法辨識', options: [['retake', '請重截'], ['handoff', '轉人工']] },
]
/** These four have their own fields above, so they are not listed again as templates. */
const OWN_FIELD = new Set(['name', 'goal_noun', 'tone', 'handoff'])
const CTRL = 'h-8 rounded-lg border border-border bg-canvas px-2 text-[12px] outline-none focus:border-accent'

/** 客服策略 — one section heading inside the popover. */
const Group = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={clsx('space-y-2.5', className)}>
    <div className="text-[12px] font-semibold">{title}</div>
    {children}
  </section>
)

/**
 * 客服策略 — everything the citizen-facing engines read from the tenant: the
 * language and wording it speaks in, what it does with each screenshot
 * outcome, and the sentences themselves. The greeting is built from it, so
 * saving opens a fresh chat.
 */
function PolicyPopover({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const toast = useToast()
  useDismiss(true, onClose, panel)
  const [form, setForm] = useState<TenantPolicy | null>(null)
  const [builtins, setBuiltins] = useState<Record<string, string>>({})
  const [withTemplates, setWithTemplates] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void get<TenantPolicyResponse>('/api/tenant/policy')
      .then(({ overrides, builtin_templates, languages_with_templates, ...p }) => {
        if (!alive) return
        setForm({ ...p, templates: { ...overrides } })
        setBuiltins(builtin_templates ?? {})
        setWithTemplates(languages_with_templates ?? [])
      })
      .catch((e) => { if (alive) setError(errMsg(e)) })
    return () => { alive = false }
  }, [])

  /** One field; the enum ones come from a list, so the value arrives as a plain string. */
  const set = (k: keyof TenantPolicy, v: string | number) => setForm((f) => (f ? { ...f, [k]: v } as TenantPolicy : f))
  const setTemplate = (k: string, v: string) => setForm((f) => (f ? { ...f, templates: { ...f.templates, [k]: v } } : f))

  const save = async () => {
    if (!form || saving) return
    setSaving(true)
    try {
      // An emptied input is not an override; the tenant falls back to the built-in sentence.
      const templates = Object.fromEntries(Object.entries(form.templates).filter(([, v]) => v.trim()))
      await put('/api/tenant/policy', { ...form, templates })
      toast('已更新客服策略')
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setSaving(false)
    }
  }

  const keys = Object.keys(builtins).filter((k) => !OWN_FIELD.has(k))

  return (
    <div ref={panel} className="pg-dropin absolute right-0 top-10 z-40 flex max-h-[min(70vh,34rem)] w-[26rem] flex-col rounded-xl border border-border bg-canvas" style={{ boxShadow: 'var(--shadow-popover)' }}>
      <div className="shrink-0 px-4 pb-2 pt-4 text-[13px] font-semibold">客服策略</div>
      {!form ? (
        <div className="px-4 pb-4">{error ? <div className="text-[12px] text-danger">{error}</div> : <div className="flex justify-center py-4"><Spinner /></div>}</div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save() }} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <Group title="語氣與用語">
              <Field label="語言" hint={withTemplates.includes(form.language) ? undefined : NO_TEMPLATES_HINT}>
                <Select className="w-full" value={form.language} onChange={(e) => set('language', e.target.value)}>
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="客服名稱">
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：線上客服" />
              </Field>
              <Field label="語氣">
                <Input value={form.tone} onChange={(e) => set('tone', e.target.value)} placeholder="例如：簡短口語，像真人客服在打字" />
              </Field>
              <Field label="目標的稱呼" hint="民眾要完成的東西，例如文件、服務、申請">
                <Input value={form.goal_noun} onChange={(e) => set('goal_noun', e.target.value)} placeholder="例如：文件" />
              </Field>
              <Field label="補充規則">
                <Textarea rows={3} value={form.extra_rules} onChange={(e) => set('extra_rules', e.target.value)} placeholder="這個單位還想要客服遵守的事" />
              </Field>
              <Field label="無法協助時的說法">
                <Textarea rows={2} value={form.handoff_message} onChange={(e) => set('handoff_message', e.target.value)} placeholder="例如：請改撥服務專線詢問" />
              </Field>
            </Group>

            <Group title="行為" className="border-t border-border pt-4">
              <label className="flex items-center gap-2">
                <span className="flex-1 text-xs text-muted">傳圖方式</span>
                <select className={clsx(CTRL, 'w-40')} value={form.delivery} onChange={(e) => set('delivery', e.target.value)}>
                  <option value="all_at_once">一次傳完</option>
                  <option value="one_by_one">一次一張</option>
                </select>
              </label>
              {OUTCOMES.map((o) => (
                <label key={o.key} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-muted">{o.label}</span>
                  <select className={clsx(CTRL, 'w-40')} value={form[o.key]} onChange={(e) => set(o.key, e.target.value)}>
                    {o.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              ))}
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <Field label="定位信心門檻">
                  <Input type="number" min={0} max={1} step={0.05} value={form.locate_threshold}
                    onChange={(e) => set('locate_threshold', e.target.valueAsNumber || 0)} />
                </Field>
                <Field label="候選下限">
                  <Input type="number" min={0} max={1} step={0.05} value={form.locate_low}
                    onChange={(e) => set('locate_low', e.target.valueAsNumber || 0)} />
                </Field>
              </div>
            </Group>

            {keys.length > 0 && (
              <details className="border-t border-border pt-4">
                <summary className="cursor-pointer text-[12px] font-semibold text-muted marker:text-muted hover:text-primary">自訂文案</summary>
                <div className="mt-2.5 space-y-1.5">
                  {keys.map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 truncate font-mono text-[11px] text-muted" title={k}>{k}</span>
                      <input className={clsx(CTRL, 'min-w-0 flex-1')} value={form.templates[k] ?? ''} placeholder={builtins[k]}
                        onChange={(e) => setTemplate(k, e.target.value)} />
                    </label>
                  ))}
                </div>
              </details>
            )}

            {error && <div className="text-[12px] text-danger">{error}</div>}
          </div>
          <div className="flex shrink-0 justify-end border-t border-border px-4 py-2.5">
            <Button type="submit" size="sm" variant="primary" loading={saving}>儲存</Button>
          </div>
        </form>
      )}
    </div>
  )
}
