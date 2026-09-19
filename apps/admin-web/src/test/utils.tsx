/** 測試共用的 render 包裝：react-query + router + 登入狀態。 */

import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../lib/auth'
import { ToastProvider } from '../components/ui'

export function makeClient(): QueryClient {
  // 測試不重試：失敗的請求要立刻變成畫面上的錯誤訊息，不是等三次退避。
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

/** mock 的 `/api/auth/me` 不驗 token，但沒有 token 的話 AuthProvider 根本不會去問。 */
export function signIn(token = 'mock-token'): void {
  localStorage.setItem('sop_token', token)
}

export function renderAt(element: ReactElement, path: string, route: string): RenderResult {
  signIn()
  return render(
    <QueryClientProvider client={makeClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <Routes>
              <Route path={path} element={element} />
              <Route path="*" element={<div>其他頁面</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}
