/**
 * 罐頭訊息編輯器。網路在 `queries.ts` 這一層被 mock 掉，測試永遠不會碰到真的後端。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import type { ContentPreview, ContentView, ContentsList } from '../../lib/types'
import { ToastProvider } from '../../components/ui'
import ContentsPage from './ContentsPage'
import * as queries from './queries'

vi.mock('./queries', () => ({
  fetchContents: vi.fn(),
  fetchContentPreview: vi.fn(),
  saveContentDraft: vi.fn(),
  publishContent: vi.fn(),
  resetContent: vi.fn(),
}))

const can = vi.fn(() => true)
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, loading: false, can, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

const CONTENT: ContentView = {
  key: 'case.progress',
  category: 'case',
  title: '案件進度說明',
  description: '民眾查詢案件時，進度卡下方的那一段字。',
  content: '目前共有 {{count}} 件在處理中。',
  draft: null,
  default: '目前共有 {{count}} 件正在處理。',
  content_type: 'text',
  variables: ['applicant', 'count'],
  sort_order: 0,
  version: 3,
  published_at: null,
  published_by: null,
  customised: false,
  has_draft: false,
  scheme_id: null,
  missing_variables: [],
}

const LIST: ContentsList = {
  items: [CONTENT, { ...CONTENT, key: 'home.welcome', title: '歡迎訊息', category: 'home', content: '歡迎加入', variables: [] }],
  categories: [
    { id: 'case', label: '案件進度', icon: '📋', description: '查詢案件、驗證、進度卡片上的文字' },
    { id: 'home', label: '首頁／歡迎', icon: '📌', description: '加入好友時看到的內容' },
  ],
  stats: { total: 2, registry: 2, customised: 0, drafts: 0 },
}

const PREVIEW: ContentPreview = {
  key: 'case.progress',
  kind: 'text',
  rendered: '目前共有 3 件在處理中。',
  // applicant 有範例值，但文字裡沒用到它——這正是「缺變數」要警告的情況。
  sample_variables: { applicant: '王小明', count: '3' },
  missing_variables: ['applicant'],
  unknown_variables: [],
  quick_replies: ['查詢案件'],
  where: '案件進度卡',
  surfaces: [{ id: 'case_card', messages: [{ type: 'text', text: '這是案件進度卡' }] }],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ContentsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const editorBox = async () => (await screen.findByLabelText('訊息內容')) as HTMLTextAreaElement

beforeEach(() => {
  can.mockReturnValue(true)
  vi.mocked(queries.fetchContents).mockResolvedValue(LIST)
  vi.mocked(queries.fetchContentPreview).mockResolvedValue(PREVIEW)
  vi.mocked(queries.saveContentDraft).mockResolvedValue(CONTENT)
  vi.mocked(queries.publishContent).mockResolvedValue(CONTENT)
  vi.mocked(queries.resetContent).mockResolvedValue(CONTENT)
})
afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('罐頭訊息編輯器', () => {
  it('編輯後按發布，帶著 key、內容與 expected_version 打發布端點', async () => {
    const user = userEvent.setup()
    renderPage()
    const box = await editorBox()
    await user.clear(box)
    // 不在這裡打大括號：userEvent 會把 `{` 當成按鍵描述子的開頭。
    await user.type(box, '目前案件都在排隊中。')

    await user.click(screen.getByRole('button', { name: /發布/ }))

    await waitFor(() =>
      expect(queries.publishContent).toHaveBeenCalledWith('case.progress', {
        content: '目前案件都在排隊中。',
        expected_version: 3,
      }),
    )
    expect(await screen.findByText(/已發布/)).toBeTruthy()
  })

  it('儲存草稿走的是草稿端點，不會順手發布出去', async () => {
    const user = userEvent.setup()
    renderPage()
    const box = await editorBox()
    await user.clear(box)
    await user.type(box, '改一半的句子')

    await user.click(screen.getByRole('button', { name: /儲存草稿/ }))

    await waitFor(() =>
      expect(queries.saveContentDraft).toHaveBeenCalledWith('case.progress', { draft: '改一半的句子', expected_version: 3 }),
    )
    expect(queries.publishContent).not.toHaveBeenCalled()
    expect(await screen.findByText(/已儲存草稿/)).toBeTruthy()
  })

  it('發布撞到 409 時要說「請重新載入」，而不是一句失敗', async () => {
    vi.mocked(queries.publishContent).mockRejectedValue(new ApiError(409, { message: '版本不符' }))
    const user = userEvent.setup()
    renderPage()
    await editorBox()

    await user.click(screen.getByRole('button', { name: /發布/ }))

    expect(await screen.findByText(/請重新載入/)).toBeTruthy()
    expect(screen.queryByText('版本不符')).toBeNull()
  })

  it('預覽會把 {{count}} 換成範例值', async () => {
    renderPage()
    expect(await screen.findByText('目前共有 3 件在處理中。')).toBeTruthy()
  })

  it('宣告了卻沒用到的變數要跳警告', async () => {
    renderPage()
    const warning = await screen.findByText(/少了 \{\{applicant\}\}/)
    expect(warning.textContent).toContain('缺資訊')
  })

  it('點變數藥丸會把 {{name}} 插進內容裡', async () => {
    const user = userEvent.setup()
    renderPage()
    const box = await editorBox()

    await user.click(await screen.findByRole('button', { name: '{{applicant}}' }))

    expect(box.value).toContain('{{applicant}}')
  })

  it('沒有 admin 能力的人看到的是唯讀編輯器，沒有發布按鈕', async () => {
    can.mockReturnValue(false)
    renderPage()
    const box = await editorBox()

    expect(box.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: /發布/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /儲存草稿/ })).toBeNull()
    expect(screen.getByText(/只有管理員能儲存草稿或發布/)).toBeTruthy()
  })
})
