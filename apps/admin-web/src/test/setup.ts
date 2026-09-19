/** vitest 的全域設定：MSW、jsdom 缺的幾個瀏覽器 API。 */

import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from '../mocks/server'
import { createHandlers } from '../mocks/handlers'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  // 換一組全新的 handlers：示範案件是可變的（覆寫、轉移會改它），
  // 沿用同一份會讓測試依賴彼此的執行順序。
  server.resetHandlers(...createHandlers())
  localStorage.clear()
})
afterAll(() => server.close())

// jsdom 沒有這幾個；缺了會在元件 mount 時就炸掉，跟被測的行為無關。
window.scrollTo = vi.fn()
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = vi.fn()
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = vi.fn()

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
