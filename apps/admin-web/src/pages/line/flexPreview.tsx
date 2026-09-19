/**
 * 把原始的 LINE 訊息 JSON 畫成「民眾手機上會長這樣」。
 *
 * 這是全站唯一允許硬編色碼的地方，而且是刻意的：預覽要像 LINE，就得用 LINE 的
 * 聊天背景與泡泡顏色；卡片內的顏色更是直接來自訊息 JSON（`color`、
 * `backgroundColor`），那正是承辦人要檢查的東西。若改用設計 token，預覽就變成
 * 「我們的設計系統長怎樣」，而不是「民眾會看到什麼」。
 *
 * 走訪範圍刻意只到後端 `services/line/flex.py` 真的會產出的節點；沒見過的節點
 * 安靜略過，寧可少畫一塊，也不要因為 Flex 規格更新就整頁壞掉。
 */

import type { CSSProperties, ReactNode } from 'react'

/** LINE 自己的配色（聊天背景、對方的白泡泡、快速回覆的藍字）。 */
const LINE_COLORS = {
  chatBackground: '#8CABD8',
  bubble: '#FFFFFF',
  bubbleText: '#111111',
  quickReplyText: '#1B6FE0',
  quickReplyBorder: '#FFFFFF',
  hairline: '#E6E6E6',
  cardText: '#111111',
} as const

/* ------------------------------------------------------------ JSON 小工具 */

type Node = Record<string, unknown>

const asNode = (v: unknown): Node | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Node) : null)
const str = (n: Node, k: string): string | undefined => (typeof n[k] === 'string' ? (n[k] as string) : undefined)
const bool = (n: Node, k: string): boolean | undefined => (typeof n[k] === 'boolean' ? (n[k] as boolean) : undefined)
const list = (n: Node, k: string): Node[] => (Array.isArray(n[k]) ? (n[k] as unknown[]).map(asNode).filter((x): x is Node => !!x) : [])

/** Flex 的字級梯，對到大約的 px（LINE 沒有公開精確值，這是肉眼對出來的）。 */
const FONT_SIZE: Record<string, number> = {
  xxs: 10, xs: 11, sm: 13, md: 15, lg: 16, xl: 17, xxl: 19, '3xl': 21, '4xl': 23, '5xl': 25,
}
/** `spacing` / `margin` 的梯度。 */
const GAP: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 }
const PADDING: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 }

const size = (v: string | undefined, fallback = 15): number => (v && FONT_SIZE[v] !== undefined ? FONT_SIZE[v] : fallback)
/** `12px` 這種絕對值原樣採用，否則查梯度表。 */
const spacing = (v: string | undefined, table: Record<string, number>): number | undefined => {
  if (!v) return undefined
  if (table[v] !== undefined) return table[v]
  const px = /^(\d+(?:\.\d+)?)px$/.exec(v)
  return px ? Number(px[1]) : undefined
}

/* ------------------------------------------------------------ 節點 renderer */

function FlexText({ node }: { node: Node }) {
  const style: CSSProperties = {
    fontSize: size(str(node, 'size')),
    lineHeight: 1.5,
    color: str(node, 'color') ?? LINE_COLORS.cardText,
    fontWeight: str(node, 'weight') === 'bold' ? 700 : 400,
    whiteSpace: bool(node, 'wrap') ? 'pre-wrap' : 'nowrap',
    overflow: bool(node, 'wrap') ? undefined : 'hidden',
    textOverflow: bool(node, 'wrap') ? undefined : 'ellipsis',
    textDecoration: str(node, 'decoration') === 'line-through' ? 'line-through' : str(node, 'decoration') === 'underline' ? 'underline' : undefined,
    textAlign: str(node, 'align') as CSSProperties['textAlign'],
    flex: node.flex === 0 ? '0 0 auto' : typeof node.flex === 'number' ? `${node.flex} 1 0%` : undefined,
    marginTop: spacing(str(node, 'margin'), GAP),
    minWidth: 0,
  }
  // `contents` 是同一段字裡混排的 span；沒有時才看 `text`。
  const spans = list(node, 'contents')
  return (
    <div style={style}>
      {spans.length
        ? spans.map((s, i) => (
            <span key={i} style={{ color: str(s, 'color'), fontWeight: str(s, 'weight') === 'bold' ? 700 : undefined, fontSize: str(s, 'size') ? size(str(s, 'size')) : undefined }}>
              {str(s, 'text') ?? ''}
            </span>
          ))
        : (str(node, 'text') ?? '')}
    </div>
  )
}

function FlexBox({ node }: { node: Node }) {
  const layout = str(node, 'layout') ?? 'vertical'
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'vertical' ? 'column' : 'row',
    alignItems: layout === 'baseline' ? 'baseline' : layout === 'horizontal' ? 'center' : undefined,
    gap: spacing(str(node, 'spacing'), GAP),
    marginTop: spacing(str(node, 'margin'), GAP),
    backgroundColor: str(node, 'backgroundColor'),
    borderRadius: spacing(str(node, 'cornerRadius'), PADDING),
    padding: spacing(str(node, 'paddingAll'), PADDING),
    paddingTop: spacing(str(node, 'paddingTop'), PADDING),
    justifyContent: str(node, 'justifyContent'),
    flex: node.flex === 0 ? '0 0 auto' : typeof node.flex === 'number' ? `${node.flex} 1 0%` : undefined,
    minWidth: 0,
  }
  return (
    <div style={style}>
      {list(node, 'contents').map((child, i) => (
        <FlexNode key={i} node={child} />
      ))}
    </div>
  )
}

function FlexSeparator({ node }: { node: Node }) {
  return <div style={{ height: 1, backgroundColor: str(node, 'color') ?? LINE_COLORS.hairline, marginTop: spacing(str(node, 'margin'), GAP) }} />
}

function FlexButton({ node }: { node: Node }) {
  const action = asNode(node.action)
  const primary = str(node, 'style') === 'primary'
  return (
    <div
      style={{
        marginTop: spacing(str(node, 'margin'), GAP),
        borderRadius: 8,
        border: `1px solid ${str(node, 'color') ?? LINE_COLORS.quickReplyText}`,
        backgroundColor: primary ? (str(node, 'color') ?? LINE_COLORS.quickReplyText) : 'transparent',
        color: primary ? '#FFFFFF' : (str(node, 'color') ?? LINE_COLORS.quickReplyText),
        fontSize: 14,
        minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
        textAlign: 'center',
      }}
    >
      {(action && str(action, 'label')) ?? ''}
    </div>
  )
}

function FlexImage({ node }: { node: Node }) {
  const url = str(node, 'url') ?? ''
  if (!url) return null
  return (
    <img
      src={url}
      alt={str(node, 'altText') ?? '圖片'}
      style={{ width: '100%', display: 'block', borderRadius: 4, marginTop: spacing(str(node, 'margin'), GAP), aspectRatio: str(node, 'aspectRatio')?.replace(':', ' / ') }}
    />
  )
}

function FlexNode({ node }: { node: Node }) {
  switch (str(node, 'type')) {
    case 'box': return <FlexBox node={node} />
    case 'text': return <FlexText node={node} />
    case 'separator': return <FlexSeparator node={node} />
    case 'button': return <FlexButton node={node} />
    case 'image': return <FlexImage node={node} />
    case 'spacer': return <div style={{ height: size(str(node, 'size'), 8) }} />
    case 'filler': return <div style={{ flex: '1 1 auto' }} />
    default: return null
  }
}

/* ------------------------------------------------------------------ 容器 */

function FlexBubble({ node }: { node: Node }) {
  const sections: [string, Node | null][] = [
    ['header', asNode(node.header)],
    ['body', asNode(node.body)],
    ['footer', asNode(node.footer)],
  ]
  return (
    <div style={{ backgroundColor: LINE_COLORS.bubble, borderRadius: 14, overflow: 'hidden', width: '100%', maxWidth: 260 }}>
      {sections.map(([name, section], index) =>
        section ? (
          <div key={name} style={{ padding: 12, borderTop: index > 0 ? `1px solid ${LINE_COLORS.hairline}` : undefined }}>
            <FlexBox node={section} />
          </div>
        ) : null,
      )}
    </div>
  )
}

function FlexContainer({ node }: { node: Node }) {
  if (str(node, 'type') === 'carousel') {
    const bubbles = list(node, 'contents')
    if (!bubbles.length) return null
    return (
      <div style={{ width: '100%' }}>
        <FlexBubble node={bubbles[0]} />
        {bubbles.length > 1 && (
          <div style={{ marginTop: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', fontSize: 12, padding: '4px 10px', textAlign: 'center', maxWidth: 260 }}>
            還有 {bubbles.length - 1} 張
          </div>
        )}
      </div>
    )
  }
  return <FlexBubble node={node} />
}

/* -------------------------------------------------------------- 對外元件 */

/** 手機外框。圓角、LINE 的聊天背景，內容捲動不外漏。 */
export function PhoneFrame({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[28px] border border-border bg-canvas p-1.5" style={{ boxShadow: 'var(--shadow-float)' }}>
      <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted">
        <span aria-hidden className="h-1 w-8 rounded-full bg-border" />
        {title}
      </div>
      <div className="max-h-[520px] overflow-auto rounded-[22px] p-3" style={{ backgroundColor: LINE_COLORS.chatBackground }}>
        <div className="flex flex-col items-start gap-2">{children}</div>
      </div>
    </div>
  )
}

/** 對方（官方帳號）送出的白泡泡。 */
export function ChatBubble({ children }: { children: ReactNode }) {
  return (
    <div
      className="max-w-[240px] whitespace-pre-wrap break-words px-3 py-2 text-[14px] leading-relaxed"
      style={{ backgroundColor: LINE_COLORS.bubble, color: LINE_COLORS.bubbleText, borderRadius: 14, borderTopLeftRadius: 4 }}
    >
      {children}
    </div>
  )
}

/** `label` 型別的文案：卡片裡的一列欄位，左邊是這段字、右邊是資料。 */
export function LabelFieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-full max-w-[260px] rounded-xl p-3" style={{ backgroundColor: LINE_COLORS.bubble, color: LINE_COLORS.cardText }}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="shrink-0 text-[12px]" style={{ color: '#8C8C8C' }}>{label}</span>
        <span className="truncate">{value}</span>
      </div>
    </div>
  )
}

/** 快速回覆：聊天室最下面那一排白框藍字的藥丸。 */
export function QuickReplyRow({ labels }: { labels: string[] }) {
  if (!labels.length) return null
  return (
    <div className="flex w-full flex-wrap gap-1.5 pt-1">
      {labels.map((label, i) => (
        <span
          key={`${label}-${i}`}
          className="rounded-full px-3 py-1 text-[12px] leading-5"
          style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: LINE_COLORS.quickReplyText, border: `1px solid ${LINE_COLORS.quickReplyBorder}` }}
        >
          {label}
        </span>
      ))}
    </div>
  )
}

const quickReplyLabels = (message: Node): string[] =>
  list(asNode(message.quickReply) ?? {}, 'items')
    .map((item) => asNode(item.action))
    .map((action) => (action ? str(action, 'label') : undefined))
    .filter((label): label is string => !!label)

/** 一整串原始 LINE 訊息 JSON（`text` 與 `flex` 兩種）。 */
export function LineMessages({ messages }: { messages: unknown[] }) {
  const nodes = messages.map(asNode).filter((m): m is Node => !!m)
  if (!nodes.length) return <ChatBubble>（這個畫面沒有訊息）</ChatBubble>
  return (
    <>
      {nodes.map((message, i) => {
        const quick = quickReplyLabels(message)
        const contents = asNode(message.contents)
        return (
          <div key={i} className="flex w-full flex-col items-start gap-1.5">
            {str(message, 'type') === 'flex' && contents ? (
              <FlexContainer node={contents} />
            ) : (
              <ChatBubble>{str(message, 'text') ?? str(message, 'altText') ?? ''}</ChatBubble>
            )}
            <QuickReplyRow labels={quick} />
          </div>
        )
      })}
    </>
  )
}
