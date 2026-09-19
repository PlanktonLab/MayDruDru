/** 瀏覽器端的 MSW worker：`VITE_USE_MOCKS=1 npm run dev:admin` 時啟動。 */

import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** `main.tsx` 在掛載 React 之前 await 它；沒開 mocks 時是 no-op。 */
export async function startMocks(): Promise<void> {
  await worker.start({
    // 只攔有 handler 的路徑；SOP 區的端點照常打真後端。
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
