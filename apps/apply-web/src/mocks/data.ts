/** MSW 用的假資料：新竹市「AI 領航青年數位工具補助計畫」。
 *
 * 代碼與文案逐字對齊 `apps/api/scripts/seed_data.py`，所以開著 mocks 跑出來的畫面
 * 與接上真後端的 seed 資料是同一批字。這裡沒有任何真實個資（CLAUDE.md 規則 9）。
 */

import type {
  CasePublic,
  EligibleTool,
  Faq,
  ReviewRule,
  SchemeDocumentType,
  SchemePaymentChannel,
  SchemePublic,
  SchemeRejectionCode,
  SchemeSummary,
  SchemeTier,
} from '../lib/types'

export const SCHEME_CODE = 'HCAI115'

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'application/pdf']

export const TIERS: SchemeTier[] = [
  { code: 'GENERAL', label: '一般青年', subsidy_rate: 0.5, cap_amount: 3000, required_proof_doc_types: [] },
  {
    code: 'LOW_INCOME',
    label: '特定對象及文化語言保存者',
    subsidy_rate: 0.9,
    cap_amount: 6000,
    required_proof_doc_types: ['SPECIAL_STATUS_PROOF'],
  },
]

function documentType(
  code: string,
  label: string,
  hint: string,
  extra: Partial<SchemeDocumentType> = {},
): SchemeDocumentType {
  return {
    code,
    label,
    hint,
    required: false,
    must_mask: false,
    accepted_mime: IMAGE_MIME,
    max_pages: 5,
    sort_order: 0,
    required_when: null,
    keep_visible: null,
    ...extra,
  }
}

export const DOCUMENT_TYPES: SchemeDocumentType[] = [
  documentType('ID_CARD_FRONT', '身分證正面', '姓名、出生年月日、身分證字號需清楚可辨識。', {
    required: true,
    sort_order: 1,
    keep_visible: '姓名、出生年月日、身分證字號',
  }),
  documentType('ID_CARD_BACK', '身分證反面', '須可辨識設籍新竹市的住址。', {
    required: true,
    sort_order: 2,
    keep_visible: '設籍新竹市住址',
  }),
  documentType('OFFICIAL_RECEIPT', '官方收據', '軟體公司或平台開立的收據、發票或訂單確認信。', {
    required: true,
    sort_order: 3,
  }),
  documentType(
    'BILLING_STATEMENT',
    '信用卡帳單扣款紀錄',
    '需看得到刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額。',
    { must_mask: true, sort_order: 4, keep_visible: '刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額' },
  ),
  documentType('CARD_LAST4_PHOTO', '信用卡圖片', '需看得到持卡本人姓名、簽名與卡號末四碼。照片或截圖都可以。', {
    must_mask: true,
    sort_order: 5,
    keep_visible: '持卡本人姓名、簽名、卡號末四碼',
  }),
  documentType('TELECOM_BILL', '電信帳單', '需看得到繳款人、電話末三碼、購買品項名稱、臺幣金額。', {
    must_mask: true,
    sort_order: 6,
    keep_visible: '繳款人、電話末三碼、購買品項名稱、臺幣金額',
  }),
  documentType(
    'PAYER_ACCOUNT_PROOF',
    '支付帳戶為本人之證明',
    '可證明該支付帳戶為你本人的資料，例如帳戶頁面顯示你的姓名。',
    { must_mask: true, sort_order: 7, keep_visible: '帳戶持有人姓名' },
  ),
  documentType('TRANSACTION_DETAIL', '交易明細', '需看得到付款日期、付款金額、購買品項名稱。', {
    must_mask: true,
    sort_order: 8,
    keep_visible: '付款日期、付款金額、購買品項名稱',
  }),
  documentType('BANKBOOK_COVER', '存摺封面影本', '撥款用。需看得到戶名、帳號、分行。', {
    required: true,
    sort_order: 9,
    keep_visible: '戶名、帳號、分行',
  }),
  documentType('AFFIDAVIT', '切結書', '需親筆簽名後拍照或掃描上傳。', { required: true, sort_order: 10 }),
  documentType('PROXY_AFFIDAVIT', '代為支付切結書', '由父母、配偶或法定代理人代為付款時才需要。', {
    required_when: 'proxy',
    sort_order: 11,
  }),
  documentType('SPECIAL_STATUS_PROOF', '特定對象證明', '低收入戶或中低收入戶證明。', {
    required_when: 'tier:LOW_INCOME',
    sort_order: 12,
  }),
]

export const PAYMENT_CHANNELS: SchemePaymentChannel[] = [
  {
    code: 'CREDIT_CARD',
    label: '信用卡繳費',
    hint: '信用卡圖片與信用卡帳單扣款紀錄，兩份都要。',
    required_document_type_codes: ['CARD_LAST4_PHOTO', 'BILLING_STATEMENT'],
    guide_content_key: 'channel.CREDIT_CARD.guide',
  },
  {
    code: 'TELECOM',
    label: '電信繳費',
    hint: '電信帳單須含繳款人、電話末三碼、購買品項名稱、臺幣金額。',
    required_document_type_codes: ['TELECOM_BILL'],
    guide_content_key: 'channel.TELECOM.guide',
  },
  {
    code: 'E_PAYMENT',
    label: '電子支付工具繳費',
    hint: '支付帳戶須為申請人本人，並附交易明細。兩份都要。',
    required_document_type_codes: ['PAYER_ACCOUNT_PROOF', 'TRANSACTION_DETAIL'],
    guide_content_key: 'channel.E_PAYMENT.guide',
  },
  {
    code: 'OTHER',
    label: '其他繳費',
    hint: '須可證明支付帳戶為申請人本人，並附付款明細。兩份都要。',
    required_document_type_codes: ['PAYER_ACCOUNT_PROOF', 'TRANSACTION_DETAIL'],
    guide_content_key: 'channel.OTHER.guide',
  },
]

export const REJECTION_CODES: SchemeRejectionCode[] = [
  {
    code: 'BILLING_NO_TWD',
    public_what_wrong: '出帳帳單上看不到換算後的臺幣金額',
    public_how_to_fix: '請重新取得一份含臺幣金額的帳單。下方是你的付款方式的取得步驟。',
    related_document_type_codes: ['BILLING_STATEMENT'],
    related_sop_flow_ids: [],
  },
  {
    code: 'BILLING_NO_CARD_DIGITS',
    public_what_wrong: '出帳帳單上看不到卡號末四碼',
    public_how_to_fix: '請提供含卡號末四碼的帳單頁面，或改用網銀的交易明細截圖。',
    related_document_type_codes: ['BILLING_STATEMENT'],
    related_sop_flow_ids: [],
  },
  {
    code: 'BILLING_UNREADABLE',
    public_what_wrong: '出帳帳單的照片看不清楚',
    public_how_to_fix: '請在光線充足處重拍，確認四個角都在畫面內、文字沒有晃到。',
    related_document_type_codes: ['BILLING_STATEMENT'],
    related_sop_flow_ids: [],
  },
  {
    code: 'BILLING_AMOUNT_MISMATCH',
    public_what_wrong: '帳單上的金額與你填寫的金額不一致',
    public_how_to_fix: '請以帳單上實際扣款的臺幣金額為準，回到申請資料修正填報金額。',
    related_document_type_codes: ['BILLING_STATEMENT'],
    related_sop_flow_ids: [],
  },
  {
    code: 'CARD_DIGITS_MISMATCH',
    public_what_wrong: '帳單與信用卡照片的末四碼不是同一張卡',
    public_how_to_fix: '帳單與卡片佐證必須是同一張卡。請確認後重新上傳其中一份。',
    related_document_type_codes: ['CARD_LAST4_PHOTO'],
    related_sop_flow_ids: [],
  },
  {
    code: 'ID_ADDRESS_UNCLEAR',
    public_what_wrong: '身分證背面的住址看不清楚',
    public_how_to_fix: '請重拍身分證背面，確認住址那一行沒有反光或模糊。',
    related_document_type_codes: ['ID_CARD_BACK'],
    related_sop_flow_ids: [],
  },
  {
    code: 'ID_NOT_HSINCHU',
    public_what_wrong: '身分證上的設籍地不在新竹市',
    public_how_to_fix: '本計畫限設籍新竹市的青年申請。若你已遷入，請提供最新的身分證背面。',
    related_document_type_codes: ['ID_CARD_BACK'],
    related_sop_flow_ids: [],
  },
  {
    code: 'OVER_MASKED',
    public_what_wrong: '遮罩把需要保留的資訊也蓋住了',
    public_how_to_fix: '請重新上傳並確認保留必要欄位——系統會標示哪些位置不可以遮。',
    related_document_type_codes: [],
    related_sop_flow_ids: [],
  },
  {
    code: 'AFFIDAVIT_NO_SIGNATURE',
    public_what_wrong: '切結書上沒有親筆簽名',
    public_how_to_fix: '請列印後親筆簽名，再拍照上傳。',
    related_document_type_codes: ['AFFIDAVIT'],
    related_sop_flow_ids: [],
  },
  {
    code: 'DOC_MISSING',
    public_what_wrong: '有一份必要文件沒有收到',
    public_how_to_fix: '請補上承辦標示的那一份文件。',
    related_document_type_codes: [],
    related_sop_flow_ids: [],
  },
  {
    code: 'TOOL_NOT_ELIGIBLE',
    public_what_wrong: '你申請的工具不符合補助資格',
    public_how_to_fix: '請參考判定理由與替代工具建議。',
    related_document_type_codes: [],
    related_sop_flow_ids: [],
  },
  {
    code: 'OTHER',
    public_what_wrong: '其他需要修正的事項',
    public_how_to_fix: '請參考承辦的補充說明。',
    related_document_type_codes: [],
    related_sop_flow_ids: [],
  },
]

export const REVIEW_RULES: ReviewRule[] = [
  {
    code: 'BILLING_TWD_AMOUNT',
    label: '帳單上有換算後的臺幣金額',
    document_type_code: 'BILLING_STATEMENT',
    rule_type: 'keyword_extract',
    required: true,
    severity: 'error',
    sort_order: 1,
    active: true,
    config: {
      keywords: ['新臺幣', '台幣', '臺幣', 'TWD', 'NT$', 'NTD'],
      value_after_keyword: true,
      regex: '[\\d,]+(?:\\.\\d{2})?',
      normalize: 'amount',
      rejection_code: 'BILLING_NO_TWD',
    },
  },
  {
    code: 'BILLING_CARD_LAST4',
    label: '帳單上有卡號末四碼',
    document_type_code: 'BILLING_STATEMENT',
    rule_type: 'keyword_extract',
    required: false,
    severity: 'warning',
    sort_order: 2,
    active: true,
    config: {
      keywords: ['卡號', '末四碼', 'card', 'ending'],
      value_after_keyword: true,
      regex: '\\d{4}',
      normalize: 'last4',
      rejection_code: 'BILLING_NO_CARD_DIGITS',
    },
  },
  {
    code: 'BILLING_CHARGE_DATE',
    label: '帳單上有扣款日期',
    document_type_code: 'BILLING_STATEMENT',
    rule_type: 'keyword_extract',
    required: true,
    severity: 'error',
    sort_order: 3,
    active: true,
    config: {
      keywords: ['扣款日', '交易日', '消費日', 'date'],
      value_after_keyword: true,
      regex: '\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}',
      normalize: 'date',
      rejection_code: 'BILLING_UNREADABLE',
    },
  },
  {
    code: 'RECEIPT_AMOUNT',
    label: '收據上的金額',
    document_type_code: 'OFFICIAL_RECEIPT',
    rule_type: 'regex_extract',
    required: false,
    severity: 'warning',
    sort_order: 4,
    active: true,
    config: { pattern: '(?:NT\\$|TWD|新臺幣)\\s*([\\d,]+(?:\\.\\d{2})?)', group: 1, normalize: 'amount' },
  },
  {
    code: 'AMOUNT_MATCHES_CLAIM',
    label: '帳單金額與申報金額相符',
    document_type_code: 'BILLING_STATEMENT',
    rule_type: 'amount_tolerance',
    required: true,
    severity: 'error',
    sort_order: 5,
    active: true,
    config: {
      source_rule_code: 'BILLING_TWD_AMOUNT',
      compare_to: 'purchase_amount',
      // 百分比（5 = 5%），與 apps/api/scripts/seed_data.py 一致。
      tolerance_pct: 5,
      tolerance_abs: 150,
      rejection_code: 'BILLING_AMOUNT_MISMATCH',
    },
  },
  {
    code: 'REQUIRED_DOCS_PRESENT',
    label: '必要文件齊備',
    document_type_code: null,
    rule_type: 'required_doc',
    required: true,
    severity: 'error',
    sort_order: 6,
    active: true,
    config: { document_type_codes: [], from_payment_channel: true, rejection_code: 'DOC_MISSING' },
  },
]

function tool(
  id: string,
  name: string,
  vendor: string,
  status: EligibleTool['status'],
  aliases: string[],
  verdict_note: string,
): EligibleTool {
  return { id, name, vendor, status, aliases, verdict_note }
}

export const ELIGIBLE_TOOLS: EligibleTool[] = [
  tool('tool-chatgpt', 'ChatGPT Plus', 'OpenAI, L.L.C.', 'APPROVED', ['chatgpt', 'chat gpt', 'GPT', 'OpenAI'],
    '美國公司，無中資背景。屬一般性生成式 AI 工具，符合本計畫補助範圍。'),
  tool('tool-claude', 'Claude Pro', 'Anthropic PBC', 'APPROVED', ['claude', '克勞德', 'anthropic'],
    '美國公司，無中資背景。符合本計畫補助範圍。'),
  tool('tool-gemini', 'Gemini Advanced（Google One AI Premium）', 'Google LLC', 'APPROVED',
    ['gemini', '雙子星', 'google one ai', 'bard'], '美國公司，無中資背景。符合本計畫補助範圍。'),
  tool('tool-m365-copilot', 'Microsoft 365 Copilot', 'Microsoft Corporation', 'APPROVED',
    ['copilot', '微軟 copilot', 'm365 copilot'], '美國公司，無中資背景。符合本計畫補助範圍。'),
  tool('tool-gh-copilot', 'GitHub Copilot', 'GitHub, Inc.（Microsoft 子公司）', 'APPROVED',
    ['github copilot', 'gh copilot'], '美國公司，無中資背景。程式開發輔助工具，符合本計畫補助範圍。'),
  tool('tool-midjourney', 'Midjourney', 'Midjourney, Inc.', 'APPROVED', ['midjourney', 'MJ'],
    '美國公司，無中資背景。影像生成工具，符合本計畫補助範圍。'),
  tool('tool-notion', 'Notion AI', 'Notion Labs, Inc.', 'APPROVED', ['notion ai', 'notion'],
    '美國公司，無中資背景。符合本計畫補助範圍。'),
  tool('tool-doubao', '豆包（Doubao）', '北京字節跳動科技有限公司', 'REJECTED', ['豆包', 'doubao', '字節 AI'],
    '母公司為字節跳動（中國），屬中資背景服務。依本計畫規定，具中資背景之服務不予補助。'),
  tool('tool-deepseek', 'DeepSeek', '杭州深度求索人工智能基礎技術研究有限公司', 'REJECTED',
    ['deepseek', '深度求索'], '中國公司，具中資背景。依本計畫規定不予補助。'),
  tool('tool-capcut', 'CapCut（剪映）', '北京字節跳動科技有限公司 / ByteDance', 'REJECTED',
    ['capcut', '剪映', 'ByteDance'], '由中國字節跳動營運開發，屬中資背景 AI 影音剪輯工具，依本計畫規定不予補助。'),
  tool('tool-poe', 'Poe.com', 'Quora', 'REJECTED', ['poe', 'poe.com', 'Quora Poe'],
    '透過集合式 AI 平台購買涉及非合規軟體綑綁銷售，本計畫僅補助直接向 AI 官網購買，故不予補助。'),
  tool('tool-goingbus', 'GoingBus', 'GoingBus', 'REJECTED', ['goingbus', 'going bus'],
    '屬代購／帳號合租網站，非申請人向 AI 軟體官網直購，不屬本計畫補助範圍，不予補助。'),
  tool('tool-canva', 'Canva Pro', 'Canva Pty Ltd（澳洲）', 'PENDING', ['canva', 'canva pro'],
    '澳洲公司，無中資背景，但本身為設計工具、AI 功能僅為其中一部分。是否屬「AI 數位工具」需依申請人實際使用目的逐案認定。'),
]

export const SCHEME_SUMMARY: SchemeSummary = {
  code: SCHEME_CODE,
  name: '115年度 AI領航青年數位工具補助計畫',
  category: '數位工具',
  description: '補助設籍新竹市青年購買 AI 數位工具的訂閱費用。',
  application_start: '2026-04-02',
  application_end: '2026-11-30',
  amount_note:
    '一般青年：補助購買金額 50%，每人上限 3,000 元；特定對象及文化語言保存者：補助 90%，每人上限 6,000 元。',
  tags: ['AI', '數位工具', 'ChatGPT', 'Claude', 'Gemini', 'Canva', 'Copilot', 'Midjourney', '軟體訂閱', '數位'],
  active: true,
}

export const OTHER_SCHEMES: SchemeSummary[] = [
  {
    code: 'HCDIV115',
    name: '促進青年多元發展補助',
    category: '青年發展',
    description: '補助青年自主提案的多元發展活動。',
    application_start: null,
    application_end: '2026-11-30',
    amount_note: '依提案內容核定。',
    tags: ['青年發展'],
    active: true,
  },
  {
    code: 'HCRENT115',
    name: '115年度新竹好好租－新竹市青年租金加碼補貼',
    category: '居住',
    description: '加碼補貼設籍新竹市青年的租金。',
    application_start: null,
    application_end: '2026-12-31',
    amount_note: '依中央補貼加碼。',
    tags: ['居住', '租金'],
    active: true,
  },
]

export const SCHEME: SchemePublic = {
  ...SCHEME_SUMMARY,
  eligibility: '設籍新竹市、16–40 歲青年。',
  age_min: 16,
  age_max: 40,
  official_url:
    'https://youthhsinchu.hccg.gov.tw/youth/app/artwebsite?module=artwebsite&id=64&serno=null',
  contact: '新竹市青年發展中心 03-522-0557／LINE 官方帳號 @youthhsinchu',
  identity_tags: ['一般青年', '應屆畢業生', '待業中', '創業者'],
  details: [
    { label: '申請期間', value: '115/4/2 – 115/11/30' },
    { label: '購買日期限制', value: '115/4/2 – 115/10/31' },
    { label: '補助次數', value: '每年一次' },
    { label: '補件期限', value: '10 個工作天' },
  ],
  supplement_days: 14,
  max_revisions: 3,
  tiers: TIERS,
  document_types: DOCUMENT_TYPES,
  payment_channels: PAYMENT_CHANNELS,
  rejection_codes: REJECTION_CODES,
  review_rules: REVIEW_RULES,
  eligible_tools: ELIGIBLE_TOOLS,
}

export const FAQS: Faq[] = [
  {
    id: 'faq_billing',
    category: 'DOCUMENTS',
    priority: 100,
    question: '什麼是「出帳帳單」？我要去哪裡拿？',
    answer:
      '出帳帳單是指你的付款管道（信用卡、Apple、Google Play、PayPal）所出具、並且看得到「換算後臺幣金額」的那一份紀錄。\n\n這是最容易被退件的一份文件。系統會依你選的付款方式，一步一步告訴你去哪裡找。',
  },
  {
    id: 'faq_privacy_mask',
    category: 'PRIVACY',
    priority: 100,
    question: '為什麼要我上傳整份帳單？我不想給你們看我所有的消費',
    answer:
      '你不需要。系統會在你的手機上自動把「與本次申請無關的消費紀錄」遮起來，遮好之後才上傳——原圖永遠不會離開你的手機。\n\n市府端收到的，只有已經遮罩過的影像。',
  },
  {
    id: 'faq_purge',
    category: 'PRIVACY',
    priority: 10,
    question: '我的證件照片會被保留多久？',
    answer:
      '撥款完成後，系統會依規定期限自動刪除你上傳的證明文件，並在刪除時通知你。稽核所需的紀錄（案件編號、狀態、金額）依規定保留，但不含證件影像。',
  },
  {
    id: 'faq_revision_queue',
    category: 'PROCESS',
    priority: 100,
    question: '被退件補傳之後，是不是要重新排隊？',
    answer:
      '不用。補件後你的案件依「第一次送件的時間」排序，不會回到隊伍最後面。\n\n你只需要重傳有問題的那幾份文件。',
  },
  {
    id: 'faq_eligible_tool',
    category: 'TOOLS',
    priority: 100,
    question: '我買的 AI 工具可以申請嗎？',
    answer:
      '在申請的第一步輸入工具名稱，系統會立刻告訴你結果。\n\n若系統尚未收錄該工具，你仍然可以送件——會由承辦人員人工認定。具中資背景的服務依規定不予補助。',
  },
  {
    id: 'faq_amount',
    category: 'ELIGIBILITY',
    priority: 10,
    question: '補助金額怎麼算？',
    answer:
      '一般青年補助實際支出的 50%，上限 NT$3,000。\n低收入戶與中低收入戶補助 90%，上限 NT$6,000（需另附特定對象證明）。',
  },
]

/** 依級距、繳費管道、代付旗標推出必備文件——與伺服器同一套規則。 */
export function requiredDocumentCodes(input: {
  tier_code: string
  payment_channel_code: string
  paid_by_proxy: boolean
}): string[] {
  const codes = ['ID_CARD_FRONT', 'ID_CARD_BACK', 'OFFICIAL_RECEIPT']
  const channel = PAYMENT_CHANNELS.find((entry) => entry.code === input.payment_channel_code)
  codes.push(...(channel?.required_document_type_codes ?? []))
  codes.push('BANKBOOK_COVER', 'AFFIDAVIT')
  if (input.paid_by_proxy) codes.push('PROXY_AFFIDAVIT')
  const tier = TIERS.find((entry) => entry.code === input.tier_code)
  codes.push(...(tier?.required_proof_doc_types ?? []))
  return [...new Set(codes)]
}

const now = new Date()
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

/** 三筆示範案件：審核中、待補件、已撥款——全是假資料。 */
export const CASES: Record<string, CasePublic> = {
  'HC-2026-900002': {
    case_no: 'HC-2026-900002',
    scheme: { code: SCHEME_CODE, name: SCHEME_SUMMARY.name },
    status: 'UNDER_REVIEW',
    first_submitted_at: daysAgo(5),
    last_submitted_at: daysAgo(5),
    revision_count: 0,
    supplement_items: [],
    supplement_deadline: null,
    payment_date: null,
    tool_name: 'Claude Pro',
    purchase_amount: 7200,
    documents: [
      { document_type_code: 'ID_CARD_FRONT', revision: 1, is_current: true, uploaded_at: daysAgo(5), page_count: 1 },
      { document_type_code: 'ID_CARD_BACK', revision: 1, is_current: true, uploaded_at: daysAgo(5), page_count: 1 },
      { document_type_code: 'TELECOM_BILL', revision: 1, is_current: true, uploaded_at: daysAgo(5), page_count: 1 },
    ],
    events: [
      { transition_code: '', from_status: null, to_status: 'SUBMITTED', actor_type: 'APPLICANT', created_at: daysAgo(5), rejection_codes: [] },
      { transition_code: 'T1', from_status: 'SUBMITTED', to_status: 'UNDER_REVIEW', actor_type: 'SYSTEM', created_at: daysAgo(5), rejection_codes: [] },
    ],
    can_supplement: false,
    can_withdraw: true,
  },
  'HC-2026-900003': {
    case_no: 'HC-2026-900003',
    scheme: { code: SCHEME_CODE, name: SCHEME_SUMMARY.name },
    status: 'NEEDS_REVISION',
    first_submitted_at: daysAgo(9),
    last_submitted_at: daysAgo(9),
    revision_count: 0,
    supplement_items: [
      {
        document_type_code: 'BILLING_STATEMENT',
        rejection_code: 'BILLING_NO_TWD',
        note: '帳單上看不到換算後的臺幣金額，請重新取得一份含臺幣金額的帳單。',
      },
    ],
    supplement_deadline: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    payment_date: null,
    tool_name: 'Midjourney',
    purchase_amount: 3600,
    documents: [
      { document_type_code: 'ID_CARD_FRONT', revision: 1, is_current: true, uploaded_at: daysAgo(9), page_count: 1 },
      { document_type_code: 'BILLING_STATEMENT', revision: 1, is_current: true, uploaded_at: daysAgo(9), page_count: 1 },
    ],
    events: [
      { transition_code: '', from_status: null, to_status: 'SUBMITTED', actor_type: 'APPLICANT', created_at: daysAgo(9), rejection_codes: [] },
      { transition_code: 'T1', from_status: 'SUBMITTED', to_status: 'UNDER_REVIEW', actor_type: 'SYSTEM', created_at: daysAgo(9), rejection_codes: [] },
      { transition_code: 'T2', from_status: 'UNDER_REVIEW', to_status: 'NEEDS_REVISION', actor_type: 'STAFF', created_at: daysAgo(2), rejection_codes: ['BILLING_NO_TWD'] },
    ],
    can_supplement: true,
    can_withdraw: true,
  },
  'HC-2026-900005': {
    case_no: 'HC-2026-900005',
    scheme: { code: SCHEME_CODE, name: SCHEME_SUMMARY.name },
    status: 'DISBURSED',
    first_submitted_at: daysAgo(40),
    last_submitted_at: daysAgo(40),
    revision_count: 0,
    supplement_items: [],
    supplement_deadline: null,
    payment_date: daysAgo(3),
    tool_name: 'GitHub Copilot',
    purchase_amount: 3000,
    documents: [
      { document_type_code: 'ID_CARD_FRONT', revision: 1, is_current: true, uploaded_at: daysAgo(40), page_count: 1 },
    ],
    events: [
      { transition_code: '', from_status: null, to_status: 'SUBMITTED', actor_type: 'APPLICANT', created_at: daysAgo(40), rejection_codes: [] },
      { transition_code: 'T3', from_status: 'UNDER_REVIEW', to_status: 'APPROVED', actor_type: 'STAFF', created_at: daysAgo(20), rejection_codes: [] },
      { transition_code: 'T7', from_status: 'DISBURSING', to_status: 'DISBURSED', actor_type: 'STAFF', created_at: daysAgo(3), rejection_codes: [] },
    ],
    can_supplement: false,
    can_withdraw: false,
  },
}

/** 每個示範案件的末四碼，`POST /api/apply/verify` 用。 */
export const CASE_LAST4: Record<string, string> = {
  'HC-2026-900002': '0002',
  'HC-2026-900003': '0003',
  'HC-2026-900005': '0005',
}
