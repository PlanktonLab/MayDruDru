import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  Highlighter,
  LockKeyhole,
  MessageCircle,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react'
import { MaskEditor, disposeCanvas, type MaskRect } from '@maydru/mask-editor'
import {
  fetchSopCatalogFlows,
  fetchSopPlatforms,
  fetchSopSteps,
  type SopFlow,
  type SopMessage,
} from '../lib/queries'

const LINE_URL = 'https://line.me/R/ti/p/@811lqyrt'
const FALLBACK_FLOW_ID = '__cathay-demo__'

const CARD_MASKS: MaskRect[] = [
  { x: 0.085, y: 0.465, w: 0.61, h: 0.135, source: 'MANUAL' },
  { x: 0.3, y: 0.635, w: 0.2, h: 0.14, source: 'MANUAL' },
]

const FALLBACK_FLOW: SopFlow = {
  flow_id: FALLBACK_FLOW_ID,
  flow_name: '國泰世華 CUBE App｜信用卡消費明細',
  platform: {
    id: 'cathay-demo',
    display_name: '國泰世華 CUBE App',
    brand: '國泰世華',
    channel: 'mobile_app',
  },
}

const FALLBACK_MESSAGES: SopMessage[] = [
  {
    kind: 'image',
    url: '/demo/cathay-home.png',
    preview_url: '/demo/cathay-home.png',
    number: 1,
    flow_id: FALLBACK_FLOW_ID,
    step_id: 'cathay-home',
    title: '開啟 CUBE App 首頁',
    instruction: '在首頁找到「信用卡消費明細」，跟著畫面標示進入查詢。',
    alt: '國泰世華 CUBE App 首頁示範畫面',
  },
]

interface CathayCatalog {
  source: 'database' | 'fallback'
  flows: SopFlow[]
}

function isCathay(value: string): boolean {
  return /國泰|cathay/i.test(value)
}

async function fetchCathayCatalog(): Promise<CathayCatalog> {
  try {
    const platforms = await fetchSopPlatforms()
    const cathayPlatforms = platforms.filter((platform) =>
      isCathay(`${platform.display_name} ${platform.brand}`),
    )
    if (!cathayPlatforms.length) return { source: 'fallback', flows: [FALLBACK_FLOW] }

    const results = await Promise.allSettled(
      cathayPlatforms.map(async (platform) => {
        const flows = await fetchSopCatalogFlows(platform.id)
        return flows.map((flow): SopFlow => ({
          flow_id: flow.id,
          flow_name: flow.name,
          platform,
        }))
      }),
    )
    const byId = new Map<string, SopFlow>()
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const flow of result.value) byId.set(flow.flow_id, flow)
    }
    const flows = [...byId.values()]
    return flows.length
      ? { source: 'database', flows }
      : { source: 'fallback', flows: [FALLBACK_FLOW] }
  } catch {
    return { source: 'fallback', flows: [FALLBACK_FLOW] }
  }
}

function loadCanvas(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('無法開啟遮罩編輯器'))
        return
      }
      context.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => reject(new Error('示範圖片載入失敗'))
    image.src = src
  })
}

function SectionHeading({ eyebrow, title, description }: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <header className="demo-section-heading">
      <p className="demo-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  )
}

function MaskedCardPreview({ src }: { src: string | null }) {
  return (
    <div className="demo-card-stage" aria-label="卡號僅露出末四碼的示範信用卡">
      <img src={src ?? '/demo/credit-card-generic.jpg'} alt="無銀行 Logo 的示範信用卡" />
      {!src && (
        <>
          <span className="demo-redaction demo-redaction-card-number" aria-hidden />
          <span className="demo-redaction demo-redaction-expiry" aria-hidden />
        </>
      )}
      <span className="demo-local-badge"><LockKeyhole size={13} />只在手機處理</span>
    </div>
  )
}

function SopGallery({ messages, loading, onZoom }: {
  messages: SopMessage[]
  loading: boolean
  onZoom: (message: SopMessage) => void
}) {
  if (loading) {
    return <div className="demo-gallery-loading" aria-label="正在讀取流程教學圖"><span /><span /></div>
  }
  return (
    <div className="demo-sop-gallery" aria-label="SOP 流程教學圖">
      {messages.map((message, index) => (
        <article className="demo-sop-card" key={`${message.step_id}-${index}`}>
          {message.kind === 'image' && message.url ? (
            <button type="button" onClick={() => onZoom(message)} aria-label={`放大查看：${message.title}`}>
              <img src={message.preview_url || message.url} alt={message.alt || message.title} />
              <span className="demo-zoom"><ZoomIn size={16} />放大</span>
            </button>
          ) : (
            <div className="demo-sop-text">{message.text || message.instruction}</div>
          )}
          <div className="demo-sop-caption">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><h3>{message.title}</h3><p>{message.instruction}</p></div>
          </div>
        </article>
      ))}
    </div>
  )
}

function ChatDemo({ flows, activeFlowId, messages, loading, onChoose, onClose }: {
  flows: SopFlow[]
  activeFlowId: string
  messages: SopMessage[]
  loading: boolean
  onChoose: (flowId: string) => void
  onClose: () => void
}) {
  const activeName = flows.find((flow) => flow.flow_id === activeFlowId)?.flow_name
  return (
    <div className="demo-chat-scrim" role="dialog" aria-modal="true" aria-label="SOP 聊天客服體驗">
      <div className="demo-chat-sheet">
        <header className="demo-chat-header">
          <button type="button" onClick={onClose} aria-label="關閉聊天客服"><X size={19} /></button>
          <div><strong>申請小幫手</strong><span><i />線上</span></div>
          <span aria-hidden className="demo-chat-avatar">M</span>
        </header>
        <div className="demo-chat-body">
          <p className="demo-chat-time">今天 09:41</p>
          <div className="demo-bot-row">
            <span className="demo-mini-avatar">M</span>
            <div className="demo-bubble">嗨！你想看哪一個國泰世華的操作教學？選一個流程，我會把完整步驟傳給你。</div>
          </div>
          <div className="demo-quick-replies" aria-label="可選擇的 SOP 流程">
            {flows.map((flow) => (
              <button key={flow.flow_id} type="button" aria-pressed={flow.flow_id === activeFlowId}
                onClick={() => onChoose(flow.flow_id)}>{flow.flow_name}</button>
            ))}
          </div>
          {activeName && (
            <>
              <div className="demo-user-bubble">{activeName}</div>
              <div className="demo-bot-row">
                <span className="demo-mini-avatar">M</span>
                <div className="demo-bubble demo-chat-result">
                  <strong>完整教學來了</strong>
                  <span>左右滑動查看每一個步驟，點圖片可以放大。</span>
                  {loading ? <em>正在從資料庫取得教學…</em> : (
                    <div className="demo-chat-images">
                      {messages.filter((message) => message.url).slice(0, 4).map((message) => (
                        <img key={message.step_id} src={message.preview_url || message.url} alt={message.alt || message.title} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <footer className="demo-chat-footer"><span>輸入問題…</span><button type="button" aria-label="傳送訊息"><ArrowUpRight size={17} /></button></footer>
      </div>
    </div>
  )
}

export default function DemoPage() {
  const catalog = useQuery({ queryKey: ['demo', 'cathay-sop-catalog'], queryFn: fetchCathayCatalog })
  const flows = catalog.data?.flows ?? [FALLBACK_FLOW]
  const [chosenFlowId, setChosenFlowId] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [zoomed, setZoomed] = useState<SopMessage | null>(null)
  const [maskSource, setMaskSource] = useState<HTMLCanvasElement | null>(null)
  const [maskedPreview, setMaskedPreview] = useState<string | null>(null)
  const [maskError, setMaskError] = useState('')
  const [highlightKey, setHighlightKey] = useState(0)

  useEffect(() => {
    const previousTitle = document.title
    document.title = '卡好審｜功能體驗'
    return () => { document.title = previousTitle }
  }, [])

  const flowId = flows.some((flow) => flow.flow_id === chosenFlowId)
    ? chosenFlowId
    : flows[0]?.flow_id ?? FALLBACK_FLOW_ID
  const isFallback = flowId === FALLBACK_FLOW_ID
  const steps = useQuery({
    queryKey: ['demo', 'cathay-sop-steps', flowId],
    queryFn: () => fetchSopSteps(flowId),
    enabled: Boolean(flowId) && !isFallback,
    retry: false,
  })
  const messages = useMemo(() => {
    if (isFallback || steps.isError) return FALLBACK_MESSAGES
    return steps.data?.messages ?? []
  }, [isFallback, steps.data, steps.isError])
  const openMaskEditor = async () => {
    setMaskError('')
    try {
      setMaskSource(await loadCanvas('/demo/credit-card-generic.jpg'))
    } catch (cause) {
      setMaskError(cause instanceof Error ? cause.message : '無法開啟遮罩編輯器')
    }
  }

  return (
    <div className="demo-page">
      <nav className="demo-nav" aria-label="Demo 頁面導覽">
        <a href="#top" className="demo-brand"><span>卡好審</span><small>功能體驗</small></a>
        <a href="#features">探索功能 <ArrowDown size={14} /></a>
      </nav>

      <main id="top">
        <section className="demo-hero" aria-labelledby="demo-title">
          <p className="demo-eyebrow"><Sparkles size={14} />智慧申辦體驗</p>
          <h1 id="demo-title">讓申請，<br />簡單到每個人都會。</h1>
          <p>從個資保護、文件辨識到即時教學，卡好審把複雜的政府申辦流程，變成手機上清楚的每一步。</p>
          <div className="demo-hero-actions">
            <a href="#privacy" className="demo-primary-link">開始體驗 <ArrowDown size={16} /></a>
            <a href="/" className="demo-text-link">前往申請平台 <ArrowUpRight size={15} /></a>
          </div>
        </section>

        <div id="features">
          <section className="demo-feature demo-feature-privacy" id="privacy">
            <SectionHeading eyebrow="01 — 資料去敏" title="卡號，只留下需要的四碼。"
              description="上傳前先遮蔽信用卡號前 12 碼與到期日期，只露出審核所需的末四碼；原圖不離開裝置。" />
            <div className="demo-privacy-grid">
              <div>
                <MaskedCardPreview src={maskedPreview} />
                <p className="demo-sample-note">無銀行 Logo 的測試卡；卡號與持卡人資料皆為示範資訊</p>
              </div>
              <div className="demo-feature-copy">
                <span className="demo-icon-box"><ScanLine size={22} /></span>
                <h3>前 12 碼遮蔽，末四碼可核對。</h3>
                <p>點一下進入手機版編輯器。拖曳遮罩、調整大小，確認末四碼 5410 完整可見，並遮住到期日期。</p>
                <button className="demo-action-button" type="button" onClick={() => void openMaskEditor()}>
                  編輯遮罩位置 <ArrowRight size={17} />
                </button>
                {maskError && <p className="demo-error" role="alert">{maskError}</p>}
              </div>
            </div>
          </section>

          <section className="demo-feature demo-feature-sop" id="sop">
            <SectionHeading eyebrow="02 — SOP 教學" title="不是說明書。是下一步。"
              description="直接讀取資料庫中已發布的國泰世華流程，左右滑動、放大查看，也能用聊天方式快速選擇教學。" />
            <div className="demo-flow-bar">
              <label htmlFor="demo-flow">目前流程</label>
              <select id="demo-flow" value={flowId} onChange={(event) => setChosenFlowId(event.target.value)}>
                {flows.map((flow) => <option key={flow.flow_id} value={flow.flow_id}>{flow.flow_name}</option>)}
              </select>
              <span className={catalog.data?.source === 'database' ? 'is-live' : ''}>
                <i />{catalog.data?.source === 'database' ? '資料庫即時內容' : '離線展示內容'}
              </span>
            </div>
            <SopGallery messages={messages} loading={steps.isLoading} onZoom={setZoomed} />
            <div className="demo-sop-cta">
              <div><MessageCircle size={22} /><p><strong>想用問的？</strong><span>像 LINE 一樣，點選流程就收到完整教學圖。</span></p></div>
              <button className="demo-action-button" type="button" onClick={() => setChatOpen(true)}>
                測試聊天客服 <ArrowRight size={17} />
              </button>
            </div>
          </section>

          <section className="demo-feature demo-feature-highlight" id="highlight">
            <SectionHeading eyebrow="03 — 文件重點標注" title="讓審核，只看真正重要的地方。"
              description="系統先在真實收據上標出審核所需欄位，讓承辦與審核人員快速核對日期、方案、期間、金額與付款紀錄。" />
            <div className="demo-document-wrap">
              <article className="demo-review-document" key={highlightKey} aria-label="真實收據的審核重點標注效果示範">
                <div className="demo-review-badge"><FileCheck2 size={14} />審核人員視角</div>
                <div className="demo-receipt-stage">
                  <img src="/demo/receipt-review.png" alt="真實 Anthropic 收據的審核欄位裁切預覽" />
                  <span className="demo-review-highlight review-date" aria-hidden="true" />
                  <span className="demo-review-highlight review-plan" aria-hidden="true" />
                  <span className="demo-review-highlight review-period" aria-hidden="true" />
                  <span className="demo-review-highlight review-amount" aria-hidden="true" />
                  <span className="demo-review-highlight review-payment" aria-hidden="true" />
                </div>
                <span className="demo-approved"><Check size={15} />關鍵欄位已定位</span>
              </article>
              <div className="demo-highlight-copy">
                <span className="demo-icon-box demo-yellow"><Highlighter size={22} /></span>
                <p>透明黃色螢光筆會依序標出<strong>付款日期、方案、訂閱期間、金額與付款紀錄</strong>，讓審核人員更快掃描與核對，同時保留原始文件的可讀性。</p>
                <button type="button" onClick={() => setHighlightKey((value) => value + 1)}>重新播放標注效果</button>
              </div>
            </div>
          </section>

          <section className="demo-feature demo-feature-line" id="line">
            <SectionHeading eyebrow="04 — LINE BOT" title="熟悉的聊天室，就是服務入口。"
              description="案件進度、補件提醒與 SOP 教學，都能在 LINE 裡接續，不必重新學一套介面。" />
            <div className="demo-line-grid">
              <figure className="demo-line-proof">
                <img src="/demo/line-bot-real.png" alt="卡好審 LINE Bot 實際對話與圖文選單畫面" />
                <figcaption><span>實際畫面</span>補件問答、快速選單與圖文選單</figcaption>
              </figure>
              <div className="demo-feature-copy">
                <span className="demo-line-logo">LINE</span>
                <h3>現在就用真的帳號試試看。</h3>
                <p>加入官方帳號後，可以測試案件查詢、流程教學與快速回覆。Demo 案號可使用 <strong>20260001</strong>。</p>
                <a className="demo-line-button" href={LINE_URL} target="_blank" rel="noreferrer">
                  在 LINE 開啟 <ArrowUpRight size={17} />
                </a>
                <small>將離開此頁並開啟 LINE 應用程式</small>
              </div>
            </div>
          </section>
        </div>

        <section className="demo-closing">
          <span className="demo-icon-box"><ShieldCheck size={23} /></span>
          <p className="demo-eyebrow">卡好審</p>
          <h2>少一點挫折。<br />多一點完成。</h2>
          <p>把每一份難懂的申請，變成清楚、安心、做得到的流程。</p>
          <a href="/" className="demo-primary-link">開始線上申請 <ArrowUpRight size={16} /></a>
        </section>
      </main>

      <footer className="demo-footer"><strong>卡好審</strong><span>政府申辦流程協助平台</span><a href="#top">回到頂端 ↑</a></footer>

      {chatOpen && <ChatDemo flows={flows} activeFlowId={flowId} messages={messages} loading={steps.isLoading}
        onChoose={setChosenFlowId} onClose={() => setChatOpen(false)} />}

      {zoomed?.url && (
        <div className="demo-lightbox" role="dialog" aria-modal="true" aria-label="放大 SOP 教學圖">
          <button type="button" onClick={() => setZoomed(null)} aria-label="關閉放大圖片"><X size={20} /></button>
          <img src={zoomed.url} alt={zoomed.alt || zoomed.title} />
          <p><strong>{zoomed.title}</strong><span>{zoomed.instruction}</span></p>
        </div>
      )}

      {maskSource && (
        <MaskEditor source={maskSource} mustMask autoDetectCardNumber={false} initialMasks={CARD_MASKS}
          keepHint="完整保留末四碼 5410；其餘 12 碼與到期日期請遮蔽"
          onCancel={() => setMaskSource(null)}
          onConfirm={(masked) => {
            setMaskedPreview(masked.toDataURL('image/jpeg', 0.9))
            disposeCanvas(masked)
            disposeCanvas(maskSource)
            setMaskSource(null)
          }} />
      )}
    </div>
  )
}
