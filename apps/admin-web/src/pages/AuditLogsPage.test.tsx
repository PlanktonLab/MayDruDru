import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import AuditLogsPage from './AuditLogsPage'
import { get } from '../lib/api'

vi.mock('../lib/api', () => ({ get: vi.fn() }))

beforeEach(() => {
  vi.mocked(get).mockResolvedValue({ items: [{
    id: 'a1', actor_name: '管理員甲', action: 'update', target_type: 'scheme', target_id: 'HC115',
    diff: { name: { from: '舊', to: '新' } }, created_at: '2026-09-19T08:00:00Z',
  }], total: 1, offset: 0, limit: 100 })
})

it('顯示操作者、資源與欄位差異', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuditLogsPage />
  </QueryClientProvider>)
  expect(await screen.findByText('管理員甲')).toBeTruthy()
  expect(screen.getByText('scheme')).toBeTruthy()
  expect(screen.getByText(/"from": "舊"/)).toBeTruthy()
})
