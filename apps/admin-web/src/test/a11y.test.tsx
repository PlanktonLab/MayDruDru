import axe from 'axe-core'
import { expect, it } from 'vitest'
import { HttpResponse, http } from 'msw'
import LoginPage from '../pages/LoginPage'
import { renderAt } from './utils'
import { server } from '../mocks/server'

it('admin-web 登入頁沒有 serious/critical axe 問題', async () => {
  server.use(http.get('/api/auth/bootstrap-status', () => HttpResponse.json({ needs_bootstrap: false })))
  const { container } = renderAt(<LoginPage />, '/login', '/login', false)
  const result = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } } })
  expect(result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
})
