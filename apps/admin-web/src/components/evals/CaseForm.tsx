/** Add an eval case: screenshot + expected platform / step / goal + optional citizen text. */
import { clsx } from 'clsx'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { upload } from '../../lib/api'
import { useCanvas, useGoals, useInvalidate, usePlatforms } from '../../lib/hooks'
import type { EvalCase } from '../../lib/types'
import { Button, Field, Input, Select, Textarea, errMsg, useToast } from '../ui'

export default function CaseForm() {
  const toast = useToast()
  const invalidate = useInvalidate()
  const platforms = usePlatforms()
  const goals = useGoals()
  const canvas = useCanvas()
  const [picked, setPicked] = useState<{ file: File; preview: string } | null>(null)
  const file = picked?.file ?? null
  const preview = picked?.preview ?? null
  const [dragging, setDragging] = useState(false)
  const [platformId, setPlatformId] = useState('')
  const [flowId, setFlowId] = useState('')
  const [stepId, setStepId] = useState('')
  const [goalId, setGoalId] = useState('')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** Object URLs are created in the event handler and revoked when replaced / cleared / unmounted. */
  const setFile = (f: File | null) => {
    const next = f ? { file: f, preview: URL.createObjectURL(f) } : null
    setPicked((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return next })
  }
  useEffect(() => () => setPicked((prev) => { if (prev) URL.revokeObjectURL(prev.preview); return null }), [])

  const flows = useMemo(() => (canvas.data?.flows ?? []).filter((f) => f.platform_id === platformId), [canvas.data, platformId])
  const steps = useMemo(() => (canvas.data?.steps ?? []).filter((s) => s.flow_id === flowId), [canvas.data, flowId])
  const goalNames = useMemo(() => new Map((goals.data ?? []).map((g) => [g.id, g.name])), [goals.data])

  const onPlatform = (v: string) => { setPlatformId(v); setFlowId(''); setStepId('') }
  const onFlow = (v: string) => {
    setFlowId(v); setStepId('')
    const f = flows.find((x) => x.id === v)
    if (f && !goalId && f.goal_ids[0]) setGoalId(f.goal_ids[0])
  }
  const pick = (f: File | undefined) => { if (f && f.type.startsWith('image/')) setFile(f); else if (f) toast('請選擇圖片檔', 'err') }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]) }

  const submit = async () => {
    if (!file) return toast('請先選擇截圖', 'err')
    if (!platformId) return toast('請選擇正確的平台', 'err')
    setSaving(true)
    try {
      await upload<EvalCase>('/api/evals/cases', file, { platform_id: platformId, step_id: stepId, goal_id: goalId, text: text.trim(), note: note.trim() })
      toast('已新增評測樣本')
      setFile(null); setText(''); setNote(''); setStepId('')
      if (fileRef.current) fileRef.current.value = ''
      await invalidate('eval-cases')
    } catch (e) { toast(errMsg(e), 'err') } finally { setSaving(false) }
  }

  return (
    <form className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        onClick={() => !file && fileRef.current?.click()}
        className={clsx('relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center text-xs text-muted',
          dragging ? 'border-accent bg-accent-bg' : 'border-border bg-background', !file && 'cursor-pointer hover:border-accent')}
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {preview ? (
          <>
            <img src={preview} alt="預覽" className="max-h-[300px] w-full object-contain" />
            <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
              className="absolute right-1.5 top-1.5 rounded-full bg-canvas p-1 text-muted hover:text-danger" style={{ boxShadow: 'var(--shadow-menu)' }} title="移除"><X size={13} /></button>
          </>
        ) : (
          <div className="space-y-1 p-4"><ImagePlus size={22} className="mx-auto" /><div>拖放或點擊選擇測試截圖</div><div className="text-[11px] text-secondary">PNG / JPG / WebP</div></div>
        )}
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="正確的平台 *">
            <Select className="w-full" value={platformId} onChange={(e) => onPlatform(e.target.value)} required>
              <option value="">請選擇</option>
              {(platforms.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </Select>
          </Field>
          <Field label="Flow">
            <Select className="w-full" value={flowId} onChange={(e) => onFlow(e.target.value)} disabled={!platformId}>
              <option value="">{platformId ? (flows.length ? '請選擇' : '此平台尚無 flow') : '先選平台'}</option>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}{f.goal_ids.length ? `（${f.goal_ids.map((g) => goalNames.get(g) ?? g).join('、')}）` : ''}</option>)}
            </Select>
          </Field>
          <Field label="正確的步驟" hint="不填則此樣本只評平台層準確率">
            <Select className="w-full" value={stepId} onChange={(e) => setStepId(e.target.value)} disabled={!flowId}>
              <option value="">{flowId ? '不指定' : '先選 flow'}</option>
              {steps.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
          </Field>
          <Field label="Goal（選填）" hint="搭配文字評意圖解析的 goal 準確率">
            <Select className="w-full" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">不指定</option>
              {(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="民眾可能會說的文字（選填）" hint="有填才會評意圖解析；例如「我要在市民 App 下載繳費證明」">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="備註"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：iPhone 深色模式、有彈窗" /></Field>
          <Button type="submit" variant="primary" loading={saving} disabled={!file || !platformId}>新增樣本</Button>
        </div>
      </div>
    </form>
  )
}
