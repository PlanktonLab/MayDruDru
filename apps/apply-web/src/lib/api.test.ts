/** 錯誤訊息與案件 token（SPEC §15.5：說「怎麼修」，不是把代碼丟出來）。 */

import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { ApiError, CODE_MESSAGE, caseToken, getJson, postJson } from './api'
import { server } from '../mocks/server'
import { renderNote, REVIEW_NOTE_FALLBACK } from './reviewNotes'

async function failWith(body: Record<string, unknown>, status: number): Promise<ApiError> {
  server.use(http.get('/api/probe', () => HttpResponse.json(body, { status })))
  try {
    await getJson('/api/probe')
  } catch (cause) {
    return cause as ApiError
  }
  throw new Error('這個請求應該要失敗')
}

describe('錯誤訊息', () => {
  it('扁平的 {code} 會翻成一句「怎麼修」', async () => {
    const error = await failWith({ code: 'MIME_NOT_ACCEPTED' }, 400)
    expect(error.code).toBe('MIME_NOT_ACCEPTED')
    expect(error.message).toBe(CODE_MESSAGE.MIME_NOT_ACCEPTED)
  })

  it('限流被包在 detail 裡也認得出來', async () => {
    const error = await failWith({ detail: { code: 'RATE_LIMITED', retry_after: 30 } }, 429)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.message).toBe(CODE_MESSAGE.RATE_LIMITED)
  })

  it('沒收錄的代碼退回 422 的欄位訊息，不顯示代碼本身', async () => {
    const error = await failWith({ detail: [{ loc: ['body', 'phone'], msg: '手機格式不正確' }] }, 422)
    expect(error.message).toBe('手機格式不正確')
  })

  it('413 就算沒有代碼也說得出怎麼修', async () => {
    const error = await failWith({}, 413)
    expect(error.message).toContain('解析度低一點')
  })

  it('500 不把 stack 丟給市民', async () => {
    const error = await failWith({}, 500)
    expect(error.message).toContain('稍後再試')
  })

  it('沒有 token 就要求 auth 時直接擋下來，不發請求', async () => {
    caseToken.clear()
    await expect(getJson('/api/apply/applications/HC-2026-900002', true)).rejects.toMatchObject({
      code: 'NO_TOKEN',
    })
  })

  it('401 會清掉過期的案件 token', async () => {
    caseToken.set('mock-case-token:HC-2026-900002')
    await expect(getJson('/api/apply/applications/HC-2026-900003', true)).rejects.toBeInstanceOf(ApiError)
    expect(caseToken.get()).toBeNull()
  })
})

describe('補件的回應', () => {
  it('伺服器跑完 T4 + T5，回來時已經是 UNDER_REVIEW', async () => {
    const verified = await postJson<{ token: string }>('/api/apply/verify', {
      case_no: 'HC-2026-900003',
      last4: '0003',
    })
    caseToken.set(verified.token)
    const form = new FormData()
    form.append('documents', JSON.stringify([{ document_type_code: 'BILLING_STATEMENT' }]))
    const result = await fetch('/api/apply/applications/HC-2026-900003/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${verified.token}` },
      body: form,
    }).then((response) => response.json())
    expect(result.status).toBe('UNDER_REVIEW')
    expect(result.case_no).toBe('HC-2026-900003')
  })
})

describe('note 渲染', () => {
  it('伺服器的文案 key 換成句子', () => {
    expect(renderNote('review.note.missing_documents')).toBe(
      REVIEW_NOTE_FALLBACK['review.note.missing_documents'],
    )
  })

  it('TS 版規則引擎的句子原樣顯示', () => {
    expect(renderNote('還缺 1 份文件：切結書。')).toBe('還缺 1 份文件：切結書。')
  })
})
