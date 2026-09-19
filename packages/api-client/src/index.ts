/** `@maydru/api-client` — 前後端契約的唯一入口。
 *
 * `src/schema.d.ts` 由 OpenAPI 產生並由 CI 檢查同步（SPEC §16 P6）。
 */
export { ApiError, apiFetch, configure } from './client'
export type { ApiClientOptions } from './client'
export type { components, operations, paths, webhooks } from './schema'
