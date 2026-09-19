/** 首頁、說明、送件成功頁，以及確認步驟的送出閘門。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmStep } from '../apply/ConfirmStep'
import { lineDeepLink } from './SubmittedPage'
import SchemesPage from './SchemesPage'
import HelpPage from './HelpPage'
import SubmittedPage from './SubmittedPage'
import { Providers, renderAt } from '../test/utils'
import { SCHEME } from '../mocks/data'
import { initialState, type ApplyState } from '../apply/state'
import type { PrecheckView } from '../apply/precheck'

function state(overrides: Partial<ApplyState> = {}): ApplyState {
  return {
    ...initialState('HCAI115'),
    tool: { name: 'Claude Pro', tool_id: 'tool-claude' },
    identity: { applicant_name: '測試用小明', phone: '0912345678', id_last4: '1234', email: '', tier_code: 'GENERAL' },
    channel: {
      payment_channel_code: 'CREDIT_CARD',
      paid_by_proxy: false,
      purchase_date: '2026-08-01',
      purchase_amount: '6000',
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
  it('precheck FAIL 時送出被擋下，並說明怎麼修', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state()}
          requiredCodes={[]}
          view={failView}
          onManualAssist={vi.fn()}
          onSubmit={vi.fn()}
          submitting={false}
        />
      </Providers>,
    )
    expect((screen.getByRole('button', { name: '送出申請' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('帳單上的金額與你填寫的金額不一致')).toBeTruthy()
    expect(screen.getByRole('link', { name: '教我怎麼取得' }).getAttribute('href')).toBe(
      '/sop?document_type=BILLING_STATEMENT',
    )
  })

  it('勾了「請人工協助審核」之後就送得出去', () => {
    const onSubmit = vi.fn()
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state({ manualAssist: true })}
          requiredCodes={[]}
          view={failView}
          onManualAssist={vi.fn()}
          onSubmit={onSubmit}
          submitting={false}
        />
      </Providers>,
    )
    const button = screen.getByRole('button', { name: '送出申請' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onSubmit).toHaveBeenCalled()
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
          onSubmit={vi.fn()}
          submitting={false}
        />
      </Providers>,
    )
    expect(screen.queryByText('有文件需要先處理')).toBeNull()
    expect((screen.getByRole('button', { name: '送出申請' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('送出之前就把遮罩、保存期限、不送 AI 三件事說清楚（SPEC §15.6）', () => {
    render(
      <Providers>
        <ConfirmStep
          scheme={SCHEME}
          state={state()}
          requiredCodes={[]}
          view={null}
          onManualAssist={vi.fn()}
          onSubmit={vi.fn()}
          submitting={false}
        />
      </Providers>,
    )
    expect(screen.getByText(/原圖從未離開瀏覽器/)).toBeTruthy()
    expect(screen.getByText(/送給任何 AI 服務/)).toBeTruthy()
    expect(screen.getByText(/自動刪除/)).toBeTruthy()
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
          onSubmit={vi.fn()}
          submitting={false}
        />
      </Providers>,
    )
    // 一般青年 50%、上限 3,000：20,000 的一半是 10,000，所以顯示上限。
    expect(screen.getByText('NT$3,000')).toBeTruthy()
  })
})

describe('SchemesPage', () => {
  it('列出開放中的方案，每張卡只有一個主要動作', async () => {
    render(
      <Providers>
        <SchemesPage />
      </Providers>,
    )
    expect(await screen.findByText('115年度 AI領航青年數位工具補助計畫')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /開始申請/ }).length).toBe(3)
  })

  it('提供查詢、教學、常見問題三個次要入口', async () => {
    render(
      <Providers>
        <SchemesPage />
      </Providers>,
    )
    await screen.findByText('115年度 AI領航青年數位工具補助計畫')
    expect(screen.getByRole('link', { name: /查詢我的案件進度/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /教我怎麼取得文件/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /常見問題/ })).toBeTruthy()
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
