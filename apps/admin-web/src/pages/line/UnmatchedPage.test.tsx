/** 未命中訊息：列表看得到，「忽略」只有管理員按得到。 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnmatchedMessage } from '../../lib/types'
import { ToastProvider } from '../../components/ui'
import UnmatchedPage from './UnmatchedPage'
import * as queries from './queries'

vi.mock('./queries', () => ({ fetchUnmatched: vi.fn(), dismissUnmatched: vi.fn() }))

const can = vi.fn(() => true)
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, loading: false, can, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

const ROW: UnmatchedMessage = {
  id: 'm1',
  text: '請問我可以申請第二次嗎',
  intent_result: { intent: 'unknown', confidence: 0.31 },
  user_hash: 'a1b2c3d4',
  created_at: '2026-09-18T02:00:00Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UnmatchedPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  vi.mocked(queries.fetchUnmatched).mockResolvedValue({ items: [ROW] })
  vi.mocked(queries.dismissUnmatched).mockResolvedValue(undefined)
})
afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('未命中訊息', () => {
  it('列出民眾打的字、分類結果與帳號雜湊，並說明這些資料的用途', async () => {
    renderPage()
    expect(await screen.findByText('請問我可以申請第二次嗎')).toBeTruthy()
    expect(screen.getByText('unknown')).toBeTruthy()
    expect(screen.getByText(/信心 31%/)).toBeTruthy()
    expect(screen.getByText(/不存也查不到是誰問的/)).toBeTruthy()
  })

  it('管理員按忽略會把那一筆刪掉', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('請問我可以申請第二次嗎')

    await user.click(screen.getByRole('button', { name: /忽略/ }))

    await waitFor(() => expect(queries.dismissUnmatched).toHaveBeenCalledWith('m1'))
  })

  it('沒有 admin 能力就看不到忽略按鈕', async () => {
    can.mockReturnValue(false)
    renderPage()
    await screen.findByText('請問我可以申請第二次嗎')

    expect(screen.queryByRole('button', { name: /忽略/ })).toBeNull()
  })
})
