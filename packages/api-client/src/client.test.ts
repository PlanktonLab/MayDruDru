import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, configure } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  configure({ baseUrl: '', token: null })
})

describe('apiFetch', () => {
  it('解析 JSON 並帶上 Authorization', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    configure({ baseUrl: '/api', token: 'jwt' })

    await expect(apiFetch<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/health')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt')
  })

  it('非 2xx 丟出帶 status 的 ApiError', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"nope"}', { status: 403 }))
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError)
  })
})
