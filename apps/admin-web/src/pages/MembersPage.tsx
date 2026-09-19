/** 成員管理 — tenant users and their roles. */
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { del, get, patch, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useInvalidate } from '../lib/hooks'
import { ROLE_LABEL, type Role, type Tenant, type User } from '../lib/types'
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, confirmDialog, errMsg, useToast } from '../components/ui'
import { Notice, PageHeader, Table, Td, Th } from '../components/admin/shared'

const ROLES: Role[] = ['owner', 'admin', 'editor', 'reviewer', 'viewer']
const ROLE_DESC: Record<Role, string> = {
  owner: 'tenant 所有權限，管理計費與成員',
  admin: '管理成員、API key、goal 清單、平台；可看未審核原圖；可用進階功能',
  editor: '建立與編輯平台、flow、step；上傳截圖、框焦點、畫標註',
  reviewer: '審核復刻結果、發布 flow',
  viewer: '唯讀，含儀表板',
}
const roleTone = (r: Role): 'accent' | 'good' | 'warn' | 'muted' => (r === 'owner' ? 'accent' : r === 'admin' ? 'warn' : r === 'viewer' ? 'muted' : 'good')

export default function MembersPage() {
  const { user, can } = useAuth()
  const toast = useToast()
  const invalidate = useInvalidate()
  const q = useQuery({ queryKey: ['members'], queryFn: () => get<User[]>('/api/members') })
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => get<Tenant>('/api/tenant') })
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const admin = can('admin')
  const isOwner = user?.role === 'owner'
  /** owner can assign any role; admin cannot assign / touch owner */
  const assignable = isOwner ? ROLES : ROLES.filter((r) => r !== 'owner')

  const remove = async (m: User) => {
    if (!confirmDialog(`確定要刪除成員「${m.name || m.email}」？此動作無法復原。`)) return
    setBusyId(m.id)
    try {
      await del(`/api/members/${m.id}`)
      await invalidate('members')
      toast('已刪除成員')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="成員"
        description={<>{tenant.data ? <>租戶 <strong className="text-primary">{tenant.data.name}</strong>（{tenant.data.slug}）的後台使用者。</> : '後台使用者。'} 每位成員只有一個角色；停用的成員無法登入但保留紀錄。</>}
        actions={admin && <Button variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> 新增成員</Button>}
      />
      {!admin && <Notice tone="warn">只有 admin 以上可以管理成員。</Notice>}
      {q.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {q.error && <Notice tone="warn">{errMsg(q.error)}</Notice>}
      {q.data && !q.data.length && <Empty>尚無成員</Empty>}
      {q.data && q.data.length > 0 && (
        <Table>
          <thead><tr><Th>名稱</Th><Th>Email</Th><Th>角色</Th><Th>狀態</Th>{admin && <Th className="w-28 text-right">操作</Th>}</tr></thead>
          <tbody>
            {q.data.map((m) => {
              const self = m.id === user?.id
              const locked = m.role === 'owner' && !isOwner
              return (
                <tr key={m.id} className="hover:bg-background-lite">
                  <Td className="whitespace-nowrap font-medium">{m.name || <span className="text-secondary">（未命名）</span>}{self && <span className="ml-1.5 text-[11px] text-muted">（你）</span>}</Td>
                  <Td className="font-mono text-xs text-muted">{m.email}</Td>
                  <Td><Badge tone={roleTone(m.role)}>{ROLE_LABEL[m.role]}</Badge></Td>
                  <Td><Badge tone={m.is_active ? 'good' : 'danger'}>{m.is_active ? '啟用' : '停用'}</Badge></Td>
                  {admin && (
                    <Td className="text-right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)} disabled={locked} title={locked ? '只有 owner 能變更 owner' : '編輯'}><Pencil size={13} /> 編輯</Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(m)} loading={busyId === m.id} disabled={m.role === 'owner' || self} title={m.role === 'owner' ? '不能刪除 owner' : self ? '不能刪除自己' : '刪除'}><Trash2 size={13} /></Button>
                      </span>
                    </Td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <Card title="角色說明">
        <div className="divide-y divide-border">
          {ROLES.map((r) => (
            <div key={r} className="grid grid-cols-[90px_1fr] items-center gap-3 py-1.5 text-sm">
              <Badge tone={roleTone(r)} className="justify-self-start">{ROLE_LABEL[r]}</Badge>
              <span className="text-muted">{ROLE_DESC[r]}</span>
            </div>
          ))}
        </div>
      </Card>
      {editing && <MemberModal member={editing === 'new' ? null : editing} assignable={assignable} self={editing !== 'new' && editing.id === user?.id} onClose={() => setEditing(null)} />}
    </div>
  )
}

const MIN_PASSWORD = 12

interface MemberForm { email: string; name: string; role: Role; password: string; is_active: boolean }

function MemberModal({ member, assignable, self, onClose }: { member: User | null; assignable: Role[]; self: boolean; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [form, setForm] = useState<MemberForm>(member
    ? { email: member.email, name: member.name, role: member.role, password: '', is_active: member.is_active }
    : { email: '', name: '', role: 'viewer', password: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const roleOptions = member && !assignable.includes(member.role) ? [member.role, ...assignable] : assignable

  const submit = async () => {
    if (!member && (!form.email.trim() || !form.password)) { toast('請填寫 Email 與密碼', 'err'); return }
    if (form.password && form.password.length < MIN_PASSWORD) { toast(`密碼至少 ${MIN_PASSWORD} 個字元`, 'err'); return }
    setSaving(true)
    try {
      if (member) {
        const body: Record<string, unknown> = {}
        if (form.name !== member.name) body.name = form.name
        if (form.role !== member.role) body.role = form.role
        if (form.is_active !== member.is_active) body.is_active = form.is_active
        if (form.password) body.password = form.password
        if (!Object.keys(body).length) { onClose(); return }
        await patch(`/api/members/${member.id}`, body)
      } else {
        await post('/api/members', { email: form.email.trim(), name: form.name, role: form.role, password: form.password })
      }
      await invalidate('members')
      toast(member ? '已更新成員' : '已新增成員')
      onClose()
    } catch (e) { toast(errMsg(e), 'err') } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={member ? `編輯成員：${member.name || member.email}` : '新增成員'}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-3">
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!member} required={!member} autoFocus={!member} placeholder="name@example.com" />
        </Field>
        <Field label="名稱">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="王小明" />
        </Field>
        <Field label="角色" hint={self ? '變更自己的角色後，部分頁面可能立即無法存取。' : ROLE_DESC[form.role]}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="w-full">
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label={member ? '重設密碼（選填）' : '密碼'} hint={`至少 ${MIN_PASSWORD} 個字元；請以安全管道告知成員`}>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!member} minLength={MIN_PASSWORD} autoComplete="new-password" placeholder={member ? '留空則不變更' : ''} />
        </Field>
        {member && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} disabled={self} className="h-4 w-4 accent-[var(--accent)]" />
            啟用帳號{self && <span className="text-[11px] text-muted">（不能停用自己）</span>}
          </label>
        )}
        {member && !self && !form.is_active && <Notice tone="warn">停用後此成員將無法登入，但既有的 flow 與紀錄會保留。</Notice>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={saving}>{member ? '儲存' : '建立'}</Button>
        </div>
      </form>
    </Modal>
  )
}
