import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendHelpChat } from './helpChat'

afterEach(() => vi.unstubAllGlobals())
describe('public document assistant', () => {
  it('sends only the question and scheme to the anonymous endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '已核准的答案' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await sendHelpChat('如何補件', 'demo')).toEqual({ role: 'assistant', text: '已核准的答案' })
    expect(fetch.mock.calls[0][0]).toBe('/api/apply/help-chat')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ text: '如何補件', scheme_code: 'demo' })
  })
  it('shows the server quota message instead of claiming an answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { message: '詢問次數已達上限' } }), { status: 429 })))
    await expect(sendHelpChat('問題')).rejects.toThrow('詢問次數已達上限')
  })
})
