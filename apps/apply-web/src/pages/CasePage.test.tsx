/** `/status/:case_no`：時間軸、補件面板、撤回（SPEC §8.1）。 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fakeCanvas, ocrModuleMock, renderAt } from '../test/utils'

vi.mock('@maydru/ocr', () => ocrModuleMock())
vi.mock('@maydru/mask-editor', () => ({
  MaskEditor: ({ onConfirm, source }: { onConfirm: (c: HTMLCanvasElement) => void; source: HTMLCanvasElement }) => (
    <button type="button" onClick={() => onConfirm(source ?? fakeCanvas())}>
      確認遮罩
    </button>
  ),
}))

const { default: CasePage } = await import('./CasePage')
const { caseToken } = await import('../lib/api')

function open(caseNo: string) {
  caseToken.set(`mock-case-token:${caseNo}`)
  return renderAt(<CasePage />, '/status/:case_no', `/status/${caseNo}`)
}

describe('CasePage', () => {
  beforeEach(() => caseToken.clear())

  it('沒有 token 時就地顯示查詢表單並帶入案號', async () => {
    renderAt(<CasePage />, '/status/:case_no', '/status/HC-2026-900002')
    expect((await screen.findByLabelText(/案件編號/)) as HTMLInputElement).toHaveProperty(
      'value',
      'HC-2026-900002',
    )
  })

  it('審核中的案件顯示市民用語與下一步，不顯示狀態代號', async () => {
    open('HC-2026-900002')
    expect(await screen.findByRole('heading', { name: /審核中/ })).toBeTruthy()
    expect(screen.getAllByText(/不用做任何事/).length).toBeGreaterThan(0)
    expect(screen.queryByText('UNDER_REVIEW')).toBeNull()
  })

  it('事件時間軸最新的在最上面', async () => {
    open('HC-2026-900003')
    await screen.findByText('案件歷程')
    const timeline = screen.getByText('案件歷程').closest('section')!
    const items = Array.from(timeline.querySelectorAll('li'))
    expect(items[0].textContent).toContain('需要補件')
  })

  it('NEEDS_REVISION 時只顯示 supplement_items 列出的文件類型', async () => {
    open('HC-2026-900003')
    await screen.findByRole('heading', { name: /要補的文件/ })
    expect(screen.getByLabelText('選擇信用卡帳單扣款紀錄的檔案')).toBeTruthy()
    // 這件案子也上傳過身分證，但它不在補件清單裡，所以不該出現上傳欄位。
    expect(screen.queryByLabelText('選擇身分證正面的檔案')).toBeNull()
  })

  it('補件面板附上退件原因的「哪裡不對／怎麼修」', async () => {
    open('HC-2026-900003')
    expect(await screen.findByText('出帳帳單上看不到換算後的臺幣金額')).toBeTruthy()
  })

  it('補件文件沒傳齊時「送出補件」是停用的', async () => {
    open('HC-2026-900003')
    const button = await screen.findByRole('button', { name: '送出補件' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('審核中的案件沒有補件面板', async () => {
    open('HC-2026-900002')
    await screen.findByRole('heading', { name: /審核中/ })
    expect(screen.queryByRole('heading', { name: /要補的文件/ })).toBeNull()
  })

  it('撤回要先確認，按「先不要」不會送出', async () => {
    const { container } = open('HC-2026-900002')
    fireEvent.click(await screen.findByRole('button', { name: '撤回這件申請' }))
    const dialog = container.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(screen.getByText('確定要撤回嗎？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '先不要' }))
    await waitFor(() => expect(dialog.open).toBe(false))
    expect(screen.getByRole('heading', { name: /審核中/ })).toBeTruthy()
  })

  it('確認撤回之後狀態變成已撤回', async () => {
    open('HC-2026-900002')
    fireEvent.click(await screen.findByRole('button', { name: '撤回這件申請' }))
    fireEvent.click(await screen.findByRole('button', { name: '確定撤回' }))
    expect((await screen.findByRole('status')).textContent).toContain('已撤回這件申請')
  })

  it('終態案件不提供撤回', async () => {
    open('HC-2026-900005')
    await screen.findByRole('heading', { name: /已撥款完成/ })
    expect(screen.queryByRole('button', { name: '撤回這件申請' })).toBeNull()
  })

  it('說明文件會被刪除、也不會送 AI（SPEC §11）', async () => {
    open('HC-2026-900002')
    expect(await screen.findByText(/不會送給任何 AI 服務/)).toBeTruthy()
  })
})
