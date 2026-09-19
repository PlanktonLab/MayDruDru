/** `@maydru/api-client` — 前後端契約的唯一入口。
 *
 * P0 佔位：`src/schema.d.ts` 由 `npm run generate -w @maydru/api-client` 產生，
 * 尚未進 git（SPEC §16 P6 才會納入 CI 同步檢查）。
 */
export { ApiError, apiFetch, configure } from './client'
export type { ApiClientOptions } from './client'
