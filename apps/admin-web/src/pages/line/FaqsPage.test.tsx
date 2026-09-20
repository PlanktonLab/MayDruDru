import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import FaqsPage from './FaqsPage'
import * as queries from './queries'

vi.mock('../../lib/auth', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('./queries', () => ({ fetchFaqs: vi.fn(), updateFaq: vi.fn(), createFaq: vi.fn(), deleteFaq: vi.fn(), setFaqActive: vi.fn() }))

it('在右側抽屜編輯 FAQ 並帶版本儲存，關閉後保留列表', async () => {
  vi.mocked(queries.fetchFaqs).mockResolvedValue({ categories: ['申請'], items: [{
    id: 'faq-1', code: 'FAQ1', question: '如何補件？', answer: '先查詢案件。', category: '申請',
    keywords: ['補件'], priority: 1, active: true, scheme_id: null, source: 'staff', version: 3, updated_at: '2026-09-01',
  }] })
  vi.mocked(queries.updateFaq).mockImplementation(async () => (await queries.fetchFaqs({})).items[0]!)
  const user = userEvent.setup()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FaqsPage /></QueryClientProvider>)
  await user.click(await screen.findByRole('button', { name: '編輯' }))
  const drawer = screen.getByRole('dialog', { name: '編輯問題' })
  expect(drawer.className).toContain('right-0')
  await user.clear(within(drawer).getByLabelText('答案'))
  await user.type(within(drawer).getByLabelText('答案'), '查詢案件後上傳指定期數文件。')
  await user.click(within(drawer).getByRole('button', { name: '儲存' }))
  await waitFor(() => expect(queries.updateFaq).toHaveBeenCalledWith('faq-1', expect.objectContaining({ expected_version: 3, answer: '查詢案件後上傳指定期數文件。' })))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('如何補件？')).toBeTruthy()
})
