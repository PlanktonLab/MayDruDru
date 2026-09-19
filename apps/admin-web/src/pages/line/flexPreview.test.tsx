/** Flex renderer：走訪原始 LINE 訊息 JSON 的結果要看得到字。 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LineMessages } from './flexPreview'

afterEach(() => { document.body.innerHTML = '' })

const bubble = (title: string) => ({
  type: 'bubble',
  header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: title, size: 'sm', color: '#8C8C8C' }] },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'A1140001', size: 'xl', weight: 'bold', wrap: true },
      { type: 'separator' },
      { type: 'box', layout: 'baseline', contents: [{ type: 'text', text: '狀態' }, { type: 'text', text: '審核中', color: '#06C755' }] },
    ],
  },
  footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', action: { type: 'postback', label: '看進度', data: 'action=case_status' } }] },
})

describe('LineMessages', () => {
  it('把 bubble 的 header／body／footer 裡的文字節點都畫出來', () => {
    render(<LineMessages messages={[{ type: 'flex', altText: '案件進度', contents: bubble('案件進度') }]} />)
    expect(screen.getByText('案件進度')).toBeTruthy()
    expect(screen.getByText('A1140001')).toBeTruthy()
    expect(screen.getByText('狀態')).toBeTruthy()
    expect(screen.getByText('審核中')).toBeTruthy()
    expect(screen.getByText('看進度')).toBeTruthy()
  })

  it('text 訊息畫成泡泡，quickReply 畫成一排藥丸', () => {
    render(
      <LineMessages
        messages={[{
          type: 'text',
          text: '請輸入您的案件編號',
          quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '取消', data: 'action=cancel' } }] },
        }]}
      />,
    )
    expect(screen.getByText('請輸入您的案件編號')).toBeTruthy()
    expect(screen.getByText('取消')).toBeTruthy()
  })

  it('carousel 只畫第一張，其餘用「還有 N 張」交代', () => {
    render(<LineMessages messages={[{ type: 'flex', altText: '我的案件', contents: { type: 'carousel', contents: [bubble('第一件'), bubble('第二件'), bubble('第三件')] } }]} />)
    expect(screen.getByText('第一件')).toBeTruthy()
    expect(screen.queryByText('第二件')).toBeNull()
    expect(screen.getByText(/還有\s*2\s*張/)).toBeTruthy()
  })
})
