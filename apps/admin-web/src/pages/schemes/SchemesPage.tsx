/**
 * 方案清單（SPEC §8.2「方案管理」）。
 *
 * 一列一個方案：收不收件、屬於哪一類、申請期間到什麼時候。「新增方案」只問代碼與
 * 名稱兩件事，其餘在編輯器裡慢慢填——一張要填二十格才建得起來的表單，只會讓人先
 * 去問工程師能不能幫忙 insert 一筆。
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Settings2 } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import { Badge, Button, Empty, Field, Input, Modal, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th } from '../../components/admin/shared'
import { createScheme, fetchSchemes } from './queries'
import type { SchemeRow } from './types'

/** 申請期間的一句話。兩端都沒填就是「沒有期限」，那不是缺資料，是真的沒期限。 */
export function windowText(start: string | null, end: string | null): string {
  if (!start && !end) return '沒有期限'
  if (start && end) return `${start} ～ ${end}`
  return start ? `${start} 起` : `即日起至 ${end}`
}

export default function SchemesPage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ code: '', name: '' })

  const query = useQuery({ queryKey: ['schemes'], queryFn: fetchSchemes })
  const rows = query.data ?? []

  const add = async () => {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) { toast('方案代碼與名稱都要填', 'err'); return }
    setBusy(true)
    try {
      await createScheme({ code, name })
      await invalidate('schemes')
      setAdding(false)
      setForm({ code: '', name: '' })
      navigate(`/schemes/${encodeURIComponent(code)}`)
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="方案"
        description="一個方案把機關的一項補助整個資料化：級距、文件、繳費管道、審核規則、退件碼。新增一個方案不需要改程式。"
        actions={admin && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> 新增方案</Button>}
      />

      {query.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
      {query.data && !rows.length && <Empty>還沒有任何方案</Empty>}

      {!!rows.length && (
        <Table>
          <thead>
            <tr>
              <Th className="w-32">代碼</Th>
              <Th>名稱</Th>
              <Th className="w-28">類別</Th>
              <Th className="w-56">申請期間</Th>
              <Th className="w-24">收件中</Th>
              <Th className="w-24 text-right">設定</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: SchemeRow) => (
              <tr key={row.id} className="hover:bg-background-lite">
                <Td className="font-mono text-xs">{row.code}</Td>
                <Td><Link className="text-accent underline" to={`/schemes/${encodeURIComponent(row.code)}`}>{row.name}</Link></Td>
                <Td>{row.category || '—'}</Td>
                <Td className="text-xs text-muted">{windowText(row.application_start, row.application_end)}</Td>
                <Td>{row.active ? <Badge tone="good">收件中</Badge> : <Badge tone="muted">已關閉</Badge>}</Td>
                <Td className="text-right">
                  <Link to={`/schemes/${encodeURIComponent(row.code)}`} aria-label={`設定 ${row.code}`}>
                    <Button size="sm" variant="ghost"><Settings2 size={13} /> 設定</Button>
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="新增方案"
             subtitle="先給代碼與名稱，其餘設定在編輯頁慢慢填。">
        <div className="space-y-3">
          <Field label="方案代碼" hint="英數與底線，之後不建議更動；送件網址與案件資料都會用到它">
            <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          </Field>
          <Field label="方案名稱">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void add()}>建立</Button>
        </div>
      </Modal>
    </div>
  )
}
