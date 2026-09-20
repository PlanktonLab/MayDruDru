import { fireEvent, render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { server } from '../mocks/server'
import { Providers } from '../test/utils'

describe('Feature Demo 頁', () => {
  it('在 /demo 使用獨立的一頁式版面，並提供四項功能', async () => {
    render(<Providers route="/demo"><App /></Providers>)

    expect(screen.getByRole('heading', { name: /讓申請/ })).toBeTruthy()
    expect(screen.queryByLabelText('主要導覽')).toBeNull()
    expect(screen.getByRole('heading', { name: '卡號，只留下需要的四碼。' })).toBeTruthy()
    expect(screen.getByText(/遮蔽信用卡號前 12 碼與到期日期/)).toBeTruthy()
    expect(screen.getByRole('img', { name: '無銀行 Logo 的示範信用卡' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'MayDru LINE Bot 實際對話與圖文選單畫面' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '不是說明書。是下一步。' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '讓審核，只看真正重要的地方。' })).toBeTruthy()
    expect(screen.getByText(/讓審核人員更快掃描與核對/)).toBeTruthy()
    expect(screen.getByRole('img', { name: '真實 Anthropic 收據的審核欄位裁切預覽' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '熟悉的聊天室，就是服務入口。' })).toBeTruthy()
    expect(await screen.findByText('離線展示內容')).toBeTruthy()
  })

  it('可開啟聊天客服並快速選擇 SOP 流程', async () => {
    render(<Providers route="/demo"><App /></Providers>)
    await screen.findByText('離線展示內容')

    fireEvent.click(screen.getByRole('button', { name: /測試聊天客服/ }))
    const dialog = screen.getByRole('dialog', { name: 'SOP 聊天客服體驗' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('完整教學來了')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '關閉聊天客服' }))
    expect(screen.queryByRole('dialog', { name: 'SOP 聊天客服體驗' })).toBeNull()
  })

  it('直接列出國泰平台所有已發布流程，不受文件類型對照限制', async () => {
    server.use(
      http.get('/api/sop/catalog/platforms', () => HttpResponse.json([
        { id: 'cathay', display_name: '國泰世華 CUBE App', brand: '國泰世華', channel: 'mobile_app' },
      ])),
      http.get('/api/sop/catalog/flows', ({ request }) => {
        expect(new URL(request.url).searchParams.get('platform_id')).toBe('cathay')
        return HttpResponse.json([
          { id: 'cathay-spending', name: '消費紀錄截圖', platform_id: 'cathay', goal_ids: [], status: 'published' },
        ])
      }),
      http.get('/api/sop/flows/cathay-spending/steps', () => HttpResponse.json({
        flow: { id: 'cathay-spending', name: '消費紀錄截圖' },
        steps: [{ index: 0, step_id: 'step-cathay', title: '查看消費紀錄', instruction: '點選消費明細。' }],
        messages: [{ kind: 'image', url: '/media/cathay.png', number: 1, flow_id: 'cathay-spending',
          step_id: 'step-cathay', title: '查看消費紀錄', instruction: '點選消費明細。', alt: '國泰流程' }],
      })),
    )

    render(<Providers route="/demo"><App /></Providers>)
    expect(await screen.findByText('資料庫即時內容')).toBeTruthy()
    expect((screen.getByLabelText('目前流程') as HTMLSelectElement).value).toBe('cathay-spending')
    expect(await screen.findByRole('button', { name: '放大查看：查看消費紀錄' })).toBeTruthy()
  })
})
