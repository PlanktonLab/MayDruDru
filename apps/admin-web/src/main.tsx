import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/auth'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } } })

// 淺色為主：只有使用者明確切換過才用深色。
if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark')

/** `VITE_USE_MOCKS=1` 時先把 MSW 掛起來，案件審核區就能離線跑（見 README）。 */
async function boot() {
  if (import.meta.env.VITE_USE_MOCKS === '1') {
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
    // mock 的 `/api/auth/me` 不驗 token，但 `lib/api.ts` 沒有 token 就不會去問。
    localStorage.setItem('sop_token', 'mock-token')
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
