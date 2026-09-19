/** `/apply/:scheme` 的六步流程：每一步的過關條件、前後移動、送出（SPEC §8.1）。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { fakeCanvas, ocrModuleMock, renderAt } from '../test/utils'

const ocr = ocrModuleMock()
vi.mock('@maydru/ocr', () => ocr)
vi.mock('@maydru/mask-editor', () => ({
  MaskEditor: ({ onConfirm, source }: { onConfirm: (c: HTMLCanvasElement) => void; source: HTMLCanvasElement }) => (
    <button type="button" onClick={() => onConfirm(source ?? fakeCanvas())}>
      確認遮罩
    </button>
  ),
}))

const { default: ApplyPage } = await import('./ApplyPage')

function open() {
  return renderAt(<ApplyPage />, '/apply/:scheme', '/apply/HCAI115')
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
const back = () => fireEvent.click(screen.getByRole('button', { name: /上一步/ }))

async function pickTool(name = 'Claude Pro') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/姓名/), { target: { value: '測試用小明' } })
  fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '0912345678' } })
  fireEvent.click(screen.getByRole('button', { name: /一般青年/ }))
}

function fillChannel() {
  fireEvent.click(screen.getByRole('button', { name: /電信繳費/ }))
  fireEvent.change(screen.getByLabelText(/購買（扣款）日期/), { target: { value: '2026-08-01' } })
  fireEvent.change(screen.getByLabelText(/實際扣款臺幣金額/), { target: { value: '6000' } })
}

describe('ApplyPage', () => {
  it('第一步沒選工具時按下一步會擋住並說怎麼修', async () => {
    open()
    await screen.findByRole('heading', { name: '你買的是哪一個 AI 工具？' })
    next()
    expect((await screen.findByRole('alert')).textContent).toContain('請選擇或輸入你購買的工具名稱')
  })

  it('不予補助的工具選了也過不去，而且看得到判定理由', async () => {
    open()
    await pickTool('DeepSeek')
    // 判定理由會出現兩次：工具卡片上一次，「不予補助範圍提醒」卡片上再一次。
    expect(screen.getAllByText(/中國公司，具中資背景/).length).toBeGreaterThan(0)
    next()
    expect((await screen.findByRole('alert')).textContent).toContain('不予補助')
  })

  it('搜尋會縮小工具清單', async () => {
    open()
    await screen.findByRole('button', { name: /Claude Pro/ })
    fireEvent.change(screen.getByLabelText(/搜尋工具名稱/), { target: { value: 'midjourney' } })
    expect(screen.getByRole('button', { name: /Midjourney/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Claude Pro/ })).toBeNull()
  })

  it('選了可補助的工具就能進第二步', async () => {
    open()
    await pickTool()
    next()
    expect(await screen.findByRole('heading', { name: '填寫申請人資料' })).toBeTruthy()
  })

  it('第二步手機格式不對會擋住', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/手機號碼/)
    fireEvent.change(screen.getByLabelText(/姓名/), { target: { value: '測試用小明' } })
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '0912' } })
    fireEvent.click(screen.getByRole('button', { name: /一般青年/ }))
    next()
    expect(screen.getByText(/請填寫 10 碼手機號碼/)).toBeTruthy()
  })

  it('上一步回得去，而且填過的資料還在', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/手機號碼/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '你怎麼付這筆錢？' })
    back()
    expect(((await screen.findByLabelText(/姓名/)) as HTMLInputElement).value).toBe('測試用小明')
  })

  it('第三步三個欄位沒填齊會擋住', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/手機號碼/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '你怎麼付這筆錢？' })
    next()
    expect(screen.getByText(/請選擇你實際付款的方式/)).toBeTruthy()
  })

  it('準備指引列出伺服器算出來的必備文件，每份都有 SOP 連結', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/手機號碼/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '你怎麼付這筆錢？' })
    fillChannel()
    next()
    expect(await screen.findByRole('heading', { name: '要準備哪些文件' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('link', { name: '教我怎麼取得' }).length).toBe(6))
    expect(screen.getByText('電信帳單')).toBeTruthy()
  })

  it('第五步缺件時不能進確認，補齊之後可以送出並拿到案件編號', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/手機號碼/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '你怎麼付這筆錢？' })
    fillChannel()
    next()
    await screen.findByRole('heading', { name: '要準備哪些文件' })
    await waitFor(() => expect(screen.getAllByRole('link', { name: '教我怎麼取得' }).length).toBe(6))
    next()
    await screen.findByRole('heading', { name: '上傳文件' })

    next()
    expect((await screen.findByRole('alert')).textContent).toContain('份必備文件沒有上傳')

    const inputs = screen
      .getAllByLabelText(/^選擇.*的檔案$/)
      .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    expect(inputs).toHaveLength(6)
    for (const input of inputs) {
      const card = input.closest('section')!
      fireEvent.change(input, { target: { files: [new File(['x'], 'doc.jpg', { type: 'image/jpeg' })] } })
      // 電信帳單是強制遮罩的：讀完檔會先出現遮罩編輯器，確認過才會繼續辨識。
      await waitFor(() => expect(card.textContent).toMatch(/換一張|確認遮罩/))
      const confirm = within(card).queryByRole('button', { name: '確認遮罩' })
      if (confirm) fireEvent.click(confirm)
      await waitFor(() => expect(card.textContent).toContain('換一張'))
    }

    next()
    await screen.findByRole('heading', { name: '確認並送出' })
    fireEvent.click(screen.getByRole('button', { name: '送出申請' }))
    expect(await screen.findByText('其他頁面', undefined, { timeout: 3000 })).toBeTruthy()
  })
})
