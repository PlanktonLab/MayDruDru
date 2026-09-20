/** `/apply/:scheme` 的六步流程：每一步的過關條件、前後移動、送出（SPEC §8.1）。 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { fakeCanvas, ocrModuleMock, renderAt } from '../test/utils'
import { compareToolName } from '../apply/toolGroups'

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

const next = () =>
  // 準備指引那一步的主要動作叫「我準備好了，開始上傳」，其餘都是「下一步」。
  fireEvent.click(screen.getByRole('button', { name: /下一步|開始上傳/ }))
const back = () => fireEvent.click(screen.getByRole('button', { name: /上一步/ }))

/** 第一步的工具是下拉選單：先打開，再點選項（選項是 role="option"，不是 button）。
 *  選項的可及名稱會連分類一起帶進來（「Claude通用型 AI」），所以用開頭比對。 */
async function pickTool(name = 'Claude') {
  fireEvent.click(await screen.findByRole('combobox', { name: /AI 工具名稱/ }))
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}`) }))
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/姓名/), { target: { value: '測試用小明' } })
  fireEvent.change(screen.getByLabelText(/聯絡電話/), { target: { value: '0912345678' } })
  fireEvent.change(screen.getByLabelText(/身分證字號/), { target: { value: 'A123456789' } })
  fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'test@example.com' } })
  fireEvent.click(screen.getByRole('radio', { name: /一般青年/ }))
}

function fillChannel() {
  fireEvent.click(screen.getByRole('radio', { name: /電信繳費/ }))
  fireEvent.change(screen.getByLabelText(/購買日期/), { target: { value: '2026-08-01' } })
  fireEvent.change(screen.getByLabelText(/原始費用/), { target: { value: '20' } })
  fireEvent.change(screen.getByLabelText(/換算台幣費用/), { target: { value: '6000' } })
}

describe('ApplyPage', () => {
  it('第一步沒選工具時按下一步會擋住並說怎麼修', async () => {
    open()
    await screen.findByRole('heading', { name: '確認申請工具' })
    next()
    expect((await screen.findByRole('alert')).textContent).toContain('請選擇或輸入你購買的工具名稱')
  })

  it('自行填寫不予補助的工具，當場說不符資格且過不去', async () => {
    open()
    // 不予補助的工具不列在選單裡，但自行填寫時仍要比對得到。
    await pickTool('其他（自行填寫）')
    fireEvent.change(screen.getByLabelText(/其他 AI 工具名稱/), { target: { value: 'DeepSeek' } })
    fireEvent.click(screen.getByRole('button', { name: '檢查補助資格' }))
    expect(await screen.findByText('這個工具不符合補助資格')).toBeTruthy()
    expect(screen.getByText(/中國公司，具中資背景/)).toBeTruthy()
    next()
    // 畫面上有兩個 alert：欄位錯誤，以及判定面板的 aria-live 區。這裡要的是前者。
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((node) => node.textContent ?? '').join('|')).toContain('不予補助')
  })

  it('自行填寫沒收錄的工具不擋送出，改標為人工認定', async () => {
    open()
    await pickTool('其他（自行填寫）')
    fireEvent.change(screen.getByLabelText(/其他 AI 工具名稱/), { target: { value: '某個沒聽過的工具' } })
    fireEvent.click(screen.getByRole('button', { name: '檢查補助資格' }))
    expect(await screen.findByText('這個工具我們還沒有收錄')).toBeTruthy()
    next()
    expect(await screen.findByRole('heading', { name: '填寫申請人資料' })).toBeTruthy()
  })

  it('選單依公告分類分組，組內依英文字母排序，不列不予補助的工具', async () => {
    open()
    fireEvent.click(await screen.findByRole('combobox', { name: /AI 工具名稱/ }))
    const options = screen.getAllByRole('option')

    // 最後一項固定是「其他（自行填寫）」。
    expect(options.at(-1)?.textContent).toContain('其他（自行填寫）')

    // 分組依公告順序出現，且同一組的選項連在一起。
    const groups = options.slice(0, -1).map((option) => option.querySelector('span:last-child')?.textContent ?? '')
    expect([...new Set(groups)]).toEqual([
      '通用型 AI',
      '影像／設計類 AI',
      '辦公／生產力類 AI',
      '學習／語言類 AI',
      '其他',
    ])

    // 每一組內部依英文字母排序（「其他 Adobe…」跟著 Adobe 排）。
    for (const label of new Set(groups)) {
      const names = options
        .filter((option) => option.querySelector('span:last-child')?.textContent === label)
        .map((option) => option.querySelector('span')?.textContent ?? '')
      expect([...names].sort((a, b) => compareToolName(a, b))).toEqual(names)
    }

    // 不予補助的工具不出現在選單上（自行填寫時才比對得到）。
    const all = options.map((option) => option.textContent ?? '').join('|')
    expect(all).not.toContain('DeepSeek')
    expect(all).not.toContain('Poe.com')
  })

  it('選「其他」可以自己填工具名稱', async () => {
    open()
    await pickTool('其他（自行填寫）')
    fireEvent.change(screen.getByLabelText(/其他 AI 工具名稱/), { target: { value: 'Perplexity Pro' } })
    fireEvent.click(screen.getByRole('button', { name: '檢查補助資格' }))
    await waitFor(() => expect((screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(false))
    next()
    expect(await screen.findByRole('heading', { name: '填寫申請人資料' })).toBeTruthy()
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
    await screen.findByLabelText(/聯絡電話/)
    fireEvent.change(screen.getByLabelText(/姓名/), { target: { value: '測試用小明' } })
    fireEvent.change(screen.getByLabelText(/聯絡電話/), { target: { value: '0912' } })
    fireEvent.click(screen.getByRole('radio', { name: /一般青年/ }))
    next()
    expect(screen.getByText(/請填寫 10 碼聯絡電話/)).toBeTruthy()
  })

  it('上一步回得去，而且填過的資料還在', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/聯絡電話/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '購買明細' })
    back()
    expect(((await screen.findByLabelText(/姓名/)) as HTMLInputElement).value).toBe('測試用小明')
  })

  it('第三步三個欄位沒填齊會擋住', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/聯絡電話/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '購買明細' })
    next()
    expect(screen.getByText(/請選擇你實際付款的方式/)).toBeTruthy()
  })

  it('準備申請文件只講取得方式，逐份清單留給上傳步驟', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/聯絡電話/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '購買明細' })
    fillChannel()
    next()
    expect(await screen.findByRole('heading', { name: '準備申請文件' })).toBeTruthy()
    await screen.findByText('電信繳費需附資訊')
    // 文件清單與 SOP 連結都移到下一步，這裡不重複列一次。
    expect(screen.queryByRole('link', { name: '教我怎麼取得' })).toBeNull()
  })

  it('準備指引的教學依繳費方式分流，不是同一套說明', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/聯絡電話/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '購買明細' })
    fillChannel() // 電信繳費
    next()
    await screen.findByRole('heading', { name: '準備申請文件' })
    // 電信的教學講電信帳單，不會出現信用卡那一套。
    expect(await screen.findByText('電信繳費需附資訊')).toBeTruthy()
    // 講的是電信帳單，不是信用卡那一套。
    expect(screen.getByText(/電信帳單上該筆代收的明細/)).toBeTruthy()
    expect(screen.queryByText('信用卡繳費需附資訊')).toBeNull()
  })

  it('第五步缺件時不能進確認，補齊之後可以送出並拿到案件編號', async () => {
    open()
    await pickTool()
    next()
    await screen.findByLabelText(/聯絡電話/)
    fillIdentity()
    next()
    await screen.findByRole('heading', { name: '購買明細' })
    fillChannel()
    next()
    await screen.findByRole('heading', { name: '準備申請文件' })
    // 等教學出現＝必備文件已經算好了，接著才進得了上傳步驟。
    await screen.findByText('電信繳費需附資訊')
    next()
    await screen.findByRole('heading', { name: '上傳文件' })

    // 這一段還沒填，「下一步」按不下去——按不下去比按了才被擋更誠實。
    expect((screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true)

    // 上傳步驟分成三段，一次只看得到一段的欄位；每段填完再走到下一段。
    let filled = 0
    for (;;) {
      const inputs = screen
        .getAllByLabelText(/^選擇.*的檔案$/)
        .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
      for (const input of inputs) {
        const card = input.closest('section')!
        fireEvent.change(input, { target: { files: [new File(['x'], 'doc.jpg', { type: 'image/jpeg' })] } })
        // 電信帳單是強制遮罩的：讀完檔會先出現遮罩編輯器，確認過才會繼續辨識。
        await waitFor(() => expect(card.textContent).toMatch(/換一張|確認遮罩/))
        const confirm = within(card).queryByRole('button', { name: '確認遮罩' })
        if (confirm) fireEvent.click(confirm)
        await waitFor(() => expect(card.textContent).toContain('換一張'))
        filled += 1
      }
      // 還有下一段時按鈕會帶著段落名（「下一步：購買與付款憑證」）；
      // 最後一段只剩「下一步」，代表整個上傳步驟填完了。
      const toNext = screen.getByRole('button', { name: /下一步/ })
      if (!/下一步：/.test(toNext.textContent ?? '')) break
      fireEvent.click(toNext)
    }
    // 基本文件至少 6 份；多期方案會再依期數展開收據與付款憑證。
    expect(filled).toBeGreaterThanOrEqual(6)

    next()
    await screen.findByRole('heading', { name: '確認並送出' })
    fireEvent.click(screen.getByRole('button', { name: '送出申請' }))
    expect(await screen.findByText('其他頁面', undefined, { timeout: 3000 })).toBeTruthy()
  })
})
