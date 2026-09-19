/**
 * 罐頭訊息（SPEC §8.6）——民眾在 LINE 上看到的每一個字都從這裡出去。
 *
 * 版面是「分類 → key 清單 → 編輯 → 預覽」四段，桌機並排、手機上下疊。右邊那支
 * 手機不是裝飾：改一個字就看得到民眾會收到什麼，承辦人才不必發布出去才發現
 * 句子斷在奇怪的地方。預覽的內容由後端用**同一組** Flex builder 產生，不是後台
 * 另外畫一份近似品。
 *
 * 發布一律帶 `expected_version`（樂觀鎖）。撞到 409 時給的是「請重新載入」而不是
 * 一句紅色的失敗——這不是壞掉，是有人比你早一步改了同一則訊息。
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, MessageSquareText, RotateCcw, Save, Search, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import type { ContentPreview, ContentView } from '../../lib/types'
import { Badge, Button, Empty, Input, Spinner, confirm, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader } from '../../components/admin/shared'
import { ChatBubble, LabelFieldRow, LineMessages, PhoneFrame, QuickReplyRow } from './flexPreview'
import { substitute, surfaceLabel } from './labels'
import { fetchContentPreview, fetchContents, publishContent, resetContent, saveContentDraft } from './queries'

/** 打字當下就送預覽請求會打爆後端；停手約三分之一秒才送。 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

const matches = (item: ContentView, needle: string) =>
  !needle ||
  item.key.toLowerCase().includes(needle) ||
  item.title.toLowerCase().includes(needle) ||
  item.content.toLowerCase().includes(needle) ||
  (item.draft ?? '').toLowerCase().includes(needle)

export default function LineContentsPage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()

  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'draft' | 'publish' | 'reset' | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)

  // 一次抓完整份清單再在前端篩：每個分類的筆數才算得出來，搜尋也不必等網路。
  const listQuery = useQuery({ queryKey: ['line-contents'], queryFn: () => fetchContents() })
  const categories = listQuery.data?.categories ?? []
  const stats = listQuery.data?.stats

  const needle = search.trim().toLowerCase()
  const found = useMemo(() => (listQuery.data?.items ?? []).filter((i) => matches(i, needle)), [listQuery.data, needle])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of found) out[item.category] = (out[item.category] ?? 0) + 1
    return out
  }, [found])
  const visible = useMemo(() => found.filter((i) => !category || i.category === category), [found, category])

  const selected = visible.find((i) => i.key === selectedKey) ?? found.find((i) => i.key === selectedKey) ?? null
  useEffect(() => {
    if (!selected && visible.length) setSelectedKey(visible[0].key)
  }, [selected, visible])

  // 換一則訊息（或別人改過之後）就把編輯區重設成「有草稿看草稿，沒草稿看內容」。
  const selectedVersion = selected?.version
  useEffect(() => {
    if (!selected) return
    setText(selected.draft ?? selected.content)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在換 key／版本時重設，打字中不要被 refetch 蓋掉
  }, [selected?.key, selectedVersion])

  const settledText = useDebounced(text, 300)
  const previewQuery = useQuery({
    queryKey: ['line-content-preview', selectedKey, dirty ? settledText : null],
    queryFn: () => fetchContentPreview({ key: selectedKey, ...(dirty ? { text: settledText } : {}) }),
    enabled: !!selectedKey,
    placeholderData: keepPreviousData,
  })
  const preview = previewQuery.data ?? null

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`
    const area = editor.current
    const start = area?.selectionStart ?? text.length
    const end = area?.selectionEnd ?? start
    setText(text.slice(0, start) + token + text.slice(end))
    setDirty(true)
    if (area) {
      const caret = start + token.length
      requestAnimationFrame(() => {
        area.focus()
        area.setSelectionRange(caret, caret)
      })
    }
  }

  /** 三顆按鈕共用：跑、通知、重抓。409 是「有人比你快」，講法要不一樣。 */
  const run = async (kind: 'draft' | 'publish' | 'reset', action: () => Promise<unknown>, done: string) => {
    setBusy(kind)
    try {
      await action()
      await invalidate('line-contents', 'line-content-preview')
      setDirty(false)
      toast(done)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast('這則訊息剛剛被其他人改過了，請重新載入後再編輯一次。', 'err')
      else toast(errMsg(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const onSaveDraft = () => {
    if (!selected) return
    void run('draft', () => saveContentDraft(selected.key, { draft: text, expected_version: selected.version }), '已儲存草稿')
  }
  const onPublish = () => {
    if (!selected) return
    void run('publish', () => publishContent(selected.key, { content: text, expected_version: selected.version }), '已發布，民眾現在看到的就是這一版')
  }
  const onReset = async () => {
    if (!selected) return
    const ok = await confirm({ title: '還原成預設文字？', body: '目前的內容與草稿都會被系統內建的版本蓋掉。', action: '還原', danger: true })
    if (!ok) return
    void run('reset', () => resetContent(selected.key, { expected_version: selected.version }), '已還原預設')
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="罐頭訊息"
        description={<>民眾在 LINE 上看到的每一句話。改完先存草稿、確認右邊的預覽沒問題再發布；發布後民眾立刻看到新的版本。</>}
        actions={stats && <span className="text-xs text-muted">共 {stats.registry} 則 ・ 已修改 {stats.customised} ・ 草稿 {stats.drafts}</span>}
      />
      {!admin && <Notice tone="muted">你可以檢視全部文案，但只有管理員能儲存草稿或發布。</Notice>}
      {listQuery.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {listQuery.error && <Notice tone="warn">{errMsg(listQuery.error)}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[176px_224px_minmax(320px,1fr)] xl:grid-cols-[176px_224px_minmax(320px,1fr)_336px]">
        {/* 1 ─ 分類 */}
        <nav aria-label="文案分類" className="space-y-1">
          <label className="relative block">
            <span className="sr-only">搜尋文案</span>
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋 key 或內容" className="pl-7" />
          </label>
          <button
            type="button"
            onClick={() => setCategory('')}
            className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${!category ? 'bg-accent-bg font-medium text-accent' : 'text-muted hover:bg-background-lite hover:text-primary'}`}
            aria-current={!category || undefined}
          >
            <span>全部</span>
            <span className="text-[11px] tabular-nums">{found.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              title={c.description}
              className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${category === c.id ? 'bg-accent-bg font-medium text-accent' : 'text-muted hover:bg-background-lite hover:text-primary'}`}
              aria-current={category === c.id || undefined}
            >
              <span className="flex min-w-0 items-center gap-1.5"><span aria-hidden>{c.icon}</span><span className="truncate">{c.label}</span></span>
              <span className="text-[11px] tabular-nums">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </nav>

        {/* 2 ─ key 清單 */}
        <div className="max-h-[70vh] space-y-1 overflow-auto rounded-xl border border-border bg-canvas p-1.5" style={{ boxShadow: 'var(--shadow-float)' }}>
          {!visible.length && !listQuery.isLoading && <Empty>{needle ? '沒有符合的文案' : '這個分類還沒有文案'}</Empty>}
          {visible.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelectedKey(item.key)}
              aria-current={item.key === selectedKey || undefined}
              className={`block min-h-11 w-full rounded-lg px-2.5 py-1.5 text-left ${item.key === selectedKey ? 'bg-accent-bg' : 'hover:bg-background-lite'}`}
            >
              <span className={`block truncate text-sm ${item.key === selectedKey ? 'font-medium text-accent' : 'text-primary'}`}>{item.title}</span>
              <span className="block truncate font-mono text-[11px] text-secondary">{item.key}</span>
              {(item.customised || item.has_draft) && (
                <span className="mt-1 flex gap-1">
                  {item.customised && <Badge tone="accent">已修改</Badge>}
                  {item.has_draft && <Badge tone="warn">有草稿</Badge>}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 3 ─ 編輯 */}
        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-canvas p-4" style={{ boxShadow: 'var(--shadow-float)' }}>
          {!selected ? (
            <Empty>左邊挑一則文案開始編輯</Empty>
          ) : (
            <>
              <header className="space-y-1">
                <h2 className="text-[15px] font-semibold tracking-tight">{selected.title}</h2>
                <p className="font-mono text-[11px] text-secondary">{selected.key}</p>
                {selected.description && <p className="text-xs leading-5 text-muted">{selected.description}</p>}
              </header>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted">訊息內容</span>
                <textarea
                  ref={editor}
                  value={text}
                  readOnly={!admin}
                  onChange={(e) => { setText(e.target.value); setDirty(true) }}
                  rows={10}
                  aria-label="訊息內容"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[13px] leading-6 outline-none focus:border-accent read-only:text-muted"
                />
              </label>

              {!!selected.variables.length && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted">可用變數（點一下插入游標位置）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.variables.map((name) => {
                      const missing = preview?.missing_variables.includes(name)
                      return (
                        <button
                          key={name}
                          type="button"
                          disabled={!admin}
                          onClick={() => insertVariable(name)}
                          title={preview?.sample_variables[name] ? `範例值：${preview.sample_variables[name]}` : undefined}
                          className={`min-h-9 rounded-full border px-3 py-1 font-mono text-[12px] disabled:opacity-50 ${missing ? 'border-warn/40 bg-warn-bg text-warn' : 'border-border bg-background text-muted hover:border-accent hover:text-accent'}`}
                        >
                          {`{{${name}}}`}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {!!preview?.missing_variables.length && (
                <Notice tone="warn">
                  <span className="flex items-start gap-1.5">
                    <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
                    <span>少了 {preview.missing_variables.map((v) => `{{${v}}}`).join('、')}，民眾會看到一段缺資訊的話。</span>
                  </span>
                </Notice>
              )}
              {!!preview?.unknown_variables.length && (
                <Notice tone="muted">{preview.unknown_variables.map((v) => `{{${v}}}`).join('、')} 系統不會代入，會原樣顯示給民眾。</Notice>
              )}

              {admin && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="primary" onClick={onPublish} loading={busy === 'publish'} disabled={!!busy}><Send size={13} /> 發布</Button>
                  <Button onClick={onSaveDraft} loading={busy === 'draft'} disabled={!!busy}><Save size={13} /> 儲存草稿</Button>
                  <Button variant="ghost" onClick={() => void onReset()} loading={busy === 'reset'} disabled={!!busy}><RotateCcw size={13} /> 還原預設</Button>
                  {dirty && <span className="text-[11px] text-muted">尚未儲存</span>}
                </div>
              )}

              <details className="rounded-lg border border-border bg-background-lite p-3 text-xs">
                <summary className="cursor-pointer select-none font-medium text-muted">預設值{text.trim() !== selected.default.trim() && <span className="ml-1.5 text-secondary">（和目前的內容不一樣）</span>}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-muted">{selected.default}</pre>
              </details>
            </>
          )}
        </section>

        {/* 4 ─ 手機預覽 */}
        <aside className="min-w-0 space-y-3 lg:col-span-3 xl:col-span-1">
          <PhoneFrame title={<span>民眾看到的樣子</span>}>
            <LivePreview kind={preview?.kind ?? 'text'} text={text} preview={preview} />
          </PhoneFrame>
          <SurfaceTabs surfaces={preview?.surfaces ?? []} loading={previewQuery.isLoading} />
        </aside>
      </div>
    </div>
  )
}

/** 現在正在編輯的這一則，照它的型別畫成 LINE 上的樣子。 */
function LivePreview({ kind, text, preview }: { kind: string; text: string; preview: ContentPreview | null }) {
  const rendered = substitute(text, preview?.sample_variables ?? {})
  if (kind === 'button') return <QuickReplyRow labels={[rendered || '（空白按鈕）']} />
  if (kind === 'label') return <LabelFieldRow label={rendered || '（空白欄位）'} value={preview?.sample_variables.case_no ?? '範例值'} />
  return (
    <>
      <ChatBubble>{rendered || '（空白訊息）'}</ChatBubble>
      <QuickReplyRow labels={preview?.quick_replies ?? []} />
    </>
  )
}

/** 這則文字實際出現的七個畫面。訊息 JSON 由後端產生，這裡只負責畫。 */
function SurfaceTabs({ surfaces, loading }: { surfaces: { id: string; messages: unknown[] }[]; loading: boolean }) {
  const [active, setActive] = useState('')
  const current = surfaces.find((s) => s.id === active) ?? surfaces[0] ?? null
  if (loading && !surfaces.length) return <div className="flex items-center gap-2 text-xs text-muted"><Spinner size={13} /> 產生預覽中…</div>
  if (!current) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted"><MessageSquareText size={13} aria-hidden /> 這些文字出現在</div>
      <div role="tablist" aria-label="預覽畫面" className="flex flex-wrap gap-1">
        {surfaces.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === current.id}
            onClick={() => setActive(s.id)}
            className={`min-h-9 rounded-full border px-3 py-1 text-[12px] ${s.id === current.id ? 'border-accent bg-accent-bg text-accent' : 'border-border bg-canvas text-muted hover:text-primary'}`}
          >
            {surfaceLabel(s.id)}
          </button>
        ))}
      </div>
      <PhoneFrame title={<span>{surfaceLabel(current.id)}</span>}>
        <LineMessages messages={current.messages} />
      </PhoneFrame>
    </section>
  )
}
