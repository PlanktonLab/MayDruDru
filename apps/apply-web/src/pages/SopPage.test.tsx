import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import SopPage from './SopPage'
import { renderAt } from '../test/utils'

describe('SopPage', () => {
  it('由網址上的文件類型列出已發布教學', async () => {
    renderAt(<SopPage />, '/sop', '/sop?document_type=BILLING_STATEMENT')
    expect(await screen.findByRole('heading', { name: '怎麼取得「信用卡帳單扣款紀錄」' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /下載信用卡帳單/ })).toBeTruthy()
  })

  it('逐步顯示 step card，並可前後切換與放大', async () => {
    renderAt(<SopPage />, '/sop/:flow', '/sop/flow-bill?document_type=BILLING_STATEMENT')
    expect(await screen.findByText('打開帳務頁')).toBeTruthy()
    expect(screen.getByText('步驟 1／2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    expect(await screen.findByText('下載帳單')).toBeTruthy()
    expect(screen.getByText('步驟 2／2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(screen.getByRole('dialog', { name: '放大步驟圖片' })).toBeTruthy()
  })

  it('我卡住了會先顯示 contents 的隱私提醒，再接受截圖定位', async () => {
    renderAt(<SopPage />, '/sop/:flow', '/sop/flow-bill?document_type=BILLING_STATEMENT')
    fireEvent.click(await screen.findByRole('button', { name: '我卡住了' }))
    expect(await screen.findByText(/圖片不會留存/)).toBeTruthy()
    const input = screen.getByLabelText('選擇要定位的截圖')
    fireEvent.change(input, { target: { files: [new File(['png'], 'screen.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: '略過遮罩並定位' }))
    expect(await screen.findByText('看起來你已經到下載帳單這一步。')).toBeTruthy()
  })
})
