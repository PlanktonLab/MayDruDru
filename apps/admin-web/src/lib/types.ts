/** API types — mirror backend/app/schemas.py. */

/**
 * 角色與 capability（SPEC §6.5、決策 D14）。
 *
 * 授權以 capability 為準，不以角色排名為準——SOP 製作與案件審核是兩條互不隸屬的線，
 * 用排名授權會讓案件覆核者順手拿到 SOP 編輯權。這份對照表逐字對齊
 * `apps/api/app/deps.py` 的 `ROLE_CAPS`。
 */
export type Role = 'owner' | 'admin' | 'case_supervisor' | 'case_reviewer' | 'sop_reviewer' | 'sop_editor' | 'viewer'
export type Capability = 'sop_edit' | 'sop_review' | 'case_review' | 'case_supervise' | 'admin' | 'owner'

const ADMIN_CAPS: Capability[] = ['sop_edit', 'sop_review', 'case_review', 'case_supervise', 'admin']

export const ROLE_CAPS: Record<Role, Capability[]> = {
  viewer: [],
  sop_editor: ['sop_edit'],
  sop_reviewer: ['sop_review'],
  case_reviewer: ['case_review'],
  case_supervisor: ['case_review', 'case_supervise'],
  admin: ADMIN_CAPS,
  owner: [...ADMIN_CAPS, 'owner'],
}
export interface User { id: string; tenant_id: string; email: string; name: string; role: Role; is_active: boolean; created_at?: string | null }
export interface Tenant { id: string; name: string; slug: string; settings: Record<string, unknown> }
export interface ApiKey { id: string; name: string; prefix: string; status: 'active' | 'disabled'; rate_limit_per_minute: number; last_used_at: string | null; created_at: string; plaintext?: string | null }

export interface Goal { id: string; name: string; description: string; aliases: string[] }
export type Channel = 'mobile_app' | 'web' | 'desktop'
/**
 * 示範資料 — the persona every replica of a platform shows (SPEC §6.5). `key` is
 * an opaque id the form generates, `label` is the name people see. Whatever the
 * clerk types is what the教學圖 shows, verbatim; there is no second kind of value.
 */
export interface DemoDataField { key: string; label: string; value: string }
/**
 * 假資料同步 (SPEC §6.5) — one value a replica put on screen in place of real
 * data. `source`: 'shared' came from the platform's 示範資料, 'new' is one the
 * AI had to invent for this screen and nobody has decided about yet.
 */
export interface FakeDatum { key: string; label: string; value: string; source: 'shared' | 'new' }
/**
 * What the clerk keeps from that report; without `key` it becomes a new 示範資料
 * field. `replaces` is the value the replica currently shows, so a correction
 * can be swapped into the page instead of costing a whole redraw.
 */
export interface FakeDataPick { key: string; label: string; value: string; replaces?: string }
/** `category` is legacy: the column is still there, nothing in the pipeline reads it. */
export interface Platform { id: string; display_name: string; brand: string; channel: Channel; category?: string; aliases: string[]; demo_data: DemoDataField[]; style_doc_version: number; flow_count: number; component_count: number }

/** 平台元件庫 — a snippet of approved replica HTML reused across every screen of a platform (SPEC §6.5). */
export type ComponentKind = 'nav_bar' | 'tab_bar' | 'header' | 'footer' | 'other'
export interface PlatformComponent { id: string; platform_id: string; name: string; kind: ComponentKind; width: number; height: number; thumb_url: string | null; created_by: string | null; created_at: string }
export const COMPONENT_KIND_LABEL: Record<ComponentKind, string> = { nav_bar: '頂部導覽列', tab_bar: '底部 Tab bar', header: '頁首', footer: '頁尾', other: '其他' }
export interface StyleDoc { id: string; platform_id: string; ai_generated: Record<string, unknown>; human_notes: string; version: number; has_embedding: boolean; updated_at: string }

export type FlowStatus = 'draft' | 'published'
/** `goal_ids`: the documents the flow's 終點 steps deliver — a flow with several ends can hand out several. */
export interface Flow { id: string; platform_id: string; goal_ids: string[]; name: string; status: FlowStatus; current_version_id: string | null; current_version: number | null; drift_count: number; updated_at: string }

/** `rendering` = a Step Card render is queued or running (the variant is locked until it ends). */
export type VariantStatus = 'not_uploaded' | 'uploaded' | 'focusing' | 'processing' | 'pending_review' | 'approved' | 'annotating' | 'rendering' | 'completed' | 'failed'
export type Theme = 'light' | 'dark'
/** `original_version` changes whenever a new original is uploaded (use it as the image cache key). */
/** `replica_version` changes on every render of the replica — `replicaUrl` puts it in the URL so caches follow. */
export interface VariantSummary { id: string; theme: Theme; status: VariantStatus; progress: string; error: string; has_original: boolean; original_version: string | null; replica_png_url: string | null; replica_version: string | null; stepcard_url: string | null; stepcard_preview_url: string | null; stepcard_thumb_url: string | null; drift_count: number; attempts: number }
/** `goal_id`: on a 終點, the document the citizen holds when they get there (null until the clerk picks one). */
export interface Step { id: string; flow_id: string; title: string; instruction: string; stuck_hint: string; canvas_x: number; canvas_y: number; is_start: boolean; is_end: boolean; goal_id: string | null; drift_count: number; variants: VariantSummary[] }
export interface Edge { id: string; flow_id: string; from_step_id: string; to_step_id: string; condition_label: string; sort_order: number }
export interface CanvasData { platforms: Platform[]; goals: Goal[]; flows: Flow[]; steps: Step[]; edges: Edge[] }
/** Step position on the canvas (the only layout that is stored). */
export interface LayoutItem { id: string; x: number; y: number }
export interface UnfinishedStep { step_id: string; theme: Theme }
export interface Validation { ok: boolean; errors: string[]; publishable: boolean; publish_errors: string[]; unfinished: UnfinishedStep[] }
export interface RenderCards { queued: number; skipped: number }
export interface FlowVersion { id: string; version: number; created_at: string; published_by: string | null; step_count: number }

export type FocusBoxType = 'keep_text' | 'data_region' | 'block'
export interface FocusBox { id: string; type: FocusBoxType; x: number; y: number; w: number; h: number; note?: string }
export type AnnotationType = 'tap' | 'capture' | 'input' | 'gesture' | 'note'
export interface Annotation { id: string; type: AnnotationType; number: number; label: string; x: number; y: number; w: number; h: number; example_text?: string; direction?: 'up' | 'down' | 'left' | 'right' | 'long_press' | '' }
export interface Variant {
  id: string; step_id: string; theme: Theme; status: VariantStatus; progress: string; error: string; attempts: number
  has_original: boolean; original_version: string | null; original_width: number; original_height: number; focus_boxes: FocusBox[]
  /** 承辦人員給 AI 的補充說明，隨 Focus Box 儲存，復刻與重做都會帶上。 */
  prompt_notes: string
  structure: Record<string, unknown> | null; replica_png_url: string | null; replica_version: string | null; replica_width: number; replica_height: number
  kept_texts: string[]; fake_data: FakeDatum[]
  /** False while the clerk has not yet said what to do with `fake_data` (a new replica clears it). */
  fake_data_reviewed: boolean
  check_report: { ok: boolean; problems: string[]; leaked?: string[]; missing?: string[] } | null
  review_history: { decision: string; feedback?: string; by: string; at: string; attempt?: number }[]
  annotations: Annotation[]; stepcard_url: string | null; stepcard_preview_url: string | null; stepcard_layout: LayoutPatch | null
  description: string; drift_count: number; updated_at: string
}

/**
 * Step Card layout (SPEC §9.1): the canvas, the replica frame and one text group
 * (title, then the annotation list) with its alignment rules. The tenant keeps a
 * template per channel; a step stores a sparse patch — only the keys it changed.
 */
/** The frame is a window on the replica: w/h size the window (h 0: the replica's own height at this scale), zoom and ox/oy (replica px) move the replica behind it. */
/** The window on the replica. `align`/`valign`: at its own x/y (free), or by rule on the canvas — its safe
 *  margin or centre — so replicas of another height keep the same place on the card. */
export interface LayoutFrame {
  x: number; y: number; w: number; h: number; zoom: number; ox: number; oy: number
  align: 'free' | 'left' | 'center' | 'right'
  valign: 'free' | 'top' | 'middle' | 'bottom'
}
/** The text group. `valign`: at its own y (free), or top / middle / bottom on the frame's; `align` is its axis: one left edge, or title and list both centred. */
export interface LayoutText { x: number; y: number; w: number; align: 'left' | 'center'; valign: 'free' | 'top' | 'middle' | 'bottom'; gap: number }
/** Dim everything but the annotated regions. */
/** Dim (and, with `blur`, soften) everything but the annotated regions; each region keeps `pad` px around it and `radius` px corners. */
export interface LayoutMask { enabled: boolean; opacity: number; pad: number; radius: number; blur: number }
export interface StepCardLayout {
  v: 2
  canvas: { w: number; h: number; margin: number }
  frame: LayoutFrame
  text: LayoutText
  /** `gap`: between the step number and the title. */
  title: { size: number; number: boolean; gap: number }
  list: { size: number; icon: number; gap: number }
  mask: LayoutMask
}
export type LayoutBlock = Exclude<keyof StepCardLayout, 'v'>
/** What one step changes about the template: per block, only the keys it touched. `{}` means it follows the template. */
export type LayoutPatch = { v?: 2 } & { [B in LayoutBlock]?: Partial<StepCardLayout[B]> }
export interface CardPreview {
  html: string; channel: 'mobile_app' | 'web'; replica_w: number; replica_h: number
  layout: StepCardLayout; template: StepCardLayout; patch: LayoutPatch; built_in: StepCardLayout
}
export interface ReviewQueueItem { variant_id: string; theme: Theme; step_id: string; step_title: string; flow_id: string; flow_name: string; platform_name: string; updated_at: string; attempts: number; checks_ok: boolean }

export interface EvalCase { id: string; platform_id: string; step_id: string | null; goal_id: string | null; text: string; note: string; image_url: string; created_at: string }
export interface EvalRun { id: string; status: string; label: string; config: Record<string, unknown>; summary: Record<string, number | null>; results: Record<string, unknown>[]; started_at: string; finished_at: string | null }

/** Session response union (SPEC §8.1) — identical for public API and Playground. */
export interface StepResponse {
  type: 'step'; session_id: string; note?: string
  flow: { id: string; name: string; platform_name: string; goal_name: string; version: number | null }
  step: { id: string; title: string; instruction: string; stuck_hint: string; is_end: boolean }
  card: { image_url: string | null; preview_url: string | null; width: number; height: number; theme: Theme; annotations: { number: number; type: AnnotationType; label: string }[] } | null
  progress: { index: number; total: number }
  actions: { next: boolean; prev: boolean; branches: { edge_id: string; label: string; to_step_title: string }[]; restart: boolean }
}
export interface ClarificationResponse { type: 'clarification'; session_id: string; kind: string; question: string; options: { option_id: string; label: string; image_url?: string | null }[]; attempt: number }
export interface EscalationResponse { type: 'escalation'; session_id: string; code: string; message: string }
export interface CompletedResponse { type: 'completed'; session_id: string; flow: { id: string; name: string; goal_name: string }; message: string; suggestions: { option_id: string; goal_id: string; flow_id: string; label: string }[] }
export type SessionResponse = (StepResponse | ClarificationResponse | EscalationResponse | CompletedResponse) & { _debug?: Record<string, unknown> }

export interface DashboardSummary {
  days: number; sessions: number; flows_started: number; completed: number; completion_rate: number | null; avg_steps: number | null
  stuck_uploads: number; escalations: number; escalation_rate: number | null
  flows: { flow_id: string; name: string; platform_name: string; status: string; drift_count: number; started: number; completed: number }[]
  llm_usage: { task: string; calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number; avg_latency_ms: number }[]
  llm_cost_usd: number
  daily: { date: string; session_created: number; completed: number; stuck_upload: number; escalation: number }[]
}

/** Status words live in canvas/status.ts (`STATUS[status].label`) so the whole product uses one vocabulary. */
export const ROLE_LABEL: Record<Role, string> = {
  owner: '擁有者',
  admin: '管理者',
  case_supervisor: '案件覆核人',
  case_reviewer: '案件審核人',
  sop_reviewer: 'SOP 審核者',
  sop_editor: 'SOP 編輯者',
  viewer: '唯讀',
}
export const CHANNEL_LABEL: Record<Channel, string> = { mobile_app: '手機 App', web: '網頁', desktop: '電腦' }
export const ANNOTATION_LABEL: Record<AnnotationType, string> = { tap: '點按', capture: '截圖需包含', input: '輸入', gesture: '手勢', note: '說明' }
export const ANNOTATION_COLOR: Record<AnnotationType, string> = { tap: 'var(--ann-tap)', capture: 'var(--ann-capture)', input: 'var(--ann-input)', gesture: 'var(--ann-gesture)', note: 'var(--ann-note)' }

/**
 * 虛擬客服 chat (Playground): what one turn sends back — plain messages, like a
 * support agent typing. `choices` is a question with a short list of answers the
 * citizen taps; tapping one sends its label back as an ordinary text message.
 */
export interface ChatTurnMessage {
  kind: 'text' | 'image' | 'choices'
  text?: string
  url?: string; preview_url?: string; width?: number | null; height?: number | null; theme?: Theme
  /** For an image: "步驟 n／N：標題", used as alt text only — the picture is sent on its own. */
  alt?: string
  flow_id?: string; step_id?: string
  /** Numbered from one per conversation, not per flow: a citizen who joins midway starts at 1. */
  number?: number
  title?: string; instruction?: string
  /** `choices` only. */
  options?: { label: string }[]
}
export interface ChatToolCall { name: string; args: Record<string, unknown>; result: string; ms: number }

/**
 * 客服策略 (backend `services/policy.py`) — the variables the citizen-facing
 * engines read: voice (language and wording), behaviour (how cards are
 * delivered and what each screenshot outcome turns into) and the sentence
 * templates. A blank voice field means「用該語言的內建句子」; the API answers
 * with those blanks already filled in.
 */
export interface TenantPolicy {
  language: string
  name: string; tone: string; goal_noun: string; extra_rules: string; handoff_message: string
  delivery: 'all_at_once' | 'one_by_one'
  on_ambiguous: 'ask' | 'best_guess'
  on_off_flow: 'restart' | 'ask_goal' | 'handoff'
  on_not_app_screen: 'restart' | 'ask_platform' | 'handoff'
  on_unknown_platform: 'ask_platform' | 'handoff'
  on_unreadable: 'retake' | 'handoff'
  locate_threshold: number
  locate_low: number
  /** The tenant's own template overrides, {key: text}. */
  templates: Record<string, string>
}
/** GET/PUT /api/tenant/policy: the policy plus what the form needs to show what a blank means. */
export interface TenantPolicyResponse extends TenantPolicy {
  overrides: Record<string, string>
  builtin_templates: Record<string, string>
  languages_with_templates: string[]
}

/** What the screenshot ladder decided this turn should lead to. */
export interface ChatLocateGuidance {
  outcome: string
  advice?: string
  ask?: string
  options?: { label: string; flow_id?: string; step_id?: string; platform_id?: string; image_url?: string | null }[]
  flow_id?: string; flow_name?: string
  step_id?: string; step_title?: string; step_index?: number; total_steps?: number
  step_ids?: string[]; restart?: boolean
  platform_id?: string; platform_name?: string
}
export interface ChatLocateCandidate {
  variant_id: string; step_id: string | null; flow_id: string | null; step_title: string; flow_name: string
  preview_url?: string | null; score?: number | null; lexical?: number | null; distance?: number | null
}
/** One screenshot read: what it is, where it landed, and what to do about it. */
export interface ChatLocateDebug {
  outcome: 'located' | 'ambiguous' | 'off_flow' | 'unknown_platform' | 'not_app_screen' | 'not_a_screenshot' | 'unreadable'
  ok: boolean
  confidence: number
  step_id: string | null; flow_id: string | null; platform_id: string | null
  platform_guess?: string
  kind?: string
  photographed?: boolean
  quality_issues?: string[]
  relation?: string; difference?: string; reason?: string
  theme?: Theme | null
  scope?: string
  screen?: {
    title?: string
    structural_texts?: string[]
    elements?: { text: string; kind: string; region: string; position: string }[]
    app_guess?: string
  }
  candidates?: ChatLocateCandidate[]
  guidance?: ChatLocateGuidance
}
export interface ChatTurnDebug {
  elapsed_ms?: number; rounds?: number; busy?: boolean
  tool_calls?: ChatToolCall[]
  usage?: { task: string; model?: string; input_tokens?: number; cached_tokens?: number; output_tokens?: number; latency_ms?: number; cost_usd?: number }[]
  /** Null when the citizen sent no screenshot this turn. */
  locate?: ChatLocateDebug | null
  /** `policy`: the per-chat overrides on top of the tenant's 客服策略, null when there are none. */
  state?: {
    content_mode?: string; theme?: string; language?: string; delivery?: string
    platform_id?: string | null; flow_id?: string | null; goal_id?: string | null; step_id?: string | null
    policy?: Record<string, unknown> | null
  }
}
export interface ChatTurnResponse { chat_id: string; content_mode?: 'published' | 'draft'; messages: ChatTurnMessage[]; _debug?: ChatTurnDebug }

/* ────────────────────────────────────────────────────────────────────────────
 * P2：LINE 內容（SPEC §8.2「LINE 內容」/ §8.6 罐頭訊息）
 *
 * 對應 `/api/admin/contents`、`/api/admin/faqs`、`/api/admin/knowledge`、
 * `/api/admin/media`、`/api/admin/line/*`。刻意放在檔尾自成一區：上面那一大段
 * 是 SOP Tutor 起家的型別，兩邊各自演化，混在一起反而找不到東西。
 * ──────────────────────────────────────────────────────────────────────────── */

/** text：訊息本文。button：按鈕短標籤。label：卡片欄位名。flex：整張卡片。 */
export type ContentType = 'text' | 'button' | 'label' | 'flex'

/** 後台側邊欄的分類，順序就是後端 registry 的順序。 */
export interface ContentCategory { id: string; label: string; icon: string; description: string }

/**
 * 一則罐頭訊息。`content` 是民眾現在看得到的、`draft` 是還沒發布的（null＝沒草稿），
 * `default` 是程式內建值（「還原預設」會回到它）。`version` 給樂觀鎖用。
 */
export interface ContentView {
  key: string; category: string; title: string; description: string
  content: string; draft: string | null; default: string
  content_type: ContentType; variables: string[]; sort_order: number; version: number
  published_at: string | null; published_by: string | null
  customised: boolean; has_draft: boolean; scheme_id: string | null
  missing_variables: string[]
}
export interface ContentsList {
  items: ContentView[]
  categories: ContentCategory[]
  stats: { total: number; registry: number; customised: number; drafts: number }
}

/** 一個真實畫面：`messages` 是原始的 LINE 訊息 JSON，由 `flexPreview` 走訪後畫出來。 */
export interface PreviewSurface { id: string; messages: unknown[] }
/**
 * `rendered` 是代入範例變數後的字。`missing_variables`＝宣告了但文字裡沒用到
 * （民眾會看到一段缺資訊的話）；`unknown_variables`＝文字裡有、但系統不會代入的。
 */
export interface ContentPreview {
  key: string; kind: ContentType; rendered: string
  sample_variables: Record<string, string>
  missing_variables: string[]; unknown_variables: string[]
  quick_replies: string[]; where: string
  surfaces: PreviewSurface[]
}

export interface Faq {
  id: string; code: string; category: string; question: string; answer: string
  keywords: string[]; priority: number; active: boolean
  scheme_id: string | null; source: string; version: number; updated_at: string
}
export interface FaqList { items: Faq[]; categories: string[] }

export interface KnowledgeDoc {
  id: string; code: string; title: string; content: string
  source_url: string; source_type: string; tags: string[]
  scheme_id: string | null; version: number; updated_at: string
}

export interface MediaItem { id: string; key: string; url: string; mime: string; size: number; alt: string; uploaded_by: string | null; created_at: string }

/** 圖文選單的一格：畫布 2500×1686 上的絕對座標，`data` 是 postback 字串。 */
export interface RichMenuTile {
  action: string; label_key: string; label: string
  bounds: { x: number; y: number; width: number; height: number }
  data: string
}
/** `unknown`＝問不到 LINE（跟「不一樣」是兩件事，見 `services/line/richmenu.status`）。 */
export type RichMenuState = 'synced' | 'different' | 'missing' | 'not_configured' | 'unknown'
export interface RichMenuStatus {
  state: RichMenuState
  /** 差異代碼（`size`、`area_3_bounds`…），中文句子在 `pages/line/labels.ts`。 */
  differences: string[]
  remote: unknown[]; default_rich_menu_id: string
  local: Record<string, unknown> | null
  tiles: RichMenuTile[]
  image_key: string; last_sync: string | null; checked_at?: string | null; error?: string
}
export interface LineSyncLog {
  id: string; operation: string; status: string; remote_id: string | null
  error: string | null; actor_id: string | null; created_at: string; completed_at: string | null
}
/** 同步失敗（502）時附的圖檔檢查結果；`problems` 同樣是代碼。 */
export interface RichMenuImageInfo { width: number; height: number; bytes: number; problems: string[] }
export interface RichMenuSyncFailure { message?: string; state?: string; error?: string; image?: RichMenuImageInfo }

export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped'
export interface LineNotification {
  id: string; case_no: string; kind: string; content_key: string
  status: NotificationStatus; error: string | null; transition_code: string
  created_at: string; sent_at: string | null
}

/** 意圖分類器沒命中的自由文字。只留 userId hash 的前 8 碼，永遠不存 LINE user id。 */
export interface UnmatchedMessage {
  id: string; text: string
  intent_result: { intent?: string; confidence?: number } | null
  user_hash: string; created_at: string
}
