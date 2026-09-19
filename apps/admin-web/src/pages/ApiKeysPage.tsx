/** API Key 管理 — keys for API consumers (LINE bot, web chat …). */
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { del, get, patch, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useInvalidate } from '../lib/hooks'
import type { ApiKey } from '../lib/types'
import { Badge, Button, Empty, Field, Input, Modal, Spinner, confirmDialog, errMsg, useToast } from '../components/ui'
import { ApiUsageGuide } from '../components/admin/ApiUsageGuide'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../components/admin/shared'

export default function ApiKeysPage() {
  const { can } = useAuth()
  const toast = useToast()
  const invalidate = useInvalidate()
  const admin = can('admin')
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => get<ApiKey[]>('/api/api-keys'), enabled: admin })
  const [editing, setEditing] = useState<ApiKey | 'new' | null>(null)
  const [created, setCreated] = useState<ApiKey | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = async (k: ApiKey, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(k.id)
    try { await fn(); await invalidate('api-keys'); toast(ok) } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }
  const toggle = (k: ApiKey) => run(k, () => patch(`/api/api-keys/${k.id}`, { status: k.status === 'active' ? 'disabled' : 'active' }), k.status === 'active' ? '已停用 key' : '已啟用 key')
  const remove = (k: ApiKey) => {
    if (!confirmDialog(`確定要刪除 API key「${k.name}」？使用此 key 的整合會立即失效，且無法復原。`)) return
    void run(k, () => del(`/api/api-keys/${k.id}`), '已刪除 key')
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="API Key"
        description="給 LINE bot、網頁客服等程式呼叫對外 API 用。每把 key 可命名、可停用、有每分鐘速率限制；完整 key 只在建立當下顯示一次。"
        actions={admin && <Button variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> 新增 Key</Button>}
      />
      {!admin && <Notice tone="warn">只有 admin 以上可以管理 API key。</Notice>}
      {q.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {q.error && <Notice tone="warn">{errMsg(q.error)}</Notice>}
      {q.data && !q.data.length && <Empty>尚無 API key。點「新增 Key」建立第一把。</Empty>}
      {q.data && q.data.length > 0 && (
        <Table>
          <thead><tr><Th>名稱</Th><Th>Key</Th><Th>狀態</Th><Th>速率限制</Th><Th>最後使用</Th><Th>建立時間</Th><Th className="text-right">操作</Th></tr></thead>
          <tbody>
            {q.data.map((k) => (
              <tr key={k.id} className="hover:bg-background-lite">
                <Td className="whitespace-nowrap font-medium">{k.name}</Td>
                <Td className="font-mono text-xs text-muted">{k.prefix}…</Td>
                <Td><Badge tone={k.status === 'active' ? 'good' : 'danger'}>{k.status === 'active' ? '啟用' : '停用'}</Badge></Td>
                <Td className="whitespace-nowrap text-muted">{k.rate_limit_per_minute} 次/分</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(k.last_used_at)}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(k.created_at)}</Td>
                <Td className="text-right">
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant={k.status === 'active' ? 'default' : 'good'} onClick={() => toggle(k)} loading={busyId === k.id}>{k.status === 'active' ? '停用' : '啟用'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(k)} title="編輯"><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(k)} disabled={busyId === k.id} title="刪除"><Trash2 size={13} /></Button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ApiUsageGuide />
      {editing && <KeyModal apiKey={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={(k) => { setEditing(null); setCreated(k) }} />}
      {created && <PlaintextModal apiKey={created} onClose={() => setCreated(null)} />}
    </div>
  )
}

function KeyModal({ apiKey, onClose, onCreated }: { apiKey: ApiKey | null; onClose: () => void; onCreated: (k: ApiKey) => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [name, setName] = useState(apiKey?.name ?? '')
  const [rate, setRate] = useState(String(apiKey?.rate_limit_per_minute ?? 120))
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    const n = Number(rate)
    if (!name.trim()) { toast('請填寫名稱', 'err'); return }
    if (!Number.isInteger(n) || n <= 0) { toast('速率限制需為正整數', 'err'); return }
    setSaving(true)
    try {
      if (apiKey) {
        await patch(`/api/api-keys/${apiKey.id}`, { name: name.trim(), rate_limit_per_minute: n })
        await invalidate('api-keys')
        toast('已更新 key')
        onClose()
      } else {
        const k = await post<ApiKey>('/api/api-keys', { name: name.trim(), rate_limit_per_minute: n })
        await invalidate('api-keys')
        onCreated(k)
      }
    } catch (e) { toast(errMsg(e), 'err') } finally { setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={apiKey ? `編輯 Key：${apiKey.name}` : '新增 API Key'}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-3">
        <Field label="名稱" hint="標示用途或呼叫方，例如「LINE 官方帳號」">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="LINE 官方帳號" />
        </Field>
        <Field label="速率限制（每分鐘請求數）" hint="超過時 API 回傳 rate_limited 錯誤碼">
          <Input type="number" min={1} step={1} value={rate} onChange={(e) => setRate(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={saving}>{apiKey ? '儲存' : '建立'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function PlaintextModal({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const key = apiKey.plaintext ?? ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { toast('無法存取剪貼簿，請手動選取複製', 'err') }
  }
  const close = () => { if (confirmDialog('關閉後將無法再次查看完整 key，確定已妥善保存？')) onClose() }
  return (
    <Modal open onClose={close} title={`已建立 API Key：${apiKey.name}`} width={560}>
      <div className="space-y-3">
        <Notice tone="warn"><strong>這把 key 只會顯示這一次。</strong>請立即複製並存放在安全處（例如 secret manager）；關閉後系統只保留前綴，無法再取回。</Notice>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background-lite p-2">
          <code className="flex-1 select-all break-all font-mono text-xs leading-5">{key || '（後端未回傳 plaintext）'}</code>
          <Button size="sm" variant={copied ? 'good' : 'primary'} onClick={copy} disabled={!key}>{copied ? <><Check size={13} /> 已複製</> : <><Copy size={13} /> 複製</>}</Button>
        </div>
        <div className="text-xs text-muted">使用方式：在每個請求加上 header <code className="rounded bg-background px-1 font-mono">X-API-Key: {key ? `${apiKey.prefix}…` : ''}</code>，詳見下方「如何使用」。</div>
        <div className="flex justify-end"><Button variant="primary" onClick={close}>我已保存，關閉</Button></div>
      </div>
    </Modal>
  )
}
