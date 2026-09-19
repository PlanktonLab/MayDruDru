/**
 * 常見問題（SPEC §8.2）——LINE 上的 FAQ 選單與關鍵字回答都讀這張表。
 *
 * 「優先權」決定同一個關鍵字命中多筆時誰先回答；數字大的先。停用不是刪除：
 * 過季的問題留著，之後同一個活動再開就不必重打。
 */

import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import type { Faq } from '../../lib/types'
import { Badge, Button, Empty, Field, Input, Select, Spinner, Textarea, confirm, errMsg, useToast } from '../../components/ui'
import { Drawer } from '../../components/admin/Drawer'
import { Chips, TagInput } from '../../components/admin/TagInput'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../../components/admin/shared'
import { createFaq, deleteFaq, fetchFaqs, setFaqActive, updateFaq, type FaqInput } from './queries'

const BLANK: FaqInput = { question: '', answer: '', category: '', keywords: [], priority: 0, active: true }

export default function LineFaqsPage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<Faq | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['line-faqs', category, search],
    queryFn: () => fetchFaqs({ category: category || undefined, q: search.trim() || undefined }),
  })
  const items = query.data?.items ?? []

  const toggle = async (faq: Faq) => {
    setBusyId(faq.id)
    try {
      await setFaqActive(faq.id, !faq.active)
      await invalidate('line-faqs')
      toast(faq.active ? '已停用' : '已啟用')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  const remove = async (faq: Faq) => {
    const ok = await confirm({ title: `刪除「${faq.question}」？`, body: '刪掉就找不回來了。只是暫時不想讓它出現的話，改成停用就好。', action: '刪除', danger: true })
    if (!ok) return
    setBusyId(faq.id)
    try {
      await deleteFaq(faq.id)
      await invalidate('line-faqs')
      toast('已刪除')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="常見問題"
        description="民眾在 LINE 上問到相近的字時，系統就回這裡的答案。優先權數字大的先回答；停用的題目不會被選到，但紀錄留著。"
        actions={admin && <Button variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> 新增問題</Button>}
      />
      {!admin && <Notice tone="muted">你可以檢視全部問答，但只有管理員能新增或修改。</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋問題或答案" className="max-w-xs" aria-label="搜尋問題" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類">
          <option value="">全部分類</option>
          {(query.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {query.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
      {query.data && !items.length && <Empty>還沒有常見問題</Empty>}
      {!!items.length && (
        <Table>
          <thead><tr><Th>問題</Th><Th>分類</Th><Th>關鍵字</Th><Th className="w-20">優先權</Th><Th className="w-20">啟用</Th><Th className="w-32">更新時間</Th>{admin && <Th className="w-28 text-right">操作</Th>}</tr></thead>
          <tbody>
            {items.map((faq) => (
              <tr key={faq.id} className="hover:bg-background-lite">
                <Td className="max-w-sm"><span className="block truncate font-medium">{faq.question}</span><span className="block truncate text-xs text-muted">{faq.answer}</span></Td>
                <Td className="whitespace-nowrap text-muted">{faq.category || '—'}</Td>
                <Td><Chips items={faq.keywords} /></Td>
                <Td className="tabular-nums text-muted">{faq.priority}</Td>
                <Td>
                  {admin ? (
                    <Button size="sm" variant="ghost" onClick={() => void toggle(faq)} loading={busyId === faq.id} aria-label={faq.active ? `停用 ${faq.question}` : `啟用 ${faq.question}`}>
                      <Badge tone={faq.active ? 'good' : 'muted'}>{faq.active ? '啟用' : '停用'}</Badge>
                    </Button>
                  ) : <Badge tone={faq.active ? 'good' : 'muted'}>{faq.active ? '啟用' : '停用'}</Badge>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(faq.updated_at)}</Td>
                {admin && (
                  <Td className="text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(faq)}><Pencil size={13} /> 編輯</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => void remove(faq)} loading={busyId === faq.id} aria-label={`刪除 ${faq.question}`}><Trash2 size={13} /></Button>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && <FaqModal faq={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FaqModal({ faq, onClose }: { faq: Faq | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [form, setForm] = useState<FaqInput>(faq
    ? { question: faq.question, answer: faq.answer, category: faq.category, keywords: faq.keywords, priority: faq.priority, active: faq.active }
    : BLANK)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof FaqInput>(k: K, v: FaqInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.question.trim() || !form.answer.trim()) { toast('問題與答案都要填', 'err'); return }
    setSaving(true)
    try {
      if (faq) await updateFaq(faq.id, { ...form, expected_version: faq.version })
      else await createFaq(form)
      await invalidate('line-faqs')
      toast(faq ? '已更新' : '已新增')
      onClose()
    } catch (e) { toast(errMsg(e), 'err') } finally { setSaving(false) }
  }

  return (
    <Drawer onClose={saving ? () => {} : onClose} title={faq ? '編輯問題' : '新增問題'} subtitle="答案會原樣顯示在 LINE 的訊息泡泡裡。">
      <div className="space-y-3">
        <Field label="問題"><Input value={form.question} onChange={(e) => set('question', e.target.value)} placeholder="例如：補助什麼時候會撥款？" /></Field>
        <Field label="答案"><Textarea rows={5} value={form.answer} onChange={(e) => set('answer', e.target.value)} /></Field>
        <Field label="分類" hint="同一類的問題會排在 FAQ 選單的同一區。"><Input value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="關鍵字" hint="民眾打到其中一個字就可能命中這一題。">
          <TagInput value={form.keywords} onChange={(v) => set('keywords', v)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="優先權" hint="數字大的先回答。">
            <Input type="number" value={form.priority} onChange={(e) => set('priority', Number(e.target.value) || 0)} />
          </Field>
          <Field label="狀態">
            <Select value={form.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')} className="w-full">
              <option value="1">啟用</option>
              <option value="0">停用</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving}>{faq ? '儲存' : '新增'}</Button>
        </div>
      </div>
    </Drawer>
  )
}
