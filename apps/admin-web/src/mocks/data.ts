/** MSW 用的假資料：新竹市方案的案件審核。
 *
 * 代碼與文案對齊 `apps/api/scripts/seed_data.py`；姓名、電話、金額全是編的，
 * 文件的 object key 指向不存在的位置（CLAUDE.md 規則 9）。
 */

import type {
  CaseDetail,
  CaseDocument,
  CaseFinding,
  DocumentTypeOption,
  RejectionCodeOption,
  ReviewRule,
} from '../cases/types'
import type { User } from '../lib/types'

export const SCHEME_CODE = 'HCAI115'
export const SCHEME_NAME = '115年度 AI領航青年數位工具補助計畫'

export const CURRENT_USER: User = {
  id: 'user-reviewer',
  tenant_id: 'tenant-1',
  email: 'reviewer@example.gov.tw',
  name: '示範承辦',
  role: 'case_supervisor',
  is_active: true,
}

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
  { code: 'ID_CARD_FRONT', label: '身分證正面' },
  { code: 'ID_CARD_BACK', label: '身分證反面' },
  { code: 'OFFICIAL_RECEIPT', label: '官方收據' },
  { code: 'CARD_LAST4_PHOTO', label: '信用卡圖片' },
  { code: 'BILLING_STATEMENT', label: '信用卡帳單扣款紀錄' },
  { code: 'BANKBOOK_COVER', label: '存摺封面影本' },
  { code: 'AFFIDAVIT', label: '切結書' },
]

export const REJECTION_CODES: RejectionCodeOption[] = [
  {
    code: 'BILLING_NO_TWD',
    public_what_wrong: '出帳帳單上看不到換算後的臺幣金額',
    public_how_to_fix: '請重新取得一份含臺幣金額的帳單。下方是你的付款方式的取得步驟。',
    related_document_type_codes: ['BILLING_STATEMENT'],
  },
  {
    code: 'BILLING_AMOUNT_MISMATCH',
    public_what_wrong: '帳單上的金額與你填寫的金額不一致',
    public_how_to_fix: '請以帳單上實際扣款的臺幣金額為準，回到申請資料修正填報金額。',
    related_document_type_codes: ['BILLING_STATEMENT'],
  },
  {
    code: 'DOC_MISSING',
    public_what_wrong: '有一份必要文件沒有收到',
    public_how_to_fix: '請補上承辦標示的那一份文件。',
    related_document_type_codes: [],
  },
  {
    code: 'OTHER',
    public_what_wrong: '其他需要修正的事項',
    public_how_to_fix: '請參考承辦的補充說明。',
    related_document_type_codes: [],
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
    code: 'AMOUNT_MATCHES_CLAIM',
    label: '帳單金額與申報金額相符',
    document_type_code: 'BILLING_STATEMENT',
    rule_type: 'amount_tolerance',
    required: true,
    severity: 'error',
    sort_order: 5,
    active: true,
    // tolerance_pct 是百分比（5 = 5%），與 seed_data.py 一致。
    config: {
      source_rule_code: 'BILLING_TWD_AMOUNT',
      compare_to: 'purchase_amount',
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

const now = new Date()
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

function document(
  id: string,
  code: string,
  label: string,
  extra: Partial<CaseDocument> = {},
): CaseDocument {
  return {
    id,
    document_type_code: code,
    document_type_label: label,
    revision: 1,
    supersedes_id: null,
    is_current: true,
    mime: 'image/jpeg',
    size: 184_320,
    page_count: 1,
    masked: false,
    uploaded_at: daysAgo(5),
    preview_key: null,
    purged_at: null,
    ocr: null,
    ...extra,
  }
}

const billingOcr = {
  source: 'applicant' as const,
  engine: 'tesseract.js@6',
  confidence: 86,
  lines: [
    { text: '臺幣 6,000', confidence: 88, bbox: { x0: 120, y0: 340, x1: 420, y1: 380 }, words: [] },
    { text: '卡號 **** 4242', confidence: 84, bbox: { x0: 120, y0: 400, x1: 470, y1: 438 }, words: [] },
    { text: '扣款日 2026/08/01', confidence: 87, bbox: { x0: 120, y0: 460, x1: 520, y1: 498 }, words: [] },
  ],
}

function finding(
  ruleCode: string,
  status: CaseFinding['status'],
  extra: Partial<CaseFinding> = {},
): CaseFinding {
  return {
    id: `finding-${ruleCode}`,
    rule_code: ruleCode,
    rule_id: `rule-${ruleCode}`,
    status,
    extracted_value: null,
    expected_value: null,
    confidence: null,
    bbox: null,
    document_type_code: null,
    note: null,
    suggested_supplement: undefined,
    source: 'auto',
    reviewer: null,
    decided_at: null,
    document_id: null,
    superseded: false,
    ...extra,
  }
}

const REQUIRED_DOCS = [
  'ID_CARD_FRONT',
  'ID_CARD_BACK',
  'OFFICIAL_RECEIPT',
  'CARD_LAST4_PHOTO',
  'BILLING_STATEMENT',
  'BANKBOOK_COVER',
  'AFFIDAVIT',
]

function baseCase(caseNo: string, overrides: Partial<CaseDetail>): CaseDetail {
  return {
    case_no: caseNo,
    applicant_name_masked: '王○明',
    applicant_name: '示範用王小明',
    phone_masked: '09**-***-678',
    email: null,
    id_last4_masked: '****1234',
    scheme_id: 'scheme-1',
    scheme_code: SCHEME_CODE,
    scheme_name: SCHEME_NAME,
    tier_code: 'GENERAL',
    payment_channel_code: 'CREDIT_CARD',
    tool_name: 'ChatGPT Plus',
    purchase_amount: 6000,
    purchase_date: '2026-08-01',
    paid_by_proxy: false,
    note: null,
    status: 'UNDER_REVIEW',
    first_submitted_at: daysAgo(5),
    last_submitted_at: daysAgo(5),
    supplement_deadline: null,
    supplement_items: [],
    payment_date: null,
    payment_amount: null,
    approved_amount: null,
    revision_count: 0,
    assigned_reviewer: null,
    assigned_reviewer_id: null,
    verdict: 'PASS',
    intake_channel: 'WEB',
    version: 1,
    required_document_types: REQUIRED_DOCS,
    documents_purge_at: null,
    documents: [
      document('doc-id-front', 'ID_CARD_FRONT', '身分證正面'),
      document('doc-billing', 'BILLING_STATEMENT', '信用卡帳單扣款紀錄', {
        masked: true,
        ocr: billingOcr,
      }),
    ],
    findings: [
      finding('BILLING_TWD_AMOUNT', 'MATCH', {
        extracted_value: '6000',
        confidence: 88,
        bbox: { x0: 120, y0: 340, x1: 420, y1: 380 },
        document_type_code: 'BILLING_STATEMENT',
        document_id: 'doc-billing',
      }),
      finding('AMOUNT_MATCHES_CLAIM', 'MATCH', {
        extracted_value: '6000',
        expected_value: '6000',
        document_type_code: 'BILLING_STATEMENT',
        document_id: 'doc-billing',
      }),
      finding('REQUIRED_DOCS_PRESENT', 'MATCH', { expected_value: REQUIRED_DOCS.join(',') }),
    ],
    events: [
      {
        transition_code: '',
        from_status: null,
        to_status: 'SUBMITTED',
        actor_type: 'APPLICANT',
        created_at: daysAgo(5),
        rejection_codes: [],
      },
      {
        transition_code: 'T1',
        from_status: 'SUBMITTED',
        to_status: 'UNDER_REVIEW',
        actor_type: 'SYSTEM',
        created_at: daysAgo(5),
        rejection_codes: [],
      },
    ],
    rules: REVIEW_RULES,
    allowed_transitions: [
      { code: 'T2', label: '要求補件', to_status: 'NEEDS_REVISION', needs_reason: false, needs_rejection_codes: false, needs_supplement_items: true },
      { code: 'T3', label: '核定', to_status: 'APPROVED', needs_reason: false, needs_rejection_codes: false, needs_supplement_items: false },
      { code: 'T9', label: '不通過', to_status: 'REJECTED', needs_reason: true, needs_rejection_codes: true, needs_supplement_items: false },
      { code: 'T11', label: '註銷案件', to_status: 'CANCELLED_BY_STAFF', needs_reason: true, needs_rejection_codes: false, needs_supplement_items: false },
    ],
    approval_blockers: [],
    ...overrides,
  }
}

/** 兩件案子：一件規則全數符合可以核定，一件有規則擋著核定。 */
export const CASES: Record<string, CaseDetail> = {
  'HC-2026-900002': baseCase('HC-2026-900002', {}),
  'HC-2026-900003': baseCase('HC-2026-900003', {
    applicant_name_masked: '李○美',
    applicant_name: '示範用李小美',
    tool_name: 'Midjourney',
    purchase_amount: 3600,
    verdict: 'FAIL',
    first_submitted_at: daysAgo(9),
    last_submitted_at: daysAgo(9),
    findings: [
      finding('BILLING_TWD_AMOUNT', 'MATCH', {
        extracted_value: '1200',
        confidence: 71,
        bbox: { x0: 120, y0: 340, x1: 420, y1: 380 },
        document_type_code: 'BILLING_STATEMENT',
        document_id: 'doc-billing',
      }),
      finding('AMOUNT_MATCHES_CLAIM', 'MISMATCH', {
        extracted_value: '1200',
        expected_value: '3600',
        document_type_code: 'BILLING_STATEMENT',
        document_id: 'doc-billing',
        note: 'review.note.amount_mismatch',
      }),
      finding('REQUIRED_DOCS_PRESENT', 'MATCH', { expected_value: REQUIRED_DOCS.join(',') }),
    ],
    approval_blockers: [
      { rule_code: 'AMOUNT_MATCHES_CLAIM', label: '帳單金額與申報金額相符', status: 'MISMATCH' },
    ],
  }),
  'HC-2026-900005': baseCase('HC-2026-900005', {
    applicant_name_masked: '陳○芳',
    applicant_name: '示範用陳小芳',
    tool_name: 'GitHub Copilot',
    purchase_amount: 3000,
    status: 'DISBURSED',
    approved_amount: 2700,
    payment_date: daysAgo(3),
    first_submitted_at: daysAgo(40),
    last_submitted_at: daysAgo(40),
    assigned_reviewer: { id: 'user-reviewer', name: '示範承辦' },
    assigned_reviewer_id: 'user-reviewer',
    allowed_transitions: [],
  }),
}

export const REVIEWERS = [
  { id: 'user-reviewer', name: '示範承辦' },
  { id: 'user-supervisor', name: '示範覆核' },
]

export const SCHEME_SETTINGS = {
  supplement_days: 14,
  rejection_codes: REJECTION_CODES,
  document_types: DOCUMENT_TYPES,
}
