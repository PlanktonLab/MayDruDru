import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Vite 用 `?url` 把 pdf.js 的 worker 打包成獨立資產；不設定的話 pdf.js 會退回主執行緒，
// 大檔轉頁時整個畫面會卡住（`@maydru/ocr` 的 `pdf.ts` 有完整說明）。
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { setPdfWorkerSrc } from '@maydru/ocr'
import { ToastProvider } from '@maydru/ui'
import App from './App'
import './index.css'

setPdfWorkerSrc(pdfWorkerUrl)

// 市民端不登入，查詢一律帶案件編號；失敗時不自動重試太多次，避免在弱網路下卡住。
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
