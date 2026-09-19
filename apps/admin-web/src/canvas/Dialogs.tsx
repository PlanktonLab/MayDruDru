/**
 * The editor's dialogs — the settings that used to live in side panels.
 * They are reached from the switcher at the top and close back to the canvas:
 *
 *  - 平台設定: identity, 示範資料, 共用區塊, 平台風格 (four tabs);
 *  - 新增平台 / 新增流程: two fields and one button each;
 *  - 流程設定: name, the documents its 終點 deliver, versions and rollback;
 *  - 目標文件: the tenant-wide list, edited in place.
 *
 * Which document a flow delivers is not a setting here: it is written on the
 * flow's 終點 steps, on the canvas, so one flow can fork towards several.
 *
 * Fields save on blur like everywhere else in the editor.
 */

import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, ChevronLeft, FileText, Plus } from 'lucide-react'
import { get, patch } from '../lib/api'
import { CHANNEL_LABEL, type Channel, type DemoDataField, type Flow, type FlowVersion, type Goal, type Platform, type StyleDoc } from '../lib/types'
import { isCommitEnter } from '../lib/keys'
import { TagInput } from '../components/admin/TagInput'
import { Components, DemoData, fmtDate } from '../components/platform/PlatformParts'
import { Button, EmptyState, Input, Modal, Select, Skeleton, confirm, errMsg, useToast } from '../components/ui'
import { Picker, TextField } from './fields'
import { useEditor } from './context'

export function Dialogs() {
  const ed = useEditor()
  const d = ed.dialog
  const close = () => ed.openDialog(null)
  if (!d) return null
  if (d.kind === 'new-platform') return <NewPlatformDialog onClose={close} />
  if (d.kind === 'new-flow') return <NewFlowDialog platformId={d.platformId} onClose={close} />
  if (d.kind === 'goals') return <GoalsDialog onClose={close} />
  if (d.kind === 'flow') {
    const flow = ed.data.flows.find((f) => f.id === d.id)
    return flow ? <FlowDialog flow={flow} onClose={close} /> : null
  }
  const platform = ed.data.platforms.find((p) => p.id === d.id)
  return platform ? <PlatformDialog platform={platform} initialTab={d.tab} onClose={close} /> : null
}

/* ------------------------------------------------------------ small forms */

const Label = ({ children, hint }: { children: ReactNode; hint?: ReactNode }) => (
  <div className="mb-1 flex items-baseline justify-between">
    <span className="text-[12px] font-medium text-muted">{children}</span>
    {hint && <span className="text-[11px] text-secondary">{hint}</span>}
  </div>
)

function NewPlatformDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor()
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('mobile_app')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    const p = await ed.actions.createPlatform({ display_name: n, brand: n, channel })
    setBusy(false)
    if (!p) return
    // Straight on to the first flow — a platform with nothing in it is not a place to stop.
    ed.openDialog({ kind: 'new-flow', platformId: p.id })
  }
  return (
    <Modal open onClose={onClose} title="新增平台" subtitle="民眾操作的 App 或網站。" width={420}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div>
          <Label>名稱</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：市民服務 App" />
        </div>
        <div>
          <Label>類型</Label>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="w-full">
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>建立</Button>
        </div>
      </form>
    </Modal>
  )
}

function NewFlowDialog({ platformId, onClose }: { platformId: string; onClose: () => void }) {
  const ed = useEditor()
  const platform = ed.data.platforms.find((p) => p.id === platformId)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    const f = await ed.actions.createFlow({ platform_id: platformId, name: n })
    setBusy(false)
    if (!f) return
    onClose()
    ed.openFlow(f.id)
  }

  return (
    <Modal open onClose={onClose} title="新增流程" subtitle={platform ? `在 ${platform.display_name} 上的操作步驟。要取得哪些文件，之後在流程的終點指定。` : undefined} width={420}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div>
          <Label>名稱</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：申請補助" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>建立並開啟</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------------------------------------------------------------- flow */

function FlowDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const ed = useEditor()
  const { editable, canReview, actions } = ed
  const versions = useQuery({ queryKey: ['flow-versions', flow.id], queryFn: () => get<FlowVersion[]>(`/api/flows/${flow.id}/versions`) })
  const published = flow.status === 'published'

  const remove = async () => {
    if (!await confirm({ title: `刪除流程「${flow.name}」？`, body: '裡面的步驟、截圖與教學圖都會一併刪除，無法復原。', action: '刪除', danger: true })) return
    onClose()
    // The editor falls back to the first remaining flow once this one is gone.
    void actions.deleteFlow(flow.id)
  }

  return (
    <Modal open onClose={onClose} title="流程設定" width={440}>
      <div className="space-y-4">
        <div>
          <Label>名稱</Label>
          <TextField value={flow.name} onSave={(v) => void actions.patchFlow(flow.id, { name: v })} disabled={!editable} placeholder="流程名稱" required />
        </div>
        <div>
          <Label hint={ed.isAdmin && <button type="button" onClick={() => ed.openDialog({ kind: 'goals' })} className="text-accent hover:underline underline-offset-4">管理…</button>}>可取得的文件</Label>
          <FlowGoals flow={flow} />
        </div>

        <div className="border-t border-border pt-4">
          <Label>發布紀錄</Label>
          {versions.isLoading && <div className="space-y-1.5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" /></div>}
          {versions.data?.length === 0 && <p className="text-[13px] text-secondary">還沒發布過。右上角的「發布」會產生第一個版本。</p>}
          {!!versions.data?.length && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {versions.data.map((v) => {
                const current = published && v.id === flow.current_version_id
                return (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={clsx('font-medium tabular-nums', current ? 'text-good' : 'text-primary')}>v{v.version}</span>
                      <span className="truncate text-muted">{fmtDate(v.created_at)} · {v.step_count} 步</span>
                    </span>
                    {current
                      ? <span className="flex items-center gap-1 text-[12px] text-good"><Check size={12} /> 使用中</span>
                      : canReview && <button type="button" onClick={() => void actions.rollbackFlow(flow.id, v.id)} className="text-[12px] text-accent hover:underline underline-offset-4">切回這版</button>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {editable && (
          <div className="border-t border-border pt-3">
            <button type="button" onClick={() => void remove()} className="text-[13px] text-danger hover:opacity-80">刪除這條流程</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** The documents a flow hands out — read off its 終點 steps, so the place to change it is the canvas. */
function FlowGoals({ flow }: { flow: Flow }) {
  const { data } = useEditor()
  const names = flow.goal_ids.map((id) => data.goals.find((g) => g.id === id)?.name).filter((n): n is string => !!n)
  const ends = data.steps.filter((s) => s.flow_id === flow.id && s.is_end)
  const missing = ends.filter((s) => !s.goal_id).length
  return (
    <div className="text-[13px] leading-5">
      {names.length ? <span>{names.join('、')}</span> : <span className="text-secondary">尚未指定</span>}
      <p className="mt-0.5 text-[12px] text-secondary">
        {missing ? `有 ${missing} 個終點還沒指定文件。` : ''}由流程的終點決定：選取畫布上的終點卡片即可指定或更換。
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- goals */

function GoalsDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor()
  const goals = ed.data.goals
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const goal = goals.find((g) => g.id === picked) ?? null
  const editable = ed.isAdmin

  const add = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    const g = await ed.actions.createGoal({ name: n, description: '', aliases: [] })
    setBusy(false)
    if (g) { setName(''); setPicked(g.id) }
  }
  const save = (g: Goal, body: Partial<Omit<Goal, 'id'>>) => { void ed.actions.updateGoal(g.id, { name: g.name, description: g.description, aliases: g.aliases, ...body }) }
  const remove = async (g: Goal) => {
    if (!await confirm({ title: `刪除目標文件「${g.name}」？`, body: '指向它的流程會失去目標，需要重新指定。', action: '刪除', danger: true })) return
    setPicked(null)
    void ed.actions.deleteGoal(g.id)
  }

  return (
    <Modal open onClose={onClose} title={goal ? undefined : '目標文件'} subtitle={goal ? undefined : '民眾最後要拿到的東西。流程的每個終點指向其中一種。'} width={460}>
      {goal ? (
        <div className="space-y-4 pt-5">
          <button type="button" onClick={() => setPicked(null)} className="-ml-1 flex items-center gap-1 text-[13px] text-muted hover:text-primary"><ChevronLeft size={14} /> 目標文件</button>
          <div>
            <Label>名稱</Label>
            <TextField value={goal.name} disabled={!editable} placeholder="例如：交易明細" required onSave={(v) => save(goal, { name: v })} />
          </div>
          <div>
            <Label>說明</Label>
            <TextField value={goal.description} disabled={!editable} multiline rows={3} placeholder="給承辦人員與 AI 意圖判讀看的說明" onSave={(v) => save(goal, { description: v })} />
          </div>
          <div>
            <Label hint="民眾可能怎麼稱呼它">別名</Label>
            <TagInput value={goal.aliases} disabled={!editable} onChange={(aliases) => save(goal, { aliases })} placeholder="例如：匯款紀錄" />
          </div>
          {editable && <button type="button" onClick={() => void remove(goal)} className="text-[13px] text-danger hover:opacity-80">刪除這種目標文件</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {goals.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {goals.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => setPicked(g.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-background-lite">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{g.name}</span>
                      {g.description && <span className="block truncate text-[12px] text-muted">{g.description}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-secondary">{g.aliases.length ? `${g.aliases.length} 個別名` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<FileText size={18} />} title="還沒有目標文件" hint="先加一種，例如「交易明細」。" className="py-4" />
          )}
          {editable && (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新的目標文件名稱" onKeyDown={(e) => { if (isCommitEnter(e)) void add() }} />
              <Button variant="primary" onClick={() => void add()} loading={busy} disabled={!name.trim()}><Plus size={14} /> 新增</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------- platform */

type PTab = 'basics' | 'demo' | 'components' | 'style'
const PTABS: { v: PTab; label: string }[] = [
  { v: 'basics', label: '基本' }, { v: 'demo', label: '示範資料' }, { v: 'components', label: '共用區塊' }, { v: 'style', label: '平台風格' },
]
function PlatformDialog({ platform, initialTab, onClose }: { platform: Platform; initialTab?: PTab; onClose: () => void }) {
  const ed = useEditor()
  const { editable, isAdmin, actions } = ed
  const [tab, setTab] = useState<PTab>(initialTab ?? 'basics')
  const save = (body: Parameters<typeof actions.patchPlatform>[1]) => { void actions.patchPlatform(platform.id, body) }

  const remove = async () => {
    if (!await confirm({ title: `刪除平台「${platform.display_name}」？`, body: '底下所有流程、步驟與教學圖都會一併刪除，無法復原。', action: '刪除平台', danger: true })) return
    onClose()
    void actions.deletePlatform(platform.id)
  }

  return (
    <Modal open onClose={onClose} title={platform.display_name} subtitle={CHANNEL_LABEL[platform.channel]} width={560} padded={false}>
      <div className="flex gap-1 border-b border-border px-5">
        {PTABS.map((t) => (
          <button
            key={t.v} type="button" role="tab" aria-selected={tab === t.v} onClick={() => setTab(t.v)}
            className={clsx('-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[13px] transition-colors', tab === t.v ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-primary')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-5">
        {tab === 'basics' && <Basics platform={platform} editable={editable} save={save} onDelete={isAdmin ? remove : undefined} />}
        {tab === 'demo' && <DemoData platform={platform} disabled={!editable} onSave={(demo_data: DemoDataField[]) => save({ demo_data })} />}
        {tab === 'components' && <Components platform={platform} />}
        {tab === 'style' && <StyleDocTab platformId={platform.id} version={platform.style_doc_version} editable={editable} />}
      </div>
    </Modal>
  )
}

function Basics({ platform, editable, save, onDelete }: { platform: Platform; editable: boolean; save: (b: Partial<{ display_name: string; brand: string; channel: Channel; aliases: string[] }>) => void; onDelete?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>顯示名稱</Label>
          <TextField value={platform.display_name} onSave={(v) => save({ display_name: v })} disabled={!editable} placeholder="顯示名稱" required />
        </div>
        <div>
          <Label hint="同品牌的平台會分在一組">品牌</Label>
          <TextField value={platform.brand} onSave={(v) => save({ brand: v })} disabled={!editable} placeholder="品牌" required />
        </div>
        <div>
          <Label>類型</Label>
          <Picker value={platform.channel} disabled={!editable} onChange={(v) => save({ channel: v as Channel })}>
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </Picker>
        </div>
      </div>
      <div>
        <Label hint="民眾可能怎麼稱呼它，幫 AI 認出平台">別名</Label>
        <TagInput value={platform.aliases} disabled={!editable} onChange={(v) => save({ aliases: v })} placeholder="例如：citizen" />
      </div>
      {onDelete && (
        <div className="border-t border-border pt-3">
          <button type="button" onClick={onDelete} className="text-[13px] text-danger hover:opacity-80">刪除這個平台</button>
        </div>
      )}
    </div>
  )
}

/* ---- style doc (平台風格) */

const asText = (v: unknown): string => {
  if (v == null || v === '') return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('、')
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${asText(x)}`).join('；')
  return String(v)
}

function StyleDocTab({ platformId, version, editable }: { platformId: string; version: number; editable: boolean }) {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['style-doc', platformId], queryFn: () => get<StyleDoc>(`/api/platforms/${platformId}/style-doc`) })
  const saveNotes = async (human_notes: string) => {
    try {
      await patch(`/api/platforms/${platformId}/style-doc`, { human_notes })
      await Promise.all([qc.invalidateQueries({ queryKey: ['style-doc', platformId] }), qc.invalidateQueries({ queryKey: ['platforms'] }), qc.invalidateQueries({ queryKey: ['canvas'] })])
    } catch (e) { toast(errMsg(e), 'err') }
  }
  const summary = q.data ? asText(q.data.ai_generated.summary) : ''
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-5 text-muted">AI 從已通過的畫面歸納出這個平台長什麼樣子，用來從民眾的截圖認出平台。你可以在下面補充它沒看出來的地方。</p>
      <div>
        <Label hint={`第 ${q.data?.version ?? version} 版`}>AI 的觀察</Label>
        {q.isLoading ? <div className="space-y-1.5"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>
          : q.error ? <p className="text-[13px] text-danger">{errMsg(q.error)}</p>
            : <p className="rounded-lg bg-background px-3 py-2.5 text-[13px] leading-5 text-primary">{summary || <span className="text-secondary">第一張畫面審核通過後，這裡會出現 AI 的摘要。</span>}</p>}
      </div>
      {q.data && (
        <div>
          <Label hint="AI 不會改動這段">人工補充</Label>
          <TextField value={q.data.human_notes} disabled={!editable} multiline rows={4} placeholder="例如：主色是深綠色，底部有五個分頁" onSave={(v) => void saveNotes(v)} />
        </div>
      )}
    </div>
  )
}

