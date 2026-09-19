/** `/sop` 與 `/sop/:flow` — 公開的逐步 SOP 教學（SPEC §8.1 / §8.5）。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Expand, ImageUp, Map, ShieldCheck, X } from 'lucide-react'
import { Button, Card, EmptyState, Spinner } from '@maydru/ui'
import { MaskEditor } from '@maydru/mask-editor'
import { disposeAll, encodePages, prepareFile } from '../apply/pipeline'
import { getJson } from '../lib/api'
import {
  fetchSopDocumentTypes,
  fetchSopFlows,
  fetchSopPlatforms,
  fetchSopSteps,
  locateSopScreenshot,
  type SopMessage,
} from '../lib/queries'

const CHANNEL_LABEL = { mobile_app: '手機 App', web: '網頁版', desktop: '電腦版' } as const

export default function SopPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { flow: routeFlow = '' } = useParams()
  const documentType = params.get('document_type') ?? ''
  const platformId = params.get('platform_id') ?? ''
  const scheme = params.get('scheme') ?? ''
  const rejectionCode = params.get('rejection_code') ?? ''

  const documents = useQuery({ queryKey: ['sop', 'document-types'], queryFn: fetchSopDocumentTypes })
  const platforms = useQuery({ queryKey: ['sop', 'platforms'], queryFn: fetchSopPlatforms })
  const flows = useQuery({
    queryKey: ['sop', 'flows', documentType, platformId, scheme, rejectionCode],
    queryFn: () => fetchSopFlows(documentType, platformId, scheme, rejectionCode),
    enabled: Boolean(documentType),
  })
  const steps = useQuery({
    queryKey: ['sop', 'steps', routeFlow],
    queryFn: () => fetchSopSteps(routeFlow),
    enabled: Boolean(routeFlow),
    retry: false,
  })
  const notice = useQuery({
    queryKey: ['sop', 'security-notice'],
    queryFn: async () => {
      const body = await getJson<{ items?: Record<string, string> }>(
        '/api/contents?keys=security.screenshot_notice',
      )
      return body.items?.['security.screenshot_notice'] ?? ''
    },
  })

  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [maskSource, setMaskSource] = useState<HTMLCanvasElement | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [guidance, setGuidance] = useState('')
  const [locatedCards, setLocatedCards] = useState<SopMessage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setIndex(0); setLocatedCards([]); setGuidance('') }, [routeFlow])
  const messages = locatedCards.length ? locatedCards : (steps.data?.messages ?? [])
  const current = messages[index]
  const documentLabel = documents.data?.find((row) => row.code === documentType)?.label ?? documentType

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key === 'document_type' || key === 'platform_id') navigate(`/sop?${next.toString()}`)
    else setParams(next)
  }

  const openFlow = (flowId: string) => navigate(`/sop/${encodeURIComponent(flowId)}?${params.toString()}`)

  const sendScreenshot = async (outgoing: File) => {
    setLocating(true)
    setLocateError('')
    try {
      const result = await locateSopScreenshot(outgoing, {
        platform_id: platformId || flows.data?.find((row) => row.flow_id === routeFlow)?.platform?.id,
        flow_id: routeFlow || undefined,
        step_id: current?.step_id,
      })
      setGuidance(result.guidance?.advice ?? '')
      if (result.cards?.length) {
        setLocatedCards(result.cards)
        setIndex(0)
        setHelpOpen(false)
      } else if (result.step?.step_id && result.step.flow_id === routeFlow) {
        const found = messages.findIndex((message) => message.step_id === result.step.step_id)
        if (found >= 0) setIndex(found)
      }
    } catch (cause) {
      setLocateError(cause instanceof Error ? cause.message : '截圖無法辨識，請換一張清楚的圖片再試一次。')
    } finally {
      setLocating(false)
    }
  }

  const prepareMask = async () => {
    if (!file) return
    setLocateError('')
    try {
      const prepared = await prepareFile(file, 1)
      const first = prepared.canvases[0]
      if (!first) throw new Error('這張圖片沒有可辨識的內容。')
      disposeAll(prepared.canvases.slice(1))
      setMaskSource(first)
    } catch (cause) {
      setLocateError(cause instanceof Error ? cause.message : '無法開啟遮罩工具，請換一張圖片。')
    }
  }

  const heading = routeFlow
    ? steps.data?.flow.name ?? '逐步教學'
    : documentLabel ? `怎麼取得「${documentLabel}」` : '取得文件的教學'
  const progress = useMemo(
    () => messages.length ? `步驟 ${index + 1}／${messages.length}` : '',
    [index, messages.length],
  )

  return (
    <section className="md-risein space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          {routeFlow ? '照著畫面一步一步操作；看不懂目前在哪裡時，可以傳截圖讓系統幫你定位。'
            : '先選你要取得的文件與使用的平台，再開始逐步教學。'}
        </p>
      </header>

      {!routeFlow && (
        <Card title="選擇教學">
          <div className="space-y-4">
            <label className="block text-[14px] font-medium text-primary">
              文件類型
              <select aria-label="文件類型" value={documentType}
                onChange={(event) => updateParam('document_type', event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px]">
                <option value="">請選擇</option>
                {(documents.data ?? []).map((row) => <option key={row.code} value={row.code}>{row.label}</option>)}
              </select>
            </label>
            <label className="block text-[14px] font-medium text-primary">
              使用的平台
              <select aria-label="使用的平台" value={platformId}
                onChange={(event) => updateParam('platform_id', event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px]">
                <option value="">全部平台</option>
                {(platforms.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>{row.display_name}（{CHANNEL_LABEL[row.channel]}）</option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      )}

      {!routeFlow && documentType && flows.isLoading && <Spinner label="尋找教學…" />}
      {!routeFlow && flows.error && <p role="alert" className="text-danger">{(flows.error as Error).message}</p>}
      {!routeFlow && flows.data?.length === 0 && (
        <EmptyState icon={<Map size={20} />} title="這份文件還沒有公開教學" hint="請改選其他平台，或到常見問題查看承辦單位的聯絡方式。" />
      )}
      {!routeFlow && (flows.data?.length ?? 0) > 0 && (
        <div className="space-y-2" aria-label="可用教學">
          {flows.data!.map((row) => (
            <button key={row.flow_id} type="button" onClick={() => openFlow(row.flow_id)}
              className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-border bg-elevated px-4 py-3 text-left hover:border-accent">
              <span><span className="block font-medium text-primary">{row.flow_name}</span>
                <span className="mt-0.5 block text-[13px] text-muted">{row.platform?.display_name ?? '通用教學'}</span></span>
              <ArrowRight size={18} className="text-accent" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {routeFlow && steps.isLoading && <Spinner label="載入步驟…" />}
      {routeFlow && steps.error && <EmptyState icon={<Map size={20} />} title="找不到這份教學" hint="這份流程可能尚未發布，請回上一頁改選其他教學。" />}
      {routeFlow && current && (
        <div className="space-y-3">
          {guidance && <p role="status" className="rounded-xl bg-accent-bg px-3 py-2.5 text-[14px] leading-6 text-accent">{guidance}</p>}
          <Card title={current.title} subtitle={progress}>
            {current.kind === 'image' && current.url ? (
              <button type="button" className="block w-full" onClick={() => setZoomed(true)} aria-label="放大步驟圖片">
                <img src={current.url} alt={current.alt || current.title} className="max-h-[60vh] w-full rounded-xl object-contain" />
              </button>
            ) : <p className="whitespace-pre-line text-[15px] leading-7">{current.text || current.instruction}</p>}
            <p className="mt-3 whitespace-pre-line text-[14px] leading-6 text-muted">{current.instruction}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button disabled={index === 0} icon={<ArrowLeft size={16} />} onClick={() => setIndex((value) => Math.max(0, value - 1))}>上一步</Button>
              {current.url && <Button variant="ghost" icon={<Expand size={16} />} onClick={() => setZoomed(true)}>放大</Button>}
              <Button variant="primary" disabled={index >= messages.length - 1} onClick={() => setIndex((value) => Math.min(messages.length - 1, value + 1))}>下一步 <ArrowRight size={16} /></Button>
            </div>
          </Card>
          <Button block size="lg" variant="secondary" icon={<ImageUp size={17} />} onClick={() => setHelpOpen((value) => !value)}>我卡住了</Button>
        </div>
      )}

      {helpOpen && (
        <Card title="用截圖找目前步驟">
          <p className="flex items-start gap-2 whitespace-pre-line rounded-xl bg-accent-bg px-3 py-2.5 text-[13px] leading-5 text-accent">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
            {notice.data || '傳送前請先遮蔽卡號、密碼、身分證字號等敏感資訊。截圖只用來定位步驟，不會留存。'}
          </p>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="選擇要定位的截圖"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <div className="mt-3 space-y-2">
            <Button block icon={<ImageUp size={16} />} onClick={() => fileRef.current?.click()}>{file ? `已選擇：${file.name}` : '選擇截圖'}</Button>
            {file && <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => void prepareMask()}>先遮罩</Button>
              <Button variant="primary" loading={locating} onClick={() => void sendScreenshot(file)}>略過遮罩並定位</Button>
            </div>}
          </div>
          {locateError && <p role="alert" className="mt-2 text-[13px] text-danger">{locateError}</p>}
        </Card>
      )}

      <Link to={routeFlow ? `/sop?${params.toString()}` : '/'} className="inline-flex">
        <Button variant="ghost" icon={<ArrowLeft size={16} />}>{routeFlow ? '改選教學' : '回首頁'}</Button>
      </Link>

      {zoomed && current?.url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="放大步驟圖片">
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white p-3 text-black" aria-label="關閉放大圖片" onClick={() => setZoomed(false)}><X size={20} /></button>
          <img src={current.url} alt={current.alt || current.title} className="max-h-full max-w-full object-contain" />
        </div>
      )}

      {maskSource && (
        <MaskEditor source={maskSource} mustMask={false} autoDetectCardNumber={false}
          keepHint="只保留辨識目前畫面所需的區域" onCancel={() => setMaskSource(null)}
          onConfirm={(masked) => {
            void (async () => {
              const blob = await encodePages([masked])
              const maskedFile = new File([blob], file?.name || 'screenshot.jpg', { type: blob.type || 'image/jpeg' })
              disposeAll([masked])
              setMaskSource(null)
              await sendScreenshot(maskedFile)
            })()
          }} />
      )}
    </section>
  )
}
