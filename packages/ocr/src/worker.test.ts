import { beforeEach, describe, expect, it, vi } from 'vitest'

/** tesseract.js 全程被替換掉：測試永遠不下載語言模型、不碰網路。 */
const recognizeSpy = vi.fn()
const createWorkerSpy = vi.fn()

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => createWorkerSpy(...args),
}))

const { DEFAULT_LANGS, DEFAULT_LANG_PATH, createOcrWorker, recognize } = await import('./worker')

type FakeWorker = { recognize: typeof recognizeSpy }

beforeEach(() => {
  recognizeSpy.mockReset()
  createWorkerSpy.mockReset()
  createWorkerSpy.mockResolvedValue({ recognize: recognizeSpy } as FakeWorker)
})

describe('createOcrWorker', () => {
  it('預設載入 chi_tra + eng，語言資料走可覆寫的 langPath', async () => {
    await createOcrWorker()
    const [langs, oem, options] = createWorkerSpy.mock.calls[0] as [string[], undefined, { langPath: string }]
    expect(langs).toEqual([...DEFAULT_LANGS])
    expect(oem).toBeUndefined()
    expect(options.langPath).toBe(DEFAULT_LANG_PATH)
  })

  it('可以換成自架的語言資料與 core', async () => {
    await createOcrWorker({ langs: ['eng'], langPath: '/ocr-data', corePath: '/ocr-core', workerPath: '/ocr/worker.js' })
    const [langs, , options] = createWorkerSpy.mock.calls[0] as [
      string[],
      undefined,
      { langPath: string; corePath: string; workerPath: string },
    ]
    expect(langs).toEqual(['eng'])
    expect(options.langPath).toBe('/ocr-data')
    expect(options.corePath).toBe('/ocr-core')
    expect(options.workerPath).toBe('/ocr/worker.js')
  })

  it('只在辨識階段回報進度', async () => {
    const onProgress = vi.fn()
    await createOcrWorker({ onProgress })
    const [, , options] = createWorkerSpy.mock.calls[0] as [
      string[],
      undefined,
      { logger: (m: { status: string; progress: number }) => void },
    ]
    options.logger({ status: 'loading language traineddata', progress: 0.5 })
    expect(onProgress).not.toHaveBeenCalled()
    options.logger({ status: 'recognizing text', progress: 0.42 })
    expect(onProgress).toHaveBeenCalledWith(0.42)
  })
})

describe('recognize', () => {
  it('關掉自動轉正，並把結果正規化成標準格式', async () => {
    recognizeSpy.mockResolvedValue({
      data: {
        text: '末四碼 4826',
        confidence: 73.5,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: '末四碼 4826',
                    confidence: 73.5,
                    bbox: { x0: 10, y0: 20, x1: 200, y1: 60 },
                    words: [{ text: '4826', confidence: 90, bbox: { x0: 120, y0: 20, x1: 200, y1: 60 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    const worker = await createOcrWorker()
    const result = await recognize(worker, 'data:image/png;base64,AA')

    expect(recognizeSpy).toHaveBeenCalledWith(
      'data:image/png;base64,AA',
      { rotateAuto: false },
      { blocks: true, text: true },
    )
    expect(result).toEqual({
      text: '末四碼 4826',
      confidence: 74,
      lines: [
        {
          text: '末四碼 4826',
          confidence: 74,
          bbox: { x0: 10, y0: 20, x1: 200, y1: 60 },
          words: [{ text: '4826', bbox: { x0: 120, y0: 20, x1: 200, y1: 60 }, confidence: 90 }],
        },
      ],
    })
  })
})
