/** 首頁、說明、送件成功頁，以及確認步驟的送出閘門。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { ConfirmStep } from '../apply/ConfirmStep'
import { lineDeepLink } from './SubmittedPage'
import ApplyPage from './ApplyPage'
import HelpPage from './HelpPage'
import SubmittedPage from './SubmittedPage'
import { server } from '../mocks/server'
import { Providers, renderAt } from '../test/utils'
import { SCHEME } from '../mocks/data'
import { initialState, type ApplyState } from '../apply/state'
import type { PrecheckView } from '../apply/precheck'

function state(overrides: Partial<ApplyState> = {}): ApplyState {
  return {
    ...initialState('HCAI115'),
    tool: { name: 'Claude Pro', tool_id: 'tool-claude' },
    identity: { applicant_name: '測試用小明', phone: '0912345678', id_number: 'A123456789', email: 'test@example.com', tier_code: 'GENERAL' },
    channel: {
      payment_channel_code: 'CREDIT_CARD',
      paid_by_proxy: false,
      purchase_date: '2026-08-01',
      purchase_amount: '6000',
      billing_cycle: 'MONTHLY',
      billing_periods: 1,
      original_currency: 'USD',
      original_amount: '20',
    },
    ...overrides,
  }
}

const failView: PrecheckView = {
  verdict: 'FAIL',
  findings: [],
  blocking: [
    {
      rule_code: 'AMOUNT_MATCHES_CLAIM',
      status: 'MISMATCH',
      extracted_value: '6000',
      expected_value: '20000',
      confidence: 90,
      bbox: null,
      document_type_code: 'BILLING_STATEMENT',
      note: null,
    },
  ],
  warnings: [],
  problemsByDoc: {},
  missingDocumentTypes: [],
}

describe('ConfirmStep', () => {
  it('precheck FAIL 時說明怎麼修，並附上取件教學連結', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state()}
          requiredCodes={[]}
          view={failView}
          onManualAssist={vi.fn()}
        />
      </Providers>,
    )
    // 送出按鈕本身畫在 `ApplyPage` 的導覽列，這裡只驗問題的說明。
    expect(screen.getByText('帳單上的金額與你填寫的金額不一致')).toBeTruthy()
    expect(screen.getByText('等待你的確認')).toBeTruthy()
    expect(screen.getByRole('button', { name: /忽略 OCR 提示/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: '教我怎麼取得' }).getAttribute('href')).toBe(
      '/sop?document_type=BILLING_STATEMENT',
    )
  })

  it('忽略 OCR 提示之後不再顯示「等待你的確認」', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state({ manualAssist: true })}
          requiredCodes={[]}
          view={failView}
          onManualAssist={vi.fn()}
        />
      </Providers>,
    )
    expect(screen.queryByText('等待你的確認')).toBeNull()
    expect(screen.getByText(/需人工檢視/)).toBeTruthy()
  })

  it('PASS 時不顯示任何問題卡片', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state()}
          requiredCodes={[]}
          view={{ verdict: 'PASS', findings: [], blocking: [], warnings: [], problemsByDoc: {}, missingDocumentTypes: [] }}
          onManualAssist={vi.fn()}
        />
      </Providers>,
    )
    expect(screen.queryByText('有文件需要先處理')).toBeNull()
    expect(screen.queryByText('等待你的確認')).toBeNull()
  })

  it('預估補助金額依級距與上限計算', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state({ channel: { ...state().channel, purchase_amount: '20000' } })}
          requiredCodes={[]}
          view={null}
          onManualAssist={vi.fn()}
        />
      </Providers>,
    )
    // 一般青年 50%、上限 3,000：20,000 的一半是 10,000，所以顯示上限。
    expect(screen.getByText('NT$3,000')).toBeTruthy()
  })
})

describe('首頁', () => {
  it('不先讓人選方案，直接進入唯一那個補助計畫的第一步', async () => {
    renderAt(<ApplyPage />, '/', '/')
    // 開放中的方案只有一個，所以進站看到的就是申請流程的第一步。
    expect(await screen.findByRole('heading', { name: '確認申請工具' })).toBeTruthy()
  })

  it('沒有開放中的方案時說明現況，並給查詢案件的出口', async () => {
    server.use(http.get('/api/apply/schemes', () => HttpResponse.json([])))
    renderAt(<ApplyPage />, '/', '/')
    expect(await screen.findByText('目前沒有開放中的方案')).toBeTruthy()
    expect(screen.getByRole('button', { name: /查詢案件進度/ })).toBeTruthy()
  })
})

describe('HelpPage', () => {
  it('載入 FAQ 並可在前端即時縮小範圍', async () => {
    render(
      <Providers>
        <HelpPage />
      </Providers>,
    )
    expect(await screen.findByText('什麼是「出帳帳單」？我要去哪裡拿？')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜尋問題'), { target: { value: '保留多久' } })
    await waitFor(() => expect(screen.queryByText('什麼是「出帳帳單」？我要去哪裡拿？')).toBeNull())
    expect(await screen.findByText('我的證件照片會被保留多久？')).toBeTruthy()
  })
})

describe('SubmittedPage', () => {
  it('把案件編號放到最大，並要求截圖保存', () => {
    renderAt(<SubmittedPage />, '/apply/:scheme/done', '/apply/HCAI115/done?case=HC-2026-900123')
    expect(screen.getByText('HC-2026-900123')).toBeTruthy()
    expect(screen.getByText(/請截圖保存/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /查看案件進度/ }).getAttribute('href')).toBe('/status/HC-2026-900123')
  })

  it('沒有案號時導去查詢頁，而不是顯示空白', () => {
    renderAt(<SubmittedPage />, '/apply/:scheme/done', '/apply/HCAI115/done')
    expect(screen.getByText('找不到案件編號')).toBeTruthy()
  })

  it('LINE deep link 帶著案號，沒設定官方帳號時不產生連結', () => {
    expect(lineDeepLink('HC-2026-900123', '@maydru')).toBe(
      'https://line.me/R/oaMessage/%40maydru/?case=HC-2026-900123',
    )
    expect(lineDeepLink('HC-2026-900123', undefined)).toBeNull()
  })
})
