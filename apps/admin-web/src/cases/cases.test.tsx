/** 案件審核區：佇列、案件頁、覆寫、決策列（SPEC §8.2）。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import CasesQueuePage from '../pages/CasesQueuePage'
import CaseReviewPage from '../pages/CaseReviewPage'
import { DecisionBar } from './DecisionBar'
import { ComparePanel, compareAmounts } from './ComparePanel'
import { clampZoom, toPercentBox } from './DocumentViewer'
import { REVIEW_NOTE_FALLBACK, renderNote } from './reviewNotes'
import { deadlineFromToday } from './labels'
import { queueQueryString, DEFAULT_FILTERS } from './api'
import { renderAt } from '../test/utils'
import { server } from '../mocks/server'
import { DOCUMENT_TYPES, REJECTION_CODES, REVIEW_RULES } from '../mocks/data'
import type { AllowedTransition, ApprovalBlocker, CaseFinding, TransitionInput } from './types'

vi.mock('@maydru/ocr', async () => ({
  createOcrWorker: vi.fn(async () => ({ terminate: vi.fn() })),
  recognize: vi.fn(async () => ({ text: '', confidence: 90, lines: [] })),
}))

function openQueue() {
  return renderAt(<CasesQueuePage />, '/cases', '/cases')
}

function openCase(caseNo: string) {
  return renderAt(<CaseReviewPage />, '/cases/:case_no', `/cases/${caseNo}`)
}

describe('佇列查詢字串', () => {
  it('空白的篩選條件不會出現在 query 裡', () => {
    expect(queueQueryString(DEFAULT_FILTERS)).toBe('page=1&page_size=20')
  })

  it('搜尋字串會被 trim', () => {
    expect(queueQueryString({ ...DEFAULT_FILTERS, q: '  HC-2026  ' })).toContain('q=HC-2026')
  })

  it('每個篩選條件都送得出去', () => {
    const query = queueQueryString({
      ...DEFAULT_FILTERS,
      status: 'UNDER_REVIEW',
      scheme: 'HCAI115',
      assigned: 'me',
      verdict: 'FAIL',
    })
    expect(query).toContain('status=UNDER_REVIEW')
    expect(query).toContain('scheme=HCAI115')
    expect(query).toContain('assigned=me')
    expect(query).toContain('verdict=FAIL')
  })
})

describe('CasesQueuePage', () => {
  it('依第一次送件時間遞增列出案件', async () => {
    openQueue()
    await screen.findByText('HC-2026-900005')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('HC-2026-900005')
  })

  it('只顯示遮罩後的姓名', async () => {
    openQueue()
    expect(await screen.findByText('王○明')).toBeTruthy()
    expect(screen.queryByText('示範用王小明')).toBeNull()
  })

  it('狀態篩選會縮小清單', async () => {
    openQueue()
    await screen.findByText('HC-2026-900002')
    fireEvent.change(screen.getByLabelText('狀態'), { target: { value: 'DISBURSED' } })
    await waitFor(() => expect(screen.queryByText('HC-2026-900002')).toBeNull())
    expect(await screen.findByText('HC-2026-900005')).toBeTruthy()
  })

  it('規則判定篩選會縮小清單', async () => {
    openQueue()
    await screen.findByText('HC-2026-900002')
    fireEvent.change(screen.getByLabelText('規則判定'), { target: { value: 'FAIL' } })
    await waitFor(() => expect(screen.queryByText('HC-2026-900002')).toBeNull())
    expect(await screen.findByText('HC-2026-900003')).toBeTruthy()
  })

  it('搜尋可以用工具名稱找到案件', async () => {
    openQueue()
    await screen.findByText('HC-2026-900002')
    fireEvent.change(screen.getByPlaceholderText(/案件編號、姓名、工具名稱/), {
      target: { value: 'midjourney' },
    })
    await waitFor(() => expect(screen.queryByText('HC-2026-900002')).toBeNull())
    expect(await screen.findByText('HC-2026-900003')).toBeTruthy()
  })

  it('「尚未指派」只留下沒有審核人的案件', async () => {
    openQueue()
    await screen.findByText('HC-2026-900005')
    fireEvent.change(screen.getByLabelText('指派'), { target: { value: 'none' } })
    await waitFor(() => expect(screen.queryByText('HC-2026-900005')).toBeNull())
    expect(await screen.findByText('HC-2026-900002')).toBeTruthy()
  })

  it('沒有符合的案件時給一個清除篩選的出口', async () => {
    openQueue()
    await screen.findByText('HC-2026-900002')
    fireEvent.change(screen.getByLabelText('狀態'), { target: { value: 'REJECTED' } })
    expect(await screen.findByText('沒有符合條件的案件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除篩選' }))
    expect(await screen.findByText('HC-2026-900002')).toBeTruthy()
  })

  it('顯示總件數與頁數', async () => {
    openQueue()
    expect(await screen.findByText(/共 3 件/)).toBeTruthy()
  })
})

describe('CaseReviewPage', () => {
  it('顯示完整申請資料與遮罩過的聯絡方式', async () => {
    openCase('HC-2026-900002')
    expect(await screen.findByText('示範用王小明')).toBeTruthy()
    expect(screen.getByText('09**-***-678')).toBeTruthy()
  })

  it('規則判定卡列出抽到的值與狀態，不出現任何「建議」', async () => {
    openCase('HC-2026-900002')
    await screen.findByText('帳單上有換算後的臺幣金額')
    const panel = screen.getByText('規則判定').closest('section')!
    expect(within(panel).getAllByText('符合').length).toBeGreaterThan(0)
    expect(panel.textContent).not.toContain('建議')
    expect(panel.textContent).not.toContain('AI')
  })

  it('note 以文案 key 回來時渲染成句子，不露出 key', async () => {
    openCase('HC-2026-900003')
    expect(await screen.findByText(REVIEW_NOTE_FALLBACK['review.note.amount_mismatch'])).toBeTruthy()
    expect(screen.queryByText('review.note.amount_mismatch')).toBeNull()
  })

  it('沒有 bbox 的 finding 不能按「定位」', async () => {
    openCase('HC-2026-900002')
    await screen.findByText('必要文件齊備')
    const card = screen.getByText('必要文件齊備').closest('li')!
    expect((within(card).getByRole('button', { name: '定位' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('覆寫會 PUT 到 findings 端點，並寫上人工判定', async () => {
    const calls: { url: string; body: unknown }[] = []
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT') calls.push({ url: request.url, body: await request.clone().json() })
    })
    openCase('HC-2026-900003')
    await screen.findByText('規則判定')
    const panel = screen.getByText('規則判定').closest('section')!
    const card = within(panel).getByText('帳單上有換算後的臺幣金額').closest('li')!
    fireEvent.click(within(card).getByRole('button', { name: '覆寫' }))
    await screen.findByText(/覆寫判定/)
    fireEvent.change(screen.getByLabelText('判定'), { target: { value: 'MATCH' } })
    fireEvent.change(screen.getByLabelText('更正後的值'), { target: { value: '3600' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存覆寫' }))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].url).toContain('/findings/BILLING_TWD_AMOUNT')
    expect(calls[0].body).toMatchObject({ status: 'MATCH', extracted_value: '3600' })
    server.events.removeAllListeners()
  })

  it('有 approval_blockers 時核定按鈕停用，而且把原因列出來', async () => {
    openCase('HC-2026-900003')
    await screen.findByRole('button', { name: '核定' })
    expect((screen.getByRole('button', { name: '核定' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/還不能核定/)).toBeTruthy()
    const blockers = screen.getByText(/還不能核定/).closest('div')!
    expect(blockers.textContent).toContain('帳單金額與申報金額相符')
  })

  it('沒有 blockers 時核定按鈕可以按', async () => {
    openCase('HC-2026-900002')
    await screen.findByRole('button', { name: '核定' })
    expect((screen.getByRole('button', { name: '核定' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('金額比對顯示申報、辨識與差額', async () => {
    openCase('HC-2026-900003')
    await screen.findByText('金額比對')
    const panel = screen.getByText('金額比對').closest('section')!
    expect(panel.textContent).toContain('NT$3,600')
    expect(panel.textContent).toContain('NT$1,200')
    expect(panel.textContent).toContain('超出容差')
  })

  it('文件分頁列出目前版本，並標示 OCR 來源', async () => {
    openCase('HC-2026-900002')
    const tab = await screen.findByRole('tab', { name: /信用卡帳單扣款紀錄/ })
    // 預設選第一份（身分證正面），它沒有 OCR 結果；切到帳單才看得到來源。
    expect(screen.getByText('沒有 OCR 結果')).toBeTruthy()
    fireEvent.click(tab)
    expect(await screen.findByText('OCR 來源：申請人上傳')).toBeTruthy()
  })

  it('沒有審核人清單端點時指派選單停用並說明原因', async () => {
    openCase('HC-2026-900002')
    const select = (await screen.findByLabelText('指派審核人')) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(screen.getByText(/後端尚未提供審核人清單端點/)).toBeTruthy()
  })

  it('案件不存在時顯示錯誤與回佇列的出口', async () => {
    server.use(
      http.get('/api/admin/applications/:case_no', () =>
        HttpResponse.json({ code: 'CASE_NOT_FOUND' }, { status: 404 }),
      ),
    )
    openCase('HC-2026-999999')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: '回佇列' })).toBeTruthy()
  })
})

describe('DecisionBar', () => {
  const transitions: AllowedTransition[] = [
    { code: 'T2', label: '要求補件', to_status: 'NEEDS_REVISION', needs_reason: false, needs_rejection_codes: false, needs_supplement_items: true },
    { code: 'T3', label: '核定', to_status: 'APPROVED', needs_reason: false, needs_rejection_codes: false, needs_supplement_items: false },
    { code: 'T9', label: '不通過', to_status: 'REJECTED', needs_reason: true, needs_rejection_codes: true, needs_supplement_items: false },
  ]
  const blockers: ApprovalBlocker[] = [
    { rule_code: 'BILLING_TWD_AMOUNT', label: '帳單上有換算後的臺幣金額', status: 'UNREADABLE' },
  ]

  function renderBar(
    onSubmit = vi.fn(async (_input: TransitionInput) => {}),
    withBlockers = false,
  ) {
    render(
      <DecisionBar
        transitions={transitions}
        blockers={withBlockers ? blockers : []}
        rejectionCodes={REJECTION_CODES}
        documentTypes={DOCUMENT_TYPES}
        supplementDays={14}
        onSubmit={onSubmit}
      />,
    )
    return onSubmit
  }

  it('補件表單至少要勾一份文件才送得出去', async () => {
    const onSubmit = renderBar()
    fireEvent.click(screen.getByRole('button', { name: '要求補件' }))
    fireEvent.click(await screen.findByRole('button', { name: '送出補件要求' }))
    expect(screen.getByRole('alert').textContent).toContain('請至少勾選一份要補的文件')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('勾了文件之後送出補件要求，帶上項目與期限', async () => {
    const onSubmit = renderBar()
    fireEvent.click(screen.getByRole('button', { name: '要求補件' }))
    await screen.findByText('補件期限')
    fireEvent.click(screen.getByText('信用卡帳單扣款紀錄'))
    fireEvent.click(screen.getByRole('button', { name: '送出補件要求' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const input = onSubmit.mock.calls[0][0]
    expect(input.code).toBe('T2')
    expect(input.supplement_items).toHaveLength(1)
    expect(input.supplement_items?.[0].document_type_code).toBe('BILLING_STATEMENT')
    expect(input.supplement_deadline).toBe(deadlineFromToday(14))
  })

  it('不通過要填理由並至少選一個退件原因', async () => {
    const onSubmit = renderBar()
    fireEvent.click(screen.getByRole('button', { name: '不通過' }))
    fireEvent.click(await screen.findByRole('button', { name: '確認不通過' }))
    expect(screen.getByRole('alert').textContent).toContain('請填寫理由')
    fireEvent.change(screen.getByLabelText(/理由/), { target: { value: '工具不符資格' } })
    fireEvent.click(screen.getByRole('button', { name: '確認不通過' }))
    expect(screen.getByRole('alert').textContent).toContain('請至少選一個退件原因')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('核定有 blockers 時停用，並列出擋住的規則', () => {
    renderBar(vi.fn(async (_input: TransitionInput) => {}), true)
    expect((screen.getByRole('button', { name: '核定' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('帳單上有換算後的臺幣金額')).toBeTruthy()
  })

  it('沒有可用轉移時說明是權限問題，而不是留一排死按鈕', () => {
    render(
      <DecisionBar
        transitions={[]}
        blockers={[]}
        rejectionCodes={REJECTION_CODES}
        documentTypes={DOCUMENT_TYPES}
        supplementDays={14}
        onSubmit={vi.fn(async (_input: TransitionInput) => {})}
      />,
    )
    expect(screen.getByText(/沒有可以執行的動作/)).toBeTruthy()
  })
})

describe('金額比對', () => {
  const findings: CaseFinding[] = [
    {
      id: 'f1',
      rule_id: null,
      rule_code: 'BILLING_TWD_AMOUNT',
      status: 'MATCH',
      extracted_value: 'NT$5,900',
      expected_value: null,
      confidence: 88,
      bbox: null,
      document_type_code: 'BILLING_STATEMENT',
      note: null,
      source: 'auto',
      reviewer: null,
      decided_at: null,
      document_id: null,
    },
  ]

  it('容差是百分比（5 = 5%），差額在範圍內時判定為在容差內', () => {
    const result = compareAmounts(6000, findings, REVIEW_RULES)
    expect(result.extracted).toBe(5900)
    expect(result.difference).toBe(100)
    expect(result.within).toBe(true)
  })

  it('超出容差時標示出來', () => {
    const result = compareAmounts(20000, findings, REVIEW_RULES)
    expect(result.within).toBe(false)
  })

  it('抽不到金額時不假裝有數字', () => {
    const result = compareAmounts(6000, [{ ...findings[0], extracted_value: null }], REVIEW_RULES)
    expect(result.extracted).toBeNull()
    expect(result.within).toBeNull()
  })

  it('面板會把容差寫出來', () => {
    render(<ComparePanel claimed={6000} findings={findings} rules={REVIEW_RULES} />)
    expect(screen.getByText(/容差：5% 以內/)).toBeTruthy()
  })
})

describe('文件檢視器的數學', () => {
  it('縮放夾在 0.5 – 3 之間', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(10)).toBe(3)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('bbox 換算成百分比', () => {
    expect(toPercentBox({ x0: 50, y0: 100, x1: 150, y1: 200 }, 500, 1000)).toEqual({
      left: 10,
      top: 10,
      width: 20,
      height: 10,
    })
  })

  it('沒有尺寸時寧可不畫框', () => {
    expect(toPercentBox({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0, 0)).toBeNull()
    expect(toPercentBox(null, 500, 500)).toBeNull()
  })
})

describe('note 渲染', () => {
  it('文案 key 換成句子', () => {
    expect(renderNote('review.note.no_document')).toBe(REVIEW_NOTE_FALLBACK['review.note.no_document'])
  })

  it('沒收錄的 key 也不會把 key 印出來', () => {
    expect(renderNote('review.note.brand_new')).toBe('這一項需要人工確認。')
  })

  it('已經是句子的字串原樣回傳（TS 版規則引擎的輸出）', () => {
    expect(renderNote('還缺 2 份文件：切結書、存摺封面影本。')).toBe('還缺 2 份文件：切結書、存摺封面影本。')
  })

  it('contents 的線上文案覆蓋本地備援', () => {
    expect(renderNote('review.note.no_document', { 'review.note.no_document': '線上文案' })).toBe('線上文案')
  })

  it('沒有 note 時回 null', () => {
    expect(renderNote(null)).toBeNull()
  })
})
