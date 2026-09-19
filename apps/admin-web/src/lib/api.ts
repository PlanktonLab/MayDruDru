/**
 * Thin fetch wrapper for the admin API. Adds the JWT, unwraps errors into
 * `ApiError` (message is human readable, zh-TW from the backend).
 */

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : (detail as { message?: string })?.message ?? `HTTP ${status}`)
    this.status = status
    this.detail = detail
  }
}

const TOKEN_KEY = 'sop_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

function detailMessage(body: unknown): unknown {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (Array.isArray(d)) return d.map((e: { msg?: string; loc?: unknown[] }) => `${(e.loc ?? []).slice(-1)[0]}: ${e.msg}`).join('; ')
    if (d && typeof d === 'object' && 'errors' in d) return (d as { errors: string[] }).errors.join('；')
    return d
  }
  return body
}

/**
 * Authenticated fetch returning the raw Response — for binary / text bodies
 * (protected images, replica HTML). Adds the JWT and handles an expired
 * session exactly like `api()`.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { ...init, headers })
  // Only log out if the token that failed is still the current one — a slow
  // request sent with an old token must not wipe a fresh login.
  if (res.status === 401 && token && token === getToken() && !path.startsWith('/api/auth/login')) {
    setToken(null)
    window.dispatchEvent(new Event('sop:logout'))
  }
  return res
}

/** Throw `ApiError` with the backend's human-readable message for a failed Response. */
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res
  const text = await res.text()
  const parsed = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null
  throw new ApiError(res.status, detailMessage(parsed))
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  let body: BodyInit | undefined = init.body as BodyInit | undefined
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  } else if (init.form) body = init.form
  const res = await ensureOk(await apiFetch(path, { ...init, headers, body }))
  const text = await res.text()
  return (text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null) as T
}

export const get = <T,>(p: string) => api<T>(p)
export const post = <T,>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json })
export const put = <T,>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json })
export const patch = <T,>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json })
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' })
export const upload = <T,>(p: string, file: File, extra: Record<string, string> = {}, method = 'POST') => {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return api<T>(p, { method, form })
}
