/** 上傳管線（SPEC §8.1 第 1–3 步、§11）。
 *
 * `@maydru/ocr` 與遮罩編輯器都換成替身：這裡要驗的是**流程**——
 * 強制遮罩的文件沒確認就不會有結果，HEIC 會被標成已轉檔，讀檔失敗要說怎麼修。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fakeCanvas, ocrModuleMock, ocrResult } from '../test/utils'

const ocr = ocrModuleMock()
vi.mock('@maydru/ocr', () => ocr)

/** 遮罩編輯器的替身：按下「確認遮罩」才會把影像交出去，對應「必須勾選確認」那條規則。 */
vi.mock('@maydru/mask-editor', () => ({
  MaskEditor: ({
    onConfirm,
    onCancel,
    source,
  }: {
    onConfirm: (canvas: HTMLCanvasElement) => void
    onCancel: () => void
    source: HTMLCanvasElement
  }) => (
    <div>
      <p>遮罩編輯器</p>
      <button type="button" onClick={() => onConfirm(source)}>
        確認遮罩
      </button>
      <button type="button" onClick={onCancel}>
        取消遮罩
      </button>
    </div>
  ),
}))

const { DocField } = await import('./DocField')
const { DOCUMENT_TYPES } = await import('../mocks/data')

const affidavit = DOCUMENT_TYPES.find((type) => type.code === 'AFFIDAVIT')!
const billing = DOCUMENT_TYPES.find((type) => type.code === 'BILLING_STATEMENT')!

function file(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['bytes'], name, { type })
}

function pick(label: string, target: File) {
  const input = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(input, { target: { files: [target] } })
}

describe('DocField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ocr.loadImage.mockImplementation(async (f: File) => ({
      canvas: fakeCanvas(),
      width: 800,
      height: 600,
      originalFormat: /\.heic$/i.test(f.name) ? 'HEIC' : 'JPEG',
      probe: { longEdge: 800, sharpness: 0.5, brightness: 0.5 },
      qualityNote: null,
    }))
    ocr.recognize.mockResolvedValue(ocrResult(['臺幣 6,000']))
    ocr.toBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
  })

  it('不用遮罩的文件：選檔之後直接辨識並交回結果', async () => {
    const onChange = vi.fn()
    render(<DocField docType={affidavit} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇切結書的檔案', file())
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const doc = onChange.mock.calls[0][0]
    expect(doc.document_type_code).toBe('AFFIDAVIT')
    expect(doc.masked).toBe(false)
    expect(doc.ocr.lines).toHaveLength(1)
  })

  it('must_mask 的文件先進遮罩編輯器，沒確認就不會有結果', async () => {
    const onChange = vi.fn()
    render(<DocField docType={billing} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇信用卡帳單扣款紀錄的檔案', file())
    expect(await screen.findByText('遮罩編輯器')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(ocr.recognize).not.toHaveBeenCalled()
  })

  it('確認遮罩之後才辨識，並標記成已遮罩', async () => {
    const onChange = vi.fn()
    render(<DocField docType={billing} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇信用卡帳單扣款紀錄的檔案', file())
    fireEvent.click(await screen.findByText('確認遮罩'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].masked).toBe(true)
  })

  it('取消遮罩會回到起點，原圖被清掉', async () => {
    const onChange = vi.fn()
    render(<DocField docType={billing} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇信用卡帳單扣款紀錄的檔案', file())
    fireEvent.click(await screen.findByText('取消遮罩'))
    await waitFor(() => expect(screen.queryByText('遮罩編輯器')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
    expect(ocr.disposeCanvas).toHaveBeenCalled()
  })

  it('逐期文件使用期數標題，仍須確認遮罩後才交回結果', async () => {
    const onChange = vi.fn()
    render(<DocField docType={billing} label="信用卡帳單（第 2 期）" onChange={onChange} onClear={vi.fn()} />)
    pick('選擇信用卡帳單（第 2 期）的檔案', file())
    expect(await screen.findByText('遮罩編輯器')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('確認遮罩'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].document_type_code).toBe('BILLING_STATEMENT')
    expect(onChange.mock.calls[0][0].masked).toBe(true)
  })

  it('HEIC 會被標記成已轉 JPEG', async () => {
    const onChange = vi.fn()
    render(<DocField docType={affidavit} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇切結書的檔案', file('IMG_0001.heic', 'image/heic'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].originalFormat).toBe('HEIC')
  })

  it('PDF 走 pdfToPageCanvases，而且受頁數上限限制', async () => {
    const onChange = vi.fn()
    render(<DocField docType={affidavit} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇切結書的檔案', file('statement.pdf', 'application/pdf'))
    await waitFor(() => expect(ocr.pdfToPageCanvases).toHaveBeenCalled())
    expect(ocr.pdfToPageCanvases.mock.calls[0][1]).toEqual({ maxPages: affidavit.max_pages })
  })

  it('讀檔失敗時顯示「怎麼修」的訊息', async () => {
    ocr.loadImage.mockRejectedValueOnce(new Error('這支瀏覽器無法讀取 HEIC 照片。請改用「拍照」直接上傳。'))
    render(<DocField docType={affidavit} onChange={vi.fn()} onClear={vi.fn()} />)
    pick('選擇切結書的檔案', file('IMG_0002.heic', 'image/heic'))
    expect((await screen.findByRole('alert')).textContent).toContain('請改用「拍照」直接上傳')
  })

  it('品質不佳時顯示警告但仍然交回結果', async () => {
    ocr.loadImage.mockResolvedValueOnce({
      canvas: fakeCanvas(),
      width: 800,
      height: 600,
      originalFormat: 'JPEG',
      probe: { longEdge: 800, sharpness: 0.05, brightness: 0.5 },
      qualityNote: '照片有點模糊。請把手機放穩、等畫面對到焦再按快門。',
    })
    const onChange = vi.fn()
    render(<DocField docType={affidavit} onChange={onChange} onClear={vi.fn()} />)
    pick('選擇切結書的檔案', file())
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].qualityNote).toContain('模糊')
  })

  it('被規則擋下來時顯示怎麼修與 SOP 連結', () => {
    render(
      <DocField
        docType={billing}
        onChange={vi.fn()}
        onClear={vi.fn()}
        problems={[
          {
            rule_code: 'BILLING_TWD_AMOUNT',
            what_wrong: '出帳帳單上看不到換算後的臺幣金額',
            how_to_fix: '請重新取得一份含臺幣金額的帳單。',
            sop_href: '/sop?document_type=BILLING_STATEMENT',
          },
        ]}
      />,
    )
    expect(screen.getByText('出帳帳單上看不到換算後的臺幣金額')).toBeTruthy()
    expect(screen.getByRole('link', { name: '教我怎麼取得' }).getAttribute('href')).toBe(
      '/sop?document_type=BILLING_STATEMENT',
    )
  })
})
