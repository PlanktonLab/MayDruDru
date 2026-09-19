/** 瀏覽器端的 MSW worker：`VITE_USE_MOCKS=1 npm run dev:apply` 時啟動。 */

import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/** `main.tsx` 在掛載 React 之前 await 它；沒開 mocks 時是 no-op。
 *
 * 註冊失敗不讓它炸掉 boot：某些瀏覽器環境（無痕視窗、內嵌預覽、關掉 service worker
 * 的情境）註冊不了 worker，這時 `worker.start()` 會 reject。原本會讓整個 `boot()`
 * 停在 await 上，畫面留白且只有 console 看得到原因——開發時最難查的那種壞法。
 * 現在改成印一行警告後照常掛載 React，API 請求就直接打真的後端。
 */
export async function startMocks(): Promise<void> {
  try {
    await worker.start({
      // 只攔我們自己的 API；字型、語言資料這類外部請求照常走網路。
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
  } catch (cause) {
    console.warn('[mocks] Service Worker 註冊失敗，改用真實 API。', cause)
  }
}
