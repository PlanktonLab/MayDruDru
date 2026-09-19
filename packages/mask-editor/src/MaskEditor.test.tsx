import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** tesseract.js 全程被替換：測試不下載語言模型、不碰網路。 */
const recognize = vi.fn()
const setParameters = vi.fn().mockResolvedValue(undefined)
const terminate = vi.fn().mockResolvedValue(undefined)
const createWorker = vi.fn()

vi.mock('tesseract.js', () => ({
  PSM: { AUTO: '3', SPARSE_TEXT: '11' },
  createWorker: (...args: unknown[]) => createWorker(...args),
}))

const { MaskEditor } = await import('./MaskEditor')

/** jsdom 的 canvas 沒有 2D context，也沒有版面尺寸——兩者都補上。 */
function stubCanvasAndLayout(): void {
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    fillStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  } as DOMRect)
}

const source = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

/** Explicitly add one mask. Blank canvas gestures must never create one. */
function drawMask(): void {
  fireEvent.click(screen.getByRole('button', { name: /新增遮罩/ }))
}

beforeEach(() => {
  recognize.mockReset()
  createWorker.mockReset()
  createWorker.mockResolvedValue({ recognize, setParameters, terminate })
  stubCanvasAndLayout()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('MaskEditor 的確認邏輯', () => {
  it('mustMask 時，沒勾確認就按不下送出', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const submit = screen.getByRole('button', { name: /完成，使用這張圖/ })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(/我已檢查過/))
    expect((submit as HTMLButtonElement).disabled).toBe(false)
  })

  it('勾完之後又動遮罩，確認會被取消', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const submit = screen.getByRole('button', { name: /完成，使用這張圖/ }) as HTMLButtonElement
    const checkbox = screen.getByLabelText(/我已檢查過/) as HTMLInputElement

    fireEvent.click(checkbox)
    expect(submit.disabled).toBe(false)

    drawMask()
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)
    expect(checkbox.checked).toBe(false)
    expect(submit.disabled).toBe(true)
  })

  it('沒有 mustMask 的文件不出現勾選框，也不擋送出', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask={false}
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/我已檢查過/)).toBeNull()
    expect((screen.getByRole('button', { name: /完成，使用這張圖/ }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('onConfirm 拿得到遮罩後的 canvas 與遮罩清單', async () => {
    const onConfirm = vi.fn()
    const original = source()
    render(
      <MaskEditor
        source={original}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    drawMask()
    fireEvent.click(screen.getByLabelText(/我已檢查過/))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /完成，使用這張圖/ }))
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const [masked, meta] = onConfirm.mock.calls[0] as [HTMLCanvasElement, { masks: unknown[] }]
    expect(masked).not.toBe(original)
    expect(masked.width).toBe(800)
    expect(meta.masks).toHaveLength(1)
    expect(meta.masks[0]).toMatchObject({ source: 'MANUAL', x: 0.35, y: 0.45 })
  })

  it('取消時清掉來源影像，不留在記憶體裡', () => {
    const onCancel = vi.fn()
    const original = source()
    render(
      <MaskEditor
        source={original}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '取消並關閉' }))
    expect(onCancel).toHaveBeenCalled()
    expect(original.width).toBe(0)
  })

  it('選取遮罩後可以直接刪除', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    drawMask()
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /刪除選取/ }))
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('預覽會依編輯區計算符合視窗尺寸，不使用原始像素撐開頁面', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const surface = screen.getByTestId('mask-surface')
    const canvas = screen.getByTestId('mask-canvas')
    expect(surface.className.split(/\s+/)).not.toContain('w-full')
    expect(surface.style.width).toBe('336px')
    expect(surface.style.height).toBe('252px')
    expect(canvas.className).toContain('h-full')
    expect(canvas.className).toContain('w-full')
  })

  it('可以縮放並一鍵回到符合視窗', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const surface = screen.getByTestId('mask-surface')
    fireEvent.click(screen.getByRole('button', { name: '放大圖片' }))
    expect(screen.getByText('110%')).toBeTruthy()
    expect(Number.parseFloat(surface.style.width)).toBeCloseTo(369.6)
    expect(Number.parseFloat(surface.style.height)).toBeCloseTo(277.2)

    fireEvent.change(screen.getByRole('slider', { name: '圖片縮放' }), { target: { value: '175' } })
    expect(screen.getByText('175%')).toBeTruthy()
    expect(Number.parseFloat(surface.style.width)).toBeCloseTo(588)
    expect(Number.parseFloat(surface.style.height)).toBeCloseTo(441)

    fireEvent.click(screen.getByRole('button', { name: '讓圖片符合編輯區' }))
    expect(screen.getByText('100%')).toBeTruthy()
    expect(surface.style.width).toBe('336px')
    expect(surface.style.height).toBe('252px')
  })

  it('編輯器開啟時鎖住背景頁面捲動，關閉後還原', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByTestId('mask-stage').className).toContain('overflow-hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('移動畫布模式可以拖曳圖片', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const stage = screen.getByTestId('mask-stage')
    const surface = screen.getByTestId('mask-surface')
    fireEvent.click(screen.getByRole('button', { name: /移動畫布/ }))
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 180, pointerId: 3, button: 0 })
    fireEvent.pointerMove(stage, { clientX: 150, clientY: 140, pointerId: 3 })
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 140, pointerId: 3 })

    expect(surface.style.transform).toContain('translate(-50px, -40px)')
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('點擊或拖曳空白畫布不會偷偷建立遮罩', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const stage = screen.getByTestId('mask-stage')
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 150, pointerId: 4, button: 0 })
    fireEvent.pointerMove(stage, { clientX: 240, clientY: 180, pointerId: 4 })
    fireEvent.pointerUp(stage, { clientX: 240, clientY: 180, pointerId: 4 })

    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('按新增遮罩會立即在圖片中央建立可編輯遮罩', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新增遮罩/ }))
    const mask = screen.getByTestId('mask-rect')
    expect(Number.parseFloat(mask.style.left)).toBeCloseTo(35)
    expect(Number.parseFloat(mask.style.top)).toBeCloseTo(45)
    expect(screen.getAllByRole('button', { name: /調整遮罩/ })).toHaveLength(4)
  })

  it('已建立的遮罩可以拖曳移動並從四角調整大小', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    drawMask()
    const mask = screen.getByTestId('mask-rect')
    fireEvent.pointerDown(mask, { clientX: 100, clientY: 80, pointerId: 5 })
    const stage = screen.getByTestId('mask-stage')
    fireEvent.pointerMove(stage, { clientX: 140, clientY: 110, pointerId: 5 })
    fireEvent.pointerUp(stage, { clientX: 140, clientY: 110, pointerId: 5 })
    expect(Number.parseFloat(mask.style.left)).toBeCloseTo(45)
    expect(Number.parseFloat(mask.style.top)).toBeCloseTo(55)

    const handle = screen.getByRole('button', { name: '調整遮罩SE角' })
    fireEvent.pointerDown(handle, { clientX: 240, clientY: 180, pointerId: 6 })
    fireEvent.pointerMove(stage, { clientX: 320, clientY: 240, pointerId: 6 })
    fireEvent.pointerUp(stage, { clientX: 320, clientY: 240, pointerId: 6 })
    expect(Number.parseFloat(mask.style.width)).toBeCloseTo(35)
    expect(Number.parseFloat(mask.style.height)).toBeCloseTo(25)
  })

  it('滑鼠滾輪會以畫布為中心連續縮放，不需要按 Ctrl', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const stage = screen.getByTestId('mask-stage')
    const surface = screen.getByTestId('mask-surface')
    fireEvent.wheel(stage, { deltaY: -100, clientX: 200, clientY: 150 })
    expect(Number.parseFloat(surface.style.width)).toBeGreaterThan(336)
    expect(screen.getByText('116%')).toBeTruthy()
  })

  it('按 Delete 可以刪除目前選取的遮罩', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新增遮罩/ }))
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)
    fireEvent.keyDown(screen.getByTestId('mask-stage'), { key: 'Delete' })
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('選取遮罩後會顯示直接刪除入口', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新增遮罩/ }))
    expect(screen.getByText('遮罩 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刪除遮罩 1' }))
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('每按一次新增只建立一個遮罩，刪除後會重新要求確認', () => {
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    drawMask()
    drawMask()
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(2)

    const checkbox = screen.getByLabelText(/我已檢查過/) as HTMLInputElement
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /刪除選取/ }))

    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)
    expect(checkbox.checked).toBe(false)
  })
})

describe('MaskEditor 的卡號自動偵測', () => {
  /** 造一筆 tesseract 回應：一行卡號 + 一行姓名。 */
  const page = (pan: string) => ({
    data: {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: pan.split(' ').map((group, index) => ({
                    text: group,
                    confidence: 90,
                    bbox: { x0: index * 160, y0: 300, x1: index * 160 + 150, y1: 340 },
                  })),
                },
                {
                  words: [{ text: 'WILLIAM CHEN', confidence: 88, bbox: { x0: 0, y0: 400, x1: 300, y1: 430 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  })

  it('偵測成功時自動遮住末四碼以外的數字，並顯示末四碼', async () => {
    recognize.mockResolvedValue(page('4111 1111 1111 1111'))
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText(/只留末四碼 1111/)).toBeTruthy())
    // 16 碼扣掉末四碼 → 12 塊自動遮罩（SPARSE 第三輪讀到的是同一批，會再疊一次）
    expect(screen.getAllByTestId('mask-rect').length).toBeGreaterThanOrEqual(12)
    // 自動遮好也不算市民確認過
    expect((screen.getByLabelText(/我已檢查過/) as HTMLInputElement).checked).toBe(false)
  })

  it('湊不出唯一一組卡號時改請市民手動遮，並附上辨識摘要', async () => {
    recognize.mockResolvedValue(page('1234 5678'))
    render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText(/沒辦法自動判讀/)).toBeTruthy())
    expect(screen.getByText(/8 碼／Luhn 未通過/)).toBeTruthy()
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('用外部傳進來的 worker 時不自己開、也不終止它', async () => {
    recognize.mockResolvedValue(page('4111 1111 1111 1111'))
    const worker = { recognize, setParameters, terminate } as unknown as Parameters<
      typeof MaskEditor
    >[0]['ocrWorker']
    const { unmount } = render(
      <MaskEditor
        source={source()}
        mustMask
        autoDetectCardNumber
        ocrWorker={worker}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText(/只留末四碼 1111/)).toBeTruthy())
    expect(createWorker).not.toHaveBeenCalled()
    unmount()
    expect(terminate).not.toHaveBeenCalled()
  })
})
