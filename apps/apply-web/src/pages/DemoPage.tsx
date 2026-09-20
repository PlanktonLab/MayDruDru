import { useMemo, useState } from 'react'
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

const ID_MASKS: MaskRect[] = [
  { x: 0.105, y: 0.43, w: 0.43, h: 0.095, source: 'MANUAL' },
  { x: 0.655, y: 0.79, w: 0.26, h: 0.1, source: 'MANUAL' },
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

function MaskedIdPreview({ src }: { src: string | null }) {
  return (
    <div className="demo-id-stage" aria-label="已遮蔽個資的示範身分證">
      <img src={src ?? '/samples/id-front.jpg'} alt="示範用中華民國身分證" />
      {!src && (
        <>
          <span className="demo-redaction demo-redaction-name" aria-hidden />
          <span className="demo-redaction demo-redaction-number" aria-hidden />
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
      setMaskSource(await loadCanvas('/samples/id-front.jpg'))
    } catch (cause) {
      setMaskError(cause instanceof Error ? cause.message : '無法開啟遮罩編輯器')
    }
  }

  return (
    <div className="demo-page">
      <nav className="demo-nav" aria-label="Demo 頁面導覽">
        <a href="#top" className="demo-brand"><span>MayDru</span><small>功能體驗</small></a>
        <a href="#features">探索功能 <ArrowDown size={14} /></a>
      </nav>

      <main id="top">
        <section className="demo-hero" aria-labelledby="demo-title">
          <div className="demo-hero-orb demo-orb-one" /><div className="demo-hero-orb demo-orb-two" />
          <p className="demo-eyebrow"><Sparkles size={14} />智慧申辦體驗</p>
          <h1 id="demo-title">讓申請，<br />簡單到每個人都會。</h1>
          <p>從個資保護、文件辨識到即時教學，MayDru 把複雜的政府申辦流程，變成手機上清楚的每一步。</p>
          <div className="demo-hero-actions">
            <a href="#privacy" className="demo-primary-link">開始體驗 <ArrowDown size={16} /></a>
            <a href="/" className="demo-text-link">前往申請平台 <ArrowUpRight size={15} /></a>
          </div>
          <div className="demo-hero-phone" aria-hidden>
            <div className="demo-phone-island" />
            <div className="demo-phone-screen">
              <span className="demo-phone-status">安全檢查完成 <Check size={12} /></span>
              <ShieldCheck size={70} />
              <strong>準備好了</strong>
              <small>敏感資料已在這台手機完成遮蔽</small>
              <i /><i /><i />
            </div>
          </div>
        </section>

        <div id="features">
          <section className="demo-feature demo-feature-privacy" id="privacy">
            <SectionHeading eyebrow="01 — 資料去敏" title="個資，留在你的手機。"
              description="上傳前先遮蔽敏感欄位；原圖不離開裝置，需要保留的資訊仍清楚可讀。" />
            <div className="demo-privacy-grid">
              <div>
                <MaskedIdPreview src={maskedPreview} />
                <p className="demo-sample-note">示範證件與資料皆為虛構範例</p>
              </div>
              <div className="demo-feature-copy">
                <span className="demo-icon-box"><ScanLine size={22} /></span>
                <h3>遮罩位置，你可以決定。</h3>
                <p>點一下進入手機版編輯器。拖曳遮罩、調整大小，再確認要送出的結果。</p>
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
            <SectionHeading eyebrow="03 — 文件重點標注" title="重點，自己浮現。"
              description="系統把審查真正需要的欄位標出來，使用者不必在密密麻麻的文件裡猜答案。" />
            <div className="demo-document-wrap">
              <article className="demo-document" key={highlightKey} aria-label="文件重點標注效果示範">
                <header><span>INVOICE</span><small>AI Service Subscription</small></header>
                <div className="demo-document-meta"><p>Billed to<br /><strong>CHEN, YU-LING</strong></p><p>Invoice no.<br /><strong>INV-2026-0918</strong></p></div>
                <div className="demo-document-table">
                  <div><span>Description</span><span>Period</span><span>Amount</span></div>
                  <div><strong className="demo-mark mark-one">ChatGPT Plus</strong><strong className="demo-mark mark-two">Sep 18 – Oct 18, 2026</strong><strong className="demo-mark mark-three">US$20.00</strong></div>
                </div>
                <div className="demo-document-total"><span>Total</span><strong className="demo-mark mark-four">NT$ 642</strong></div>
                <span className="demo-approved"><Check size={15} />資料完整</span>
              </article>
              <div className="demo-highlight-copy">
                <span className="demo-icon-box demo-yellow"><Highlighter size={22} /></span>
                <p>透明黃色螢光筆會依序標出<strong>工具名稱、訂閱期間、原始金額與臺幣金額</strong>，保留原始文件的可讀性。</p>
                <button type="button" onClick={() => setHighlightKey((value) => value + 1)}>重新播放標注效果</button>
              </div>
            </div>
          </section>

          <section className="demo-feature demo-feature-line" id="line">
            <SectionHeading eyebrow="04 — LINE BOT" title="熟悉的聊天室，就是服務入口。"
              description="案件進度、補件提醒與 SOP 教學，都能在 LINE 裡接續，不必重新學一套介面。" />
            <div className="demo-line-grid">
              <div className="demo-line-phone">
                <header><span>‹</span><div><strong>MayDru 申請小幫手</strong><small>官方帳號</small></div><b>☰</b></header>
                <div className="demo-line-chat">
                  <p>今天</p>
                  <div className="demo-line-row"><span className="demo-line-avatar">M</span><div>你的申請資料已收到！<br />目前進度：<strong>文件審查中</strong></div></div>
                  <div className="demo-line-row"><span className="demo-line-avatar">M</span><div>如果需要信用卡消費紀錄，我可以一步一步帶你操作。</div></div>
                  <div className="demo-line-card"><FileCheck2 size={28} /><p><strong>國泰世華消費明細教學</strong><span>完整 SOP · {Math.max(messages.length, 1)} 個步驟</span></p><ArrowRight size={18} /></div>
                  <div className="demo-line-replies"><span>查看案件進度</span><span>取得文件教學</span></div>
                </div>
              </div>
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
          <p className="demo-eyebrow">MAYDRU</p>
          <h2>少一點挫折。<br />多一點完成。</h2>
          <p>把每一份難懂的申請，變成清楚、安心、做得到的流程。</p>
          <a href="/" className="demo-primary-link">開始線上申請 <ArrowUpRight size={16} /></a>
        </section>
      </main>

      <footer className="demo-footer"><strong>MayDru</strong><span>政府申辦流程協助平台</span><a href="#top">回到頂端 ↑</a></footer>

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
        <MaskEditor source={maskSource} mustMask={false} autoDetectCardNumber={false} initialMasks={ID_MASKS}
          keepHint="保留證件類別；姓名與完整身分證字號請遮蔽"
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
