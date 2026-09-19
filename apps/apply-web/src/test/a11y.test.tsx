import axe from 'axe-core'
import { expect, it } from 'vitest'
import HelpPage from '../pages/HelpPage'
import { renderAt } from './utils'

it('apply-web 主要公開頁沒有 serious/critical axe 問題', async () => {
  const { container } = renderAt(<HelpPage />, '/help', '/help')
  const result = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } } })
  expect(result.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
})
