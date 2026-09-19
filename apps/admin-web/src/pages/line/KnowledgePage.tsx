/**
 * 知識文件（SPEC §8.2）——法規原文、申請須知、問答整理，之後餵給內容助理。
 *
 * 版面是「左清單、右編輯」而不是彈窗：這些文件動輒上千字，在一個 520px 的對話框
 * 裡改法條是折磨。`source_url` 留著是為了讓人查得到出處，承辦人要對民眾負責。
 */

import { useQuery } from '@tanstack/react-query'
import { BookOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import type { KnowledgeDoc } from '../../lib/types'
import { Button, Empty, Field, Input, Select, Spinner, confirm, errMsg, useToast } from '../../components/ui'
import { TagInput } from '../../components/admin/TagInput'
import { Notice, PageHeader, fmtDate } from '../../components/admin/shared'
import { createKnowledge, deleteKnowledge, fetchKnowledge, updateKnowledge, type KnowledgeInput } from './queries'

const SOURCE_TYPES: { value: string; label: string }[] = [
  { value: 'regulation', label: '法規條文' },
  { value: 'guideline', label: '申請須知' },
  { value: 'faq', label: '問答整理' },
  { value: 'note', label: '內部筆記' },
  { value: 'other', label: '其他' },
]
const BLANK: KnowledgeInput = { title: '', content: '', source_url: '', source_type: 'guideline', tags: [] }

export default function LineKnowledgePage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | 'new' | ''>('')
  const [form, setForm] = useState<KnowledgeInput>(BLANK)
  const [saving, setSaving] = useState(false)

  const query = useQuery({ queryKey: ['line-knowledge', search], queryFn: () => fetchKnowledge({ q: search.trim() || undefined }) })
  const items = query.data?.items ?? []
  const selected = items.find((d) => d.id === selectedId) ?? null

  // 換一份文件才重設表單；打字到一半被 refetch 蓋掉會讓人想砸鍵盤。
  const selectedVersion = selected?.version
  useEffect(() => {
    if (selectedId === 'new') { setForm(BLANK); return }
    if (!selected) return
    setForm({ title: selected.title, content: selected.content, source_url: selected.source_url, source_type: selected.source_type || 'guideline', tags: selected.tags })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在換文件／版本時重設
  }, [selectedId, selectedVersion])

  const set = <K extends keyof KnowledgeInput>(k: K, v: KnowledgeInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim()) { toast('請先填標題', 'err'); return }
    setSaving(true)
    try {
      if (selected) await updateKnowledge(selected.id, { ...form, expected_version: selected.version })
      else {
        const created = await createKnowledge(form)
        setSelectedId(created.id)
      }
      await invalidate('line-knowledge')
      toast('已儲存')
    } catch (e) { toast(errMsg(e), 'err') } finally { setSaving(false) }
  }

  const remove = async (doc: KnowledgeDoc) => {
    const ok = await confirm({ title: `刪除「${doc.title}」？`, body: '這份文件與它的標籤都會消失，無法復原。', action: '刪除', danger: true })
    if (!ok) return
    try {
      await deleteKnowledge(doc.id)
      await invalidate('line-knowledge')
      setSelectedId('')
      toast('已刪除')
    } catch (e) { toast(errMsg(e), 'err') }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="知識文件"
        description="法規原文、申請須知與問答整理。這些內容不會直接回給民眾，而是之後給內容助理寫草稿時的依據，所以出處要留。"
        actions={admin && <Button variant="primary" onClick={() => setSelectedId('new')}><Plus size={14} /> 新增文件</Button>}
      />
      {!admin && <Notice tone="muted">你可以閱讀全部文件，但只有管理員能編輯。</Notice>}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋標題或內容" aria-label="搜尋文件" />
          {query.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
          {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
          <div className="max-h-[68vh] space-y-1 overflow-auto rounded-xl border border-border bg-canvas p-1.5" style={{ boxShadow: 'var(--shadow-float)' }}>
            {!items.length && !query.isLoading && <Empty>還沒有知識文件</Empty>}
            {items.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setSelectedId(doc.id)}
                aria-current={doc.id === selectedId || undefined}
                className={`block min-h-11 w-full rounded-lg px-2.5 py-1.5 text-left ${doc.id === selectedId ? 'bg-accent-bg' : 'hover:bg-background-lite'}`}
              >
                <span className={`block truncate text-sm ${doc.id === selectedId ? 'font-medium text-accent' : 'text-primary'}`}>{doc.title || '（未命名）'}</span>
                <span className="block truncate text-[11px] text-secondary">{fmtDate(doc.updated_at)} ・ {doc.tags.join('、') || '沒有標籤'}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-canvas p-4" style={{ boxShadow: 'var(--shadow-float)' }}>
          {!selected && selectedId !== 'new' ? (
            <Empty><span className="flex flex-col items-center gap-2"><BookOpen size={20} aria-hidden className="text-muted" />左邊挑一份文件，或新增一份</span></Empty>
          ) : (
            <>
              <Field label="標題"><Input value={form.title} onChange={(e) => set('title', e.target.value)} readOnly={!admin} /></Field>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted">內容</span>
                <textarea
                  value={form.content}
                  readOnly={!admin}
                  onChange={(e) => set('content', e.target.value)}
                  rows={18}
                  aria-label="內容"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-[13px] leading-6 outline-none focus:border-accent read-only:text-muted"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="出處連結" hint="民眾問起時查得到原文。"><Input value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" readOnly={!admin} /></Field>
                <Field label="文件類型">
                  <Select value={form.source_type} onChange={(e) => set('source_type', e.target.value)} disabled={!admin} className="w-full">
                    {SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="標籤" hint="之後用來挑出相關文件。">
                <TagInput value={form.tags} onChange={(v) => set('tags', v)} disabled={!admin} />
              </Field>
              {admin && (
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="primary" onClick={() => void save()} loading={saving}>儲存</Button>
                  {selected && <Button variant="ghost" className="text-danger" onClick={() => void remove(selected)}><Trash2 size={13} /> 刪除</Button>}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
