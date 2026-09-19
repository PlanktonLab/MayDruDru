import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { Providers } from '../test/utils'
import { render } from '@testing-library/react'
import { DocumentSopHelp } from './DocumentSopHelp'

describe('DocumentSopHelp', () => {
  it('只有一條流程時直接開始逐步教學，完成後回到上傳', async () => {
    const onReady = vi.fn()
    render(
      <Providers>
        <DocumentSopHelp
          documentTypeCode="BILLING_STATEMENT"
          documentLabel="信用卡帳單扣款紀錄"
          schemeCode="HCAI115"
          onReady={onReady}
        />
      </Providers>,
    )

    fireEvent.click(screen.getByRole('button', { name: '還沒有這份文件？帶我取得' }))
    expect(await screen.findByText('打開帳務頁')).toBeTruthy()
    expect(screen.getByText('步驟 1／2')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.maxWidth).toBe('1280px')
    expect(dialog.style.maxHeight).toBe('94vh')
    expect(screen.getByRole('link', { name: '以原始尺寸開啟教學圖片' }).getAttribute('href')).toBe('/mock/step-1.png')

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('下載帳單')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '我找到了，回來上傳' }))
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('沒有已發布流程時仍讓使用者回到上傳', async () => {
    render(
      <Providers>
        <DocumentSopHelp
          documentTypeCode="AFFIDAVIT"
          documentLabel="切結書"
          schemeCode="HCAI115"
          onReady={vi.fn()}
        />
      </Providers>,
    )
    fireEvent.click(screen.getByRole('button', { name: '還沒有這份文件？帶我取得' }))
    expect(await screen.findByText('這份文件還沒有逐步教學')).toBeTruthy()
    expect(screen.getByRole('button', { name: '回到上傳欄位' })).toBeTruthy()
  })
})
