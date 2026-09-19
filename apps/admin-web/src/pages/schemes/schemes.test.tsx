/**
 * 方案管理區（SPEC §8.2）：清單、編輯器、六個分頁、規則編輯器與試算、待審工具、內容助理。
 *
 * 這些測試守的是幾件具體的事：編輯器存得了每一個 §6.2 欄位、撞到 409 時說的是
 * 「請重新載入」、四種 rule_type 各自出現正確的欄位、試算面板真的在瀏覽器裡跑了
 * `@maydru/review-rules`（所以它報的數字就是引擎算的）、助理產出的草稿看得到引用。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { ToastProvider } from '../../components/ui'
import SchemesPage, { windowText } from './SchemesPage'
import SchemeEditorPage from './SchemeEditorPage'
import ReviewSettingsPage from '../ReviewSettingsPage'
import { foldConfig, unfoldConfig, textToOcr } from './RulesTab'
import { countUnverified } from './CopilotPanel'
import * as queries from './queries'
import type {
  DocumentType, EligibleTool, PaymentChannel, RejectionCode, ReviewRuleRow, SchemeDetail, SchemeRow, Tier,
} from './types'

vi.mock('./queries', () => ({
  fetchSchemes: vi.fn(),
  fetchScheme: vi.fn(),
  createScheme: vi.fn(),
  patchScheme: vi.fn(),
  deleteScheme: vi.fn(),
  fetchChildren: vi.fn(),
  createChild: vi.fn(),
  patchChild: vi.fn(),
  deleteChild: vi.fn(),
  reorderChildren: vi.fn(),
  evaluateRules: vi.fn(),
  fetchPendingTools: vi.fn(),
  resolveTool: vi.fn(),
  generateSchemeCopy: vi.fn(),
  generateFaqSuggestions: vi.fn(),
  fetchFaqSuggestions: vi.fn(),
  acceptFaqSuggestion: vi.fn(),
  dismissFaqSuggestion: vi.fn(),
}))

const can = vi.fn(() => true)
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, loading: false, can, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

/* ------------------------------------------------------------------ 素材 */

const ROW: SchemeRow = {
  id: 's1', code: 'HC115', name: 'AI 領航青年數位工具補助', category: '青年', active: true,
  version: 3, retention_days: 90, supplement_days: 14, max_revisions: 3,
  application_start: '2026-09-01', application_end: '2026-12-31', updated_at: '2026-09-18T02:00:00Z',
}

const DETAIL: SchemeDetail = {
  id: 's1', code: 'HC115', name: 'AI 領航青年數位工具補助', category: '青年',
  description: '補助青年購買 AI 數位工具。', eligibility: '設籍本市、18 至 45 歲。',
  age_min: 18, age_max: 45, application_start: '2026-09-01', application_end: '2026-12-31',
  official_url: 'https://example.gov.tw', contact: '03-1234567', amount_note: '最高 3,000 元',
  tags: ['青年'], identity_tags: ['一般'], details: [], active: true,
  retention_days: 90, supplement_days: 14, max_revisions: 3,
  application_method: '線上申請', required_documents: ['身分證'], student_requirement: 'any',
  employment_requirement: 'any', residency_requirement: '新竹市', image_url: '', version: 3,
}

const TIERS: Tier[] = [
  { id: 't1', code: 'GENERAL', label: '一般', subsidy_rate: 0.5, cap_amount: 3000, required_proof_doc_types: [], sort_order: 0, version: 1 },
  { id: 't2', code: 'LOW_INCOME', label: '特定對象', subsidy_rate: 0.9, cap_amount: 6000, required_proof_doc_types: ['SPECIAL_PROOF'], sort_order: 1, version: 1 },
]

const DOCS: DocumentType[] = [
  { id: 'd1', code: 'ID_CARD_FRONT', label: '身分證正面', hint: '', required: true, required_when: '', must_mask: false, keep_visible: '', keep_after_disbursed: false, accepted_mime: ['image/png'], max_pages: 1, sort_order: 0, version: 1 },
  { id: 'd2', code: 'BILLING_STATEMENT', label: '信用卡帳單', hint: '需看得到臺幣金額', required: false, required_when: '', must_mask: true, keep_visible: '末四碼與金額', keep_after_disbursed: false, accepted_mime: ['image/png', 'application/pdf'], max_pages: 5, sort_order: 1, version: 2 },
]

const CHANNELS: PaymentChannel[] = [
  { id: 'c1', code: 'CREDIT_CARD', label: '信用卡', hint: '', required_document_type_codes: ['BILLING_STATEMENT'], guide_content_key: 'apply.guide.credit_card', sort_order: 0, version: 1 },
]

const RULES: ReviewRuleRow[] = [
  {
    id: 'r1', code: 'BILLING_TWD_AMOUNT', label: '帳單上有臺幣金額', document_type_code: 'BILLING_STATEMENT',
    rule_type: 'keyword_extract', required: true, severity: 'error', sort_order: 0, active: true, version: 1,
    config: { keywords: ['新臺幣', 'NT$'], value_after_keyword: true, regex: '[\\d,]+', normalize: 'amount' },
  },
  {
    id: 'r2', code: 'AMOUNT_MATCHES', label: '金額與申報相符', document_type_code: 'BILLING_STATEMENT',
    rule_type: 'amount_tolerance', required: true, severity: 'error', sort_order: 1, active: true, version: 1,
    config: { source_rule_code: 'BILLING_TWD_AMOUNT', compare_to: 'purchase_amount', tolerance_pct: 5, tolerance_abs: 150 },
  },
]

const REJECTIONS: RejectionCode[] = [
  { id: 'x1', code: 'BILLING_NO_TWD', staff_label: '帳單沒有臺幣金額', public_what_wrong: '看不到換算後的臺幣金額。', public_how_to_fix: '請重新上傳。', related_document_type_codes: ['BILLING_STATEMENT'], related_sop_flow_ids: ['flow-1'], sort_order: 0, active: true, version: 1 },
]

const TOOLS: EligibleTool[] = [
  { id: 'tool1', name: 'ChatGPT Plus', vendor: 'OpenAI', aliases: ['chatgpt'], status: 'APPROVED', verdict_note: '', request_count: 0, sort_order: 0, version: 1 },
  { id: 'tool2', name: 'chatgpt 訂閱', vendor: '', aliases: [], status: 'PENDING', verdict_note: '', request_count: 3, sort_order: 1, version: 1 },
]

const PENDING = [TOOLS[1]]

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

function renderList() {
  return render(
    <QueryClientProvider client={client()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/schemes']}>
          <Routes><Route path="/schemes" element={<SchemesPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function renderEditor() {
  return render(
    <QueryClientProvider client={client()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/schemes/HC115']}>
          <Routes><Route path="/schemes/:code" element={<SchemeEditorPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function renderReviewSettings(route = '/review-settings?scheme=HC115') {
  return render(
    <QueryClientProvider client={client()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes><Route path="/review-settings" element={<ReviewSettingsPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const openEditor = async () => { renderEditor(); await screen.findByDisplayValue('AI 領航青年數位工具補助') }
const goTab = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('tab', { name }))

beforeEach(() => {
  can.mockReturnValue(true)
  vi.mocked(queries.fetchSchemes).mockResolvedValue([ROW])
  vi.mocked(queries.fetchScheme).mockResolvedValue(DETAIL)
  vi.mocked(queries.createScheme).mockResolvedValue(ROW)
  vi.mocked(queries.patchScheme).mockResolvedValue(ROW)
  vi.mocked(queries.fetchPendingTools).mockResolvedValue(PENDING)
  vi.mocked(queries.createChild).mockResolvedValue({} as never)
  vi.mocked(queries.patchChild).mockResolvedValue({} as never)
  vi.mocked(queries.deleteChild).mockResolvedValue(undefined)
  vi.mocked(queries.reorderChildren).mockResolvedValue([] as never)
  vi.mocked(queries.resolveTool).mockResolvedValue(TOOLS[0])
  vi.mocked(queries.fetchChildren).mockImplementation((_code: string, kind: string) => {
    const table: Record<string, unknown[]> = {
      tiers: TIERS, 'document-types': DOCS, 'payment-channels': CHANNELS,
      'review-rules': RULES, 'rejection-codes': REJECTIONS, 'eligible-tools': TOOLS,
    }
    return Promise.resolve((table[kind] ?? []) as never)
  })
})

afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

/* ======================================================== 資料重點工作入口 */

describe('資料重點設定頁', () => {
  it('依方案顯示重點摘要，並共用規則編輯器', async () => {
    renderReviewSettings()
    expect(await screen.findByRole('heading', { name: '資料重點設定' })).toBeTruthy()
    expect(await screen.findByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('帳單上有臺幣金額')).toBeTruthy()
    expect(screen.getByRole('button', { name: /新增規則/ })).toBeTruthy()
  })

  it('沒有 admin 能力仍可檢視，但不能新增規則', async () => {
    can.mockReturnValue(false)
    renderReviewSettings()
    expect(await screen.findByText('帳單上有臺幣金額')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新增規則/ })).toBeNull()
  })
})

/* ================================================================== 清單 */

describe('方案清單', () => {
  it('申請期間兩端都沒填就說「沒有期限」，不是留白', () => {
    expect(windowText(null, null)).toBe('沒有期限')
    expect(windowText('2026-09-01', '2026-12-31')).toBe('2026-09-01 ～ 2026-12-31')
    expect(windowText('2026-09-01', null)).toBe('2026-09-01 起')
    expect(windowText(null, '2026-12-31')).toBe('即日起至 2026-12-31')
  })

  it('一列看得到代碼、名稱、類別、申請期間與收不收件', async () => {
    renderList()
    expect(await screen.findByText('HC115')).toBeTruthy()
    expect(screen.getByText('AI 領航青年數位工具補助')).toBeTruthy()
    expect(screen.getByText('青年')).toBeTruthy()
    expect(screen.getByText('2026-09-01 ～ 2026-12-31')).toBeTruthy()
    expect(screen.getAllByText('收件中').length).toBeGreaterThan(0)
  })

  it('關閉的方案標成「已關閉」', async () => {
    vi.mocked(queries.fetchSchemes).mockResolvedValue([{ ...ROW, active: false }])
    renderList()
    expect(await screen.findByText('已關閉')).toBeTruthy()
  })

  it('新增方案只問代碼與名稱，建好直接進編輯頁', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click(await screen.findByRole('button', { name: /新增方案/ }))
    await user.type(screen.getByLabelText(/方案代碼/), 'NEW116')
    await user.type(screen.getByLabelText(/方案名稱/), '新方案')
    await user.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(queries.createScheme).toHaveBeenCalledWith({ code: 'NEW116', name: '新方案' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/schemes/NEW116'))
  })

  it('代碼沒填就不會送出', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click(await screen.findByRole('button', { name: /新增方案/ }))
    await user.click(screen.getByRole('button', { name: '建立' }))
    expect(queries.createScheme).not.toHaveBeenCalled()
    expect(await screen.findByText(/方案代碼與名稱都要填/)).toBeTruthy()
  })

  it('沒有 admin 能力就看不到新增方案', async () => {
    can.mockReturnValue(false)
    renderList()
    await screen.findByText('HC115')
    expect(screen.queryByRole('button', { name: /新增方案/ })).toBeNull()
  })
})

/* ================================================================ 編輯器 */

describe('方案編輯器', () => {
  it('把每一個 §6.2 欄位都帶進表單', async () => {
    await openEditor()
    expect(screen.getByDisplayValue('補助青年購買 AI 數位工具。')).toBeTruthy()
    expect(screen.getByDisplayValue('設籍本市、18 至 45 歲。')).toBeTruthy()
    expect(screen.getByDisplayValue('最高 3,000 元')).toBeTruthy()
    expect(screen.getByDisplayValue('90')).toBeTruthy()     // 保存天數
    expect(screen.getByDisplayValue('新竹市')).toBeTruthy()
  })

  it('存檔時帶上載入時拿到的版本（樂觀鎖）', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(screen.getByRole('button', { name: /儲存基本資料/ }))
    await waitFor(() => expect(queries.patchScheme).toHaveBeenCalled())
    const [code, body] = vi.mocked(queries.patchScheme).mock.calls[0]
    expect(code).toBe('HC115')
    expect(body.expected_version).toBe(3)
    expect(body.name).toBe('AI 領航青年數位工具補助')
    expect(body.max_revisions).toBe(3)
  })

  it('改過的欄位真的送出去', async () => {
    const user = userEvent.setup()
    await openEditor()
    const name = screen.getByDisplayValue('AI 領航青年數位工具補助')
    await user.clear(name)
    await user.type(name, '改名後的方案')
    await user.click(screen.getByRole('button', { name: /儲存基本資料/ }))
    await waitFor(() => expect(vi.mocked(queries.patchScheme).mock.calls[0][1].name).toBe('改名後的方案'))
  })

  it('撞到 409 時說的是「請重新載入」，並留一顆重新載入鍵', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.patchScheme).mockRejectedValue(new ApiError(409, { message: '版本不符' }))
    await openEditor()
    await user.click(screen.getByRole('button', { name: /儲存基本資料/ }))
    expect(await screen.findByText(/這個方案剛剛被其他人改過了/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新載入/ })).toBeTruthy()
  })

  it('沒有 admin 能力就看不到儲存鍵', async () => {
    can.mockReturnValue(false)
    await openEditor()
    expect(screen.queryByRole('button', { name: /儲存基本資料/ })).toBeNull()
  })

  it('六個分頁都在', async () => {
    await openEditor()
    for (const name of ['身分別', '文件類型', '繳費管道', '審核規則', '退件碼', '合格工具']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy()
    }
  })

  it('身分別分頁列出補助比率與上限', async () => {
    await openEditor()
    expect(await screen.findByText('LOW_INCOME')).toBeTruthy()
    expect(screen.getByText('90%')).toBeTruthy()
    expect(screen.getByText('6,000')).toBeTruthy()
  })

  it('文件類型分頁標出「必須遮蔽」', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '文件類型')
    expect(await screen.findByText('BILLING_STATEMENT')).toBeTruthy()
    expect(screen.getByText('必須遮蔽')).toBeTruthy()
  })

  it('繳費管道分頁看得到必附文件與指引文案 key', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '繳費管道')
    expect(await screen.findByText('apply.guide.credit_card')).toBeTruthy()
  })

  it('退件碼分頁把承辦人的說法與民眾看的字分開列', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '退件碼')
    expect(await screen.findByText('帳單沒有臺幣金額')).toBeTruthy()
    expect(screen.getByText('看不到換算後的臺幣金額。')).toBeTruthy()
  })
})

/* ============================================================ 子表 CRUD */

describe('子設定表的共同操作', () => {
  it('新增一列會送出表單欄位', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(await screen.findByRole('button', { name: /新增身分別/ }))
    await user.type(screen.getByLabelText(/身分別代碼/), 'STUDENT')
    await user.type(screen.getByLabelText(/顯示名稱/), '在學學生')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(queries.createChild).toHaveBeenCalled())
    const [, kind, body] = vi.mocked(queries.createChild).mock.calls[0]
    expect(kind).toBe('tiers')
    expect(body.code).toBe('STUDENT')
    expect(body.label).toBe('在學學生')
  })

  it('必填欄位沒填就擋下來，並說少了哪一欄', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(await screen.findByRole('button', { name: /新增身分別/ }))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText(/還有必填欄位沒填：身分別代碼、顯示名稱/)).toBeTruthy()
    expect(queries.createChild).not.toHaveBeenCalled()
  })

  it('編輯一列會帶那一列的版本', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(await screen.findByRole('button', { name: '編輯 t2' }))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(queries.patchChild).toHaveBeenCalled())
    const [, kind, id, body] = vi.mocked(queries.patchChild).mock.calls[0]
    expect([kind, id]).toEqual(['tiers', 't2'])
    expect(body.expected_version).toBe(1)
  })

  it('子表撞到 409 時也說「請重新載入」', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.patchChild).mockRejectedValue(new ApiError(409, { message: '版本不符' }))
    await openEditor()
    await user.click(await screen.findByRole('button', { name: '編輯 t1' }))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText(/這筆設定剛剛被其他人改過了/)).toBeTruthy()
  })

  it('刪除要先確認', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(await screen.findByRole('button', { name: '刪除 t1' }))
    await user.click(await screen.findByRole('button', { name: '刪除' }))
    await waitFor(() => expect(queries.deleteChild).toHaveBeenCalledWith('HC115', 'tiers', 't1'))
  })

  it('上下移會把整段順序送去重寫', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.click(await screen.findByRole('button', { name: '下移 t1' }))
    await waitFor(() => expect(queries.reorderChildren).toHaveBeenCalledWith('HC115', 'tiers', ['t2', 't1']))
  })

  it('第一列不能再往上移', async () => {
    await openEditor()
    expect(screen.getByRole('button', { name: '上移 t1' }).hasAttribute('disabled')).toBe(true)
  })

  it('沒有 admin 能力就看不到任何編輯鍵', async () => {
    can.mockReturnValue(false)
    await openEditor()
    await screen.findByText('GENERAL')
    expect(screen.queryByRole('button', { name: '編輯 t1' })).toBeNull()
    expect(screen.queryByRole('button', { name: /新增身分別/ })).toBeNull()
  })
})

/* ============================================================ 規則編輯器 */

describe('審核規則編輯器', () => {
  it('config 在表單裡是平的，送出前折回一個 config 物件', () => {
    const folded = foldConfig({ code: 'X', 'config.keywords': ['a'], 'config.regex': '' })
    expect(folded).toEqual({ code: 'X', config: { keywords: ['a'] } })
  })

  it('讀進來的規則會把 config 攤平成表單欄位', () => {
    expect(unfoldConfig({ code: 'X', config: { pattern: 'a.b' } })['config.pattern']).toBe('a.b')
  })

  it('列表用中文說明每條規則的類型', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    expect((await screen.findAllByText('找關鍵字抽值')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('金額容差比對').length).toBeGreaterThan(0)
  })

  it('keyword_extract 的表單有關鍵字與「取關鍵字後面的字」', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.click(await screen.findByRole('button', { name: /新增規則/ }))
    expect(screen.getByLabelText(/^關鍵字/)).toBeTruthy()
    expect(screen.getByLabelText(/取關鍵字後面的字當值/)).toBeTruthy()
  })

  it('換成 regex_extract 就換成 pattern 與 group 的表單', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.selectOptions(screen.getByLabelText('規則類型表單'), 'regex_extract')
    await user.click(screen.getByRole('button', { name: /新增規則/ }))
    expect(screen.getByLabelText(/^regex/)).toBeTruthy()
    expect(screen.getByLabelText(/取第幾個 group/)).toBeTruthy()
  })

  it('amount_tolerance 的表單要選「金額從哪一條規則來」', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.selectOptions(screen.getByLabelText('規則類型表單'), 'amount_tolerance')
    await user.click(screen.getByRole('button', { name: /新增規則/ }))
    const select = screen.getByLabelText(/金額從哪一條規則來/)
    expect(within(select as HTMLSelectElement).getByText(/BILLING_TWD_AMOUNT/)).toBeTruthy()
    expect(screen.getByLabelText(/容差百分比/)).toBeTruthy()
  })

  it('required_doc 的表單列出這個方案的文件類型讓人勾', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.selectOptions(screen.getByLabelText('規則類型表單'), 'required_doc')
    await user.click(screen.getByRole('button', { name: /新增規則/ }))
    const group = screen.getByRole('group', { name: 'config.document_type_codes' })
    expect(within(group).getByLabelText('信用卡帳單')).toBeTruthy()
    expect(within(group).getByLabelText('身分證正面')).toBeTruthy()
  })

  it('新增規則時 config 折好才送出', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.selectOptions(screen.getByLabelText('規則類型表單'), 'regex_extract')
    await user.click(screen.getByRole('button', { name: /新增規則/ }))
    await user.type(screen.getByLabelText(/規則代碼/), 'RECEIPT_AMOUNT')
    await user.type(screen.getByLabelText(/規則名稱/), '收據金額')
    // 正則裡有 [ ]，user.type 會把它們當成按鍵描述符，所以用貼上
    await user.click(screen.getByLabelText(/^regex/))
    await user.paste('NT\\$([0-9]+)')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(queries.createChild).toHaveBeenCalled())
    const body = vi.mocked(queries.createChild).mock.calls[0][2]
    expect(body.rule_type).toBe('regex_extract')
    expect(body.config).toMatchObject({ pattern: 'NT\\$([0-9]+)' })
  })
})

/* ============================================================== 試算面板 */

describe('試算面板', () => {
  it('把貼進來的文字切成 OCR 的行', () => {
    const result = textToOcr('第一行\n第二行')
    expect(result.lines.map((l) => l.text)).toEqual(['第一行', '第二行'])
    expect(result.lines[1].bbox.y0).toBe(20)
  })

  it('一打開就用範例在瀏覽器裡跑一次，金額對得上判 MATCH', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    const panel = (await screen.findByText('試算')).closest('section') as HTMLElement
    expect(within(panel).getAllByText('MATCH').length).toBe(2)
    expect(within(panel).getByText('PASS')).toBeTruthy()
  })

  it('換成金額對不上的範例就判 MISMATCH 並說明會擋下來', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    await user.click(screen.getByRole('button', { name: /金額對不上/ }))
    const panel = (await screen.findByText('試算')).closest('section') as HTMLElement
    expect(within(panel).getByText('MISMATCH')).toBeTruthy()
    expect(within(panel).getByText('FAIL')).toBeTruthy()
    expect(within(panel).getByText(/有必填規則判為不符/)).toBeTruthy()
  })

  it('自己貼一段文字也會立刻重算', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '審核規則')
    const box = screen.getByLabelText('辨識出來的文字')
    await user.clear(box)
    await user.type(box, '什麼都沒有')
    const panel = (await screen.findByText('試算')).closest('section') as HTMLElement
    expect(within(panel).getAllByText('UNREADABLE').length).toBeGreaterThan(0)
  })

  it('「與伺服器對一次」判一樣時說一樣', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.evaluateRules).mockResolvedValue({
      verdict: 'PASS',
      findings: [
        { rule_code: 'BILLING_TWD_AMOUNT', status: 'MATCH', extracted_value: '1200', expected_value: null, confidence: 90, document_type_code: 'BILLING_STATEMENT', note: null },
        { rule_code: 'AMOUNT_MATCHES', status: 'MATCH', extracted_value: '1200', expected_value: '1200', confidence: 90, document_type_code: 'BILLING_STATEMENT', note: null },
      ],
      blocking: [], warnings: [], suggested_supplement: [],
    })
    await openEditor()
    await goTab(user, '審核規則')
    await user.click(screen.getByRole('button', { name: /與伺服器對一次/ }))
    expect(await screen.findByText(/伺服器判的一樣/)).toBeTruthy()
    expect(vi.mocked(queries.evaluateRules).mock.calls[0][0]).toBe('HC115')
  })

  it('兩邊判不一樣時直說那是引擎走鐘的徵兆', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.evaluateRules).mockResolvedValue({
      verdict: 'FAIL', findings: [], blocking: [], warnings: [], suggested_supplement: [],
    })
    await openEditor()
    await goTab(user, '審核規則')
    await user.click(screen.getByRole('button', { name: /與伺服器對一次/ }))
    expect(await screen.findByText(/和瀏覽器這一側不一致/)).toBeTruthy()
  })
})

/* ============================================================== 合格工具 */

describe('合格工具與待審佇列', () => {
  it('待審佇列列出民眾打的名稱與被問過幾次', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    const queue = (await screen.findByText('待審工具（1）')).closest('section') as HTMLElement
    expect(within(queue).getByText('chatgpt 訂閱')).toBeTruthy()
    expect(within(queue).getByText('3')).toBeTruthy()
  })

  it('核可會帶上判定說明', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    await user.type(await screen.findByLabelText('chatgpt 訂閱 的判定說明'), '查過了')
    await user.click(screen.getByRole('button', { name: /核可/ }))
    await waitFor(() => expect(queries.resolveTool).toHaveBeenCalledWith('HC115', 'tool2',
      { status: 'APPROVED', verdict_note: '查過了', merge_into_id: null }))
  })

  it('標為不適用送的是 REJECTED', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    await user.click(await screen.findByRole('button', { name: /不適用/ }))
    await waitFor(() => expect(vi.mocked(queries.resolveTool).mock.calls[0][2].status).toBe('REJECTED'))
  })

  it('併入既有工具時帶 merge_into_id', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    await user.selectOptions(await screen.findByLabelText('把 chatgpt 訂閱 併入'), 'tool1')
    await user.click(screen.getByRole('button', { name: /併入/ }))
    await waitFor(() => expect(vi.mocked(queries.resolveTool).mock.calls[0][2].merge_into_id).toBe('tool1'))
  })

  it('沒選要併到哪一個就按不下併入', async () => {
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    expect((await screen.findByRole('button', { name: /併入/ })).hasAttribute('disabled')).toBe(true)
  })

  it('沒有 admin 能力就動不了待審佇列', async () => {
    can.mockReturnValue(false)
    const user = userEvent.setup()
    await openEditor()
    await goTab(user, '合格工具')
    expect((await screen.findByRole('button', { name: /核可/ })).hasAttribute('disabled')).toBe(true)
  })
})

/* ============================================================== 內容助理 */

describe('內容助理（方案文案草稿）', () => {
  const RESULT = {
    scheme_code: 'HC115',
    requested: 2,
    drafts: [
      {
        key: 'scheme.HC115.status.APPROVED.public_label', version: 2,
        draft: '審核通過\n如有疑問請與承辦單位聯繫。（待查證）',
        citations: [{ source_type: 'scheme', source_id: 'HC115', quote: '補助青年購買 AI 數位工具。' }],
      },
      {
        key: 'scheme.HC115.guide.BILLING_STATEMENT', version: 2,
        draft: '請上傳看得到臺幣金額的帳單。',
        citations: [{ source_type: 'document_type', source_id: 'BILLING_STATEMENT', quote: '需看得到臺幣金額' }],
      },
    ],
  }

  it('沒產生過就是空的', async () => {
    await openEditor()
    expect(await screen.findByText('還沒有產生過草稿')).toBeTruthy()
  })

  it('按一下就產生草稿，每一則看得到 key 與引用', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.generateSchemeCopy).mockResolvedValue(RESULT)
    await openEditor()
    await user.click(screen.getByRole('button', { name: /一鍵產生方案文案草稿/ }))
    const key = await screen.findByText('scheme.HC115.status.APPROVED.public_label')
    const card = key.closest('li') as HTMLElement
    expect(within(card).getByText(/補助青年購買 AI 數位工具。/)).toBeTruthy()
    expect(screen.getByText('寫入 2 則草稿')).toBeTruthy()
  })

  it('把沒有依據的句子數出來，並說它們標了「待查證」', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.generateSchemeCopy).mockResolvedValue(RESULT)
    await openEditor()
    await user.click(screen.getByRole('button', { name: /一鍵產生方案文案草稿/ }))
    expect(await screen.findByText('1 句沒有依據，已標「待查證」')).toBeTruthy()
  })

  it('產出的每一則都是草稿，要發布得到罐頭訊息頁', async () => {
    const user = userEvent.setup()
    vi.mocked(queries.generateSchemeCopy).mockResolvedValue(RESULT)
    await openEditor()
    await user.click(screen.getByRole('button', { name: /一鍵產生方案文案草稿/ }))
    expect(await screen.findAllByText('草稿')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /到罐頭訊息頁逐則過目並發布/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^發布/ })).toBeNull()
  })

  it('數「待查證」是逐句數的', () => {
    expect(countUnverified(RESULT.drafts)).toBe(1)
    expect(countUnverified([])).toBe(0)
  })

  it('沒有 admin 能力就看不到產生鍵', async () => {
    can.mockReturnValue(false)
    await openEditor()
    expect(screen.queryByRole('button', { name: /一鍵產生方案文案草稿/ })).toBeNull()
  })
})
