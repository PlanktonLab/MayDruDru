import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import SopMappingsPage from './SopMappingsPage'
import * as queries from './queries'

vi.mock('../../lib/hooks', () => ({
  useCanvas: () => ({
    data: {
      platforms: [{ id: 'p1', display_name: '示範銀行 App', brand: '示範', channel: 'mobile_app', aliases: [], demo_data: [], style_doc_version: 1, flow_count: 2, component_count: 0 }],
      flows: [
        { id: 'published', platform_id: 'p1', goal_ids: [], name: '下載帳單', status: 'published', current_version_id: 'v1', current_version: 1, drift_count: 0, updated_at: '' },
        { id: 'draft', platform_id: 'p1', goal_ids: [], name: '尚未發布', status: 'draft', current_version_id: null, current_version: null, drift_count: 0, updated_at: '' },
      ], steps: [], edges: [],
    }, isLoading: false, error: null,
  }),
}))

vi.mock('./queries', () => ({
  fetchSchemes: vi.fn(), fetchChildren: vi.fn(), fetchSopFlowLinks: vi.fn(), replaceSopFlowLinks: vi.fn(),
}))

const DOC = { id: 'd1', code: 'BILLING_STATEMENT', label: '信用卡帳單', hint: '', required: false,
  required_when: '', must_mask: true, keep_visible: '', keep_after_disbursed: false,
  accepted_mime: ['image/png'], max_pages: 5, sort_order: 1, version: 1 } as const

function open() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><SopMappingsPage /></ToastProvider>
  </QueryClientProvider>)
}

describe('SopMappingsPage', () => {
  beforeEach(() => {
    vi.mocked(queries.fetchSchemes).mockResolvedValue([{ id: 's1', code: 'HC115', name: '青年補助', category: '', active: true, version: 1, retention_days: 90, supplement_days: 14, max_revisions: 3, application_start: null, application_end: null, updated_at: null }])
    vi.mocked(queries.fetchChildren).mockResolvedValue([DOC])
    vi.mocked(queries.fetchSopFlowLinks).mockResolvedValue([])
    vi.mocked(queries.replaceSopFlowLinks).mockResolvedValue([])
  })

  it('只列出同平台已發布的 flow，選取後整批儲存對照', async () => {
    open()
    const select = await screen.findByLabelText('信用卡帳單・示範銀行 App')
    expect(screen.getByRole('option', { name: '下載帳單' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '尚未發布' })).toBeNull()
    fireEvent.change(select, { target: { value: 'published' } })
    await waitFor(() => expect(queries.replaceSopFlowLinks).toHaveBeenCalledWith('HC115', 'BILLING_STATEMENT', [
      { flow_id: 'published', platform_id: 'p1' },
    ]))
  })
})
