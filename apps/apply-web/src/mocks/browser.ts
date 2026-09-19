/** 瀏覽器端的 MSW worker：`VITE_USE_MOCKS=1 npm run dev:apply` 時啟動。 */

import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** `main.tsx` 在掛載 React 之前 await 它；沒開 mocks 時是 no-op。 */
export async function startMocks(): Promise<void> {
  await worker.start({
    // 只攔我們自己的 API；字型、語言資料這類外部請求照常走網路。
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
