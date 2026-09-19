/** LINE Demo 主動通知與匿名 Feedback 後台。 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import LineNotificationsPage from './NotificationsPage'
import * as queries from './queries'

vi.mock('./queries', () => ({
  fetchNotifications: vi.fn(),
  fetchFeedback: vi.fn(),
  sendDemoNotification: vi.fn(),
}))

const can = vi.fn(() => true)
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, loading: false, can, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <LineNotificationsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  vi.mocked(queries.fetchNotifications).mockResolvedValue({ items: [] })
  vi.mocked(queries.fetchFeedback).mockResolvedValue({
    items: [{
      id: 'f1',
      case_no: 'HC-2026-900001',
      user_hash: 'a1b2c3d4',
      context: 'sop_complete',
      text: '步驟很清楚，謝謝',
      created_at: '2026-09-20T03:00:00Z',
    }],
  })
  vi.mocked(queries.sendDemoNotification).mockResolvedValue({ case_no: 'HC-2026-900001', queued: 1, skipped: 0 })
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('LINE 推播 Demo', () => {
  it('管理員可依案件編號發送缺件提醒，並在後台看到匿名回饋', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('步驟很清楚，謝謝')).toBeTruthy()
    expect(screen.getByText('a1b2c3d4')).toBeTruthy()
    await user.type(screen.getByRole('textbox', { name: 'Demo 案件編號' }), 'HC-2026-900001')
    await user.click(screen.getByRole('button', { name: /Demo 發送/ }))

    await waitFor(() => expect(queries.sendDemoNotification).toHaveBeenCalledWith({
      case_no: 'HC-2026-900001',
      document_code: 'BILLING_STATEMENT',
    }))
  })

  it('沒有 admin 能力時不顯示 Demo 發送介面', async () => {
    can.mockReturnValue(false)
    renderPage()
    await screen.findByText('步驟很清楚，謝謝')

    expect(screen.queryByRole('button', { name: /Demo 發送/ })).toBeNull()
  })
})
