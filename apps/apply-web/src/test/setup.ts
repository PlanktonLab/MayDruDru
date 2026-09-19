/** vitest 的全域設定：MSW、jsdom 缺的幾個瀏覽器 API。 */

import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from '../mocks/server'
import { createHandlers } from '../mocks/handlers'

/**
 * jsdom 自己有一套 `FormData` / `Blob` / `File`，但 `fetch` 是 Node 內建的（undici）。
 * 兩套物件互不認得，multipart 的 body 會被當成字串送出去，content-type 變成
 * `text/plain`——送件與補件的測試就永遠測不到真正的上傳路徑。
 *
 * 把這三個換成 Node 自己的版本；`FormData` 沒有模組出口，從一個 `Response` 身上要回來。
 */
async function useNodeMultipartGlobals(): Promise<void> {
  const probe = await new Response('a=b', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData()
  globalThis.FormData = probe.constructor as typeof globalThis.FormData
  const { Blob, File } = await import('node:buffer')
  globalThis.Blob = Blob as unknown as typeof globalThis.Blob
  globalThis.File = File as unknown as typeof globalThis.File
}

beforeAll(async () => {
  await useNodeMultipartGlobals()
  server.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  cleanup()
  // 換一組全新的 handlers：示範案件是可變的（補件、撤回會改它），
  // 沿用同一份會讓測試依賴彼此的執行順序。
  server.resetHandlers(...createHandlers())
  sessionStorage.clear()
})
afterAll(() => server.close())

// jsdom 沒有這幾個；缺了會在元件 mount 時就炸掉，跟被測的行為無關。
if (!('scrollTo' in window)) Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })
else window.scrollTo = vi.fn()

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
}
