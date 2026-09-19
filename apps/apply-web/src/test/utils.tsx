/** 測試共用的 render 包裝：react-query + router，兩者是所有頁面的前提。 */

import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { LoadedImage, OcrResult } from '@maydru/ocr'

export function makeClient(): QueryClient {
  // 測試不重試：失敗的請求要立刻變成畫面上的錯誤訊息，不是等三次退避。
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

export function Providers({ children, route = '/' }: { children: ReactNode; route?: string }) {
  return (
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

export function renderAt(element: ReactElement, path: string, route: string): RenderResult {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div>其他頁面</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** jsdom 沒有 canvas，被測的流程也從不真的畫圖——一個帶尺寸的物件就夠了。 */
export function fakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement
}

export function ocrResult(lines: string[]): OcrResult {
  return {
    text: lines.join('\n'),
    confidence: 88,
    lines: lines.map((text, index) => ({
      text,
      confidence: 88,
      bbox: { x0: 0, y0: index * 30, x1: 400, y1: index * 30 + 24 },
      words: [],
    })),
  }
}

/** `@maydru/ocr` 的替身；DocField 的測試只關心流程有沒有走完，不關心真的辨識結果。 */
export function ocrModuleMock(overrides: Record<string, unknown> = {}) {
  return {
    loadImage: vi.fn(async (file: File): Promise<LoadedImage> => ({
      canvas: fakeCanvas(),
      width: 800,
      height: 600,
      originalFormat: /\.heic$/i.test(file.name) ? 'HEIC' : 'JPEG',
      probe: { longEdge: 800, sharpness: 0.5, brightness: 0.5 },
      qualityNote: null,
    })),
    pdfToPageCanvases: vi.fn(async (_file: Blob, _options?: { maxPages?: number }) => ({
      canvases: [fakeCanvas()],
      pageCount: 1,
      truncated: 0,
    })),
    recognize: vi.fn(async () => ocrResult(['臺幣 6,000', '扣款日 2026/08/01'])),
    toBlob: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
    disposeCanvas: vi.fn(),
    createOcrWorker: vi.fn(async () => ({ terminate: vi.fn() })),
    setPdfWorkerSrc: vi.fn(),
    EMPTY_OCR_RESULT: { text: '', confidence: 0, lines: [] },
    ...overrides,
  }
}
