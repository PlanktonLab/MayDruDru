import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { Providers } from '../test/utils'

describe('Feature Demo 頁', () => {
  it('在 /demo 使用獨立的一頁式版面，並提供四項功能', async () => {
    render(<Providers route="/demo"><App /></Providers>)

    expect(screen.getByRole('heading', { name: /讓申請/ })).toBeTruthy()
    expect(screen.queryByLabelText('主要導覽')).toBeNull()
    expect(screen.getByRole('heading', { name: '個資，留在你的手機。' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '不是說明書。是下一步。' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '重點，自己浮現。' })).toBeTruthy()
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
})
