/** 最小 fetch 包裝：統一 base URL、JSON 編解碼與錯誤形狀。
 *
 * P0 尚未產生 `schema.d.ts`（見 `scripts/generate.mjs`），所以回傳型別由呼叫端以
 * 泛型指定；P6 產生型別後會改成由路徑推導（SPEC §16）。
 */

export interface ApiClientOptions {
  /** 預設空字串：走同源，由 Vite dev proxy 或容器內 nginx 轉給後端。 */
  baseUrl?: string
  /** admin-web 的 JWT；apply-web 匿名送件不帶。 */
  token?: string | null
}

/** 後端回傳非 2xx 時丟出，保留 status 與已解析的 body 供 UI 對應文案。 */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

let options: ApiClientOptions = { baseUrl: '', token: null }

export function configure(next: ApiClientOptions): void {
  options = { ...options, ...next }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)

  const res = await fetch(`${options.baseUrl ?? ''}${path}`, { ...init, headers })
  const text = await res.text()
  const body: unknown = text ? safeJson(text) : null
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
