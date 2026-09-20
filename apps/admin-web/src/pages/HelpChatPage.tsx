import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { get, put } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Input, Spinner, errMsg } from '../components/ui'
import { Notice, PageHeader } from '../components/admin/shared'

type Settings = { enabled: boolean; per_minute: number; per_day: number; tenant_per_day: number; max_question_chars: number; max_results: number; version: number }
const fields = [
  ['per_minute', '每個 IP 每分鐘詢問上限', 1, 60],
  ['per_day', '每個 IP 每日詢問上限', 1, 1000],
  ['tenant_per_day', '整個機關每日詢問上限', 1, 100000],
  ['max_question_chars', '單次問題字數上限', 20, 1000],
  ['max_results', '每次最多回覆幾則 FAQ', 1, 3],
] as const
export default function HelpChatPage() {
  const { can } = useAuth()
  const query = useQuery({ queryKey: ['help-chat-settings'], queryFn: () => get<Settings>('/api/admin/help-chat') })
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const data = draft ?? query.data
  async function save() {
    if (!data) return
    setBusy(true); setMessage('')
    try { setDraft(await put<Settings>('/api/admin/help-chat', data)); await query.refetch(); setMessage('已儲存設定') }
    catch (error) { setMessage(errMsg(error)) }
    finally { setBusy(false) }
  }
  return <div className="max-w-3xl space-y-5 p-6">
    <PageHeader title="申請端機器人" description="文件助手從已啟用的常見問題找答案。沒有生成模型呼叫或額外模型費用，也不會讀取申請文件。" />
    <p className="text-sm text-muted">每日額度以 UTC 零時（台灣上午 8 時）重置；同一網路的使用者共用 IP 額度。超過上限或計數服務故障時暫停回答。</p>
    <div className="flex gap-4 text-sm text-accent"><Link to="/line/faqs">維護回答與關鍵字</Link><Link to="/line/contents">調整助手提示文案</Link></div>
    {query.isLoading && <Spinner />}
    {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
    {message && <p role="status">{message}</p>}
    {data && <form onSubmit={(event) => { event.preventDefault(); void save() }} className="space-y-5 rounded-xl border border-border bg-canvas p-5">
      <fieldset disabled={!can('admin') || busy} className="space-y-5">
        <label className="flex gap-3"><input type="checkbox" checked={data.enabled} onChange={(event) => setDraft({ ...data, enabled: event.target.checked })} />啟用申請文件助手</label>
        {fields.map(([key, label, min, max]) => <label key={key} className="grid gap-2 text-sm">{label}<Input type="number" required min={min} max={max} step={1} value={data[key]} onChange={(event) => setDraft({ ...data, [key]: Number(event.target.value) })} /></label>)}
        {can('admin') && <Button type="submit" variant="primary" loading={busy}>儲存設定</Button>}
      </fieldset>
    </form>}
  </div>
}
