/** 案件查詢驗證（SPEC §8.1「查詢驗證」、決策 D17）。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { VerifyForm, lockoutMessage } from './VerifyForm'
import { Providers } from '../test/utils'
import { server } from '../mocks/server'
import { caseToken } from '../lib/api'

function fill(caseNo: string, last4: string) {
  fireEvent.change(screen.getByLabelText(/案件編號/), { target: { value: caseNo } })
  fireEvent.change(screen.getByLabelText(/末四碼/), { target: { value: last4 } })
  fireEvent.click(screen.getByRole('button', { name: '查詢' }))
}

describe('VerifyForm', () => {
  it('末四碼正確時拿到 token 並回報案號', async () => {
    const onVerified = vi.fn()
    render(
      <Providers>
        <VerifyForm onVerified={onVerified} />
      </Providers>,
    )
    fill('HC-2026-900002', '0002')
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('HC-2026-900002'))
    expect(caseToken.get()).toBeTruthy()
  })

  it('末四碼錯誤時的訊息不透露案件是否存在', async () => {
    render(
      <Providers>
        <VerifyForm onVerified={vi.fn()} />
      </Providers>,
    )
    fill('HC-2026-900002', '9999')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('案件編號或末四碼不正確')
  })

  it('被鎖定（423）時說明還要等多久', async () => {
    server.use(
      http.post('/api/apply/verify', () =>
        HttpResponse.json({ code: 'LOCKED', retry_after_seconds: 900 }, { status: 423 }),
      ),
    )
    render(
      <Providers>
        <VerifyForm onVerified={vi.fn()} />
      </Providers>,
    )
    fill('HC-2026-900002', '0002')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('15 分鐘')
    expect(alert.textContent).toContain('暫時鎖定')
  })

  it('末四碼不是 4 位數時不發請求，直接說怎麼填', () => {
    render(
      <Providers>
        <VerifyForm onVerified={vi.fn()} />
      </Providers>,
    )
    fill('HC-2026-900002', '12')
    expect(screen.getByRole('alert').textContent).toContain('4 位數字')
  })

  it('預填的案件編號會顯示在欄位裡', () => {
    render(
      <Providers>
        <VerifyForm initialCaseNo="HC-2026-900003" onVerified={vi.fn()} />
      </Providers>,
    )
    expect((screen.getByLabelText(/案件編號/) as HTMLInputElement).value).toBe('HC-2026-900003')
  })

  it('鎖定訊息會依剩餘秒數換算成人看得懂的時間', () => {
    expect(lockoutMessage(90)).toContain('1 分 30 秒')
    expect(lockoutMessage(30)).toContain('30 秒')
  })
})
