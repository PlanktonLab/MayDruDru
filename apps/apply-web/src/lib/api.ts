/** 市民端的 fetch 包裝。
 *
 * 匿名為原則（決策 D4）：只有查詢過案件編號 + 末四碼之後，才會拿到一顆**只限該案件**
 * 的短效 token。token 放記憶體，另外鏡一份到 `sessionStorage`——關掉分頁就沒了，
 * 不會像 localStorage 那樣留在別人也能開的裝置上。
 */

const TOKEN_KEY = 'maydru_case_token'

export class ApiError extends Error {
  status: number
  /** 後端的機器可讀代碼，例如 `LOCKED`、`SCHEME_CLOSED`。 */
  code: string | null
  body: unknown
  constructor(status: number, message: string, code: string | null, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** 網路斷線、伺服器 500 時也要說「怎麼辦」，不能只丟 stack（SPEC §15.5）。 */
export const NETWORK_ERROR_MESSAGE = '連線不穩，資料沒有送出去。請確認網路後再按一次。'

/**
 * 機器代碼可能在頂層（`{code}`），也可能被包在 `detail` 裡（限流就是）。
 */
function codeOf(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const code = (body as { code?: unknown }).code
    if (typeof code === 'string') return code
    const detail = (body as { detail?: unknown }).detail
    if (detail && typeof detail === 'object') {
      const nested = (detail as { code?: unknown }).code
      if (typeof nested === 'string') return nested
    }
  }
  return null
}

/**
 * 後端的機器代碼 → 一句「怎麼修」（SPEC §15.5）。
 *
 * 上傳被擋下來時整批送件會一起回滾，所以訊息要講清楚「修好再按一次就好」——
 * 草稿與已經處理過的照片都還在記憶體裡，不必從頭再來一遍。
 */
export const CODE_MESSAGE: Record<string, string> = {
  SCHEME_NOT_FOUND: '找不到這個補助方案，連結可能過期了。請回首頁重新選一個開放中的方案。',
  SCHEME_CLOSED: '這個方案的申請期間已經結束，無法再送件。',
  CASE_NOT_FOUND: '查不到這件案子。請對照送件後的截圖確認案件編號。',
  UNKNOWN_DOCUMENT_TYPE: '有一份文件不屬於這個方案。請回上一步重新選擇要上傳的文件。',
  MIME_NOT_ACCEPTED: '有一份檔案的格式不支援。請改用 JPG、PNG 或 PDF，然後再送出一次。',
  TOO_MANY_PAGES: '有一份 PDF 的頁數超過上限。請只保留需要的那幾頁，再上傳一次。',
  EMPTY_FILE: '有一份檔案是空的。請重新拍一次或重新選擇檔案，再送出一次。',
  FILE_TOO_LARGE: '有一份檔案太大。請改用解析度低一點的照片，或把 PDF 拆成單頁，再送出一次。',
  RATE_LIMITED: '操作太頻繁，請稍等一下再試一次。',
  NOT_IN_SUPPLEMENT: '這件案子目前不在補件階段，不需要再上傳文件。',
  UNEXPECTED_DOCUMENT_TYPE: '這份文件不在承辦要求補件的清單裡。請只上傳被標示的那幾份。',
  VERIFICATION_FAILED: '案件編號或末四碼不正確。請對照送件後的截圖再輸入一次。',
}

function messageOf(status: number, body: unknown): string {
  const code = codeOf(body)
  if (code && CODE_MESSAGE[code]) return CODE_MESSAGE[code]
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    const detail = record.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => (item && typeof item === 'object' ? String((item as { msg?: string }).msg ?? '') : ''))
        .filter(Boolean)
      if (parts.length) return parts.join('；')
    }
  }
  if (status === 413) return '檔案太大了。請改用解析度低一點的照片，或把 PDF 拆成單頁再上傳。'
  if (status >= 500) return '系統暫時無法處理。請稍後再試一次，或洽承辦單位。'
  return `發生錯誤（${status}）。請稍後再試一次。`
}

let memoryToken: string | null = null

export const caseToken = {
  get(): string | null {
    if (memoryToken) return memoryToken
    try {
      memoryToken = sessionStorage.getItem(TOKEN_KEY)
    } catch {
      memoryToken = null
    }
    return memoryToken
  },
  set(token: string): void {
    memoryToken = token
    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* 無痕模式沒有 sessionStorage；記憶體那份還在，這一輪操作仍然可用。 */
    }
  },
  clear(): void {
    memoryToken = null
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* 同上 */
    }
  },
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  form?: FormData
  /** 帶上案件 token；沒有 token 時直接丟 401，讓畫面導回查詢頁。 */
  auth?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, form, auth, headers, ...rest } = options
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string>) }
  let body: BodyInit | undefined
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form) {
    body = form
  }
  if (auth) {
    const token = caseToken.get()
    if (!token) throw new ApiError(401, '查詢憑證已過期，請重新輸入案件編號與末四碼。', 'NO_TOKEN', null)
    finalHeaders.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(path, { ...rest, headers: finalHeaders, body })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, 'NETWORK', null)
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!response.ok) {
    if (response.status === 401 && auth) caseToken.clear()
    throw new ApiError(response.status, messageOf(response.status, parsed), codeOf(parsed), parsed)
  }
  return parsed as T
}

export const getJson = <T,>(path: string, auth = false) => request<T>(path, { auth })
export const postJson = <T,>(path: string, json: unknown, auth = false) =>
  request<T>(path, { method: 'POST', json, auth })
export const postForm = <T,>(path: string, form: FormData, auth = false) =>
  request<T>(path, { method: 'POST', form, auth })
