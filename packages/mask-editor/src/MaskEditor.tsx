/**
 * 遮罩編輯器（SPEC §8.1 上傳流程第 2 步、§11 隱私）。
 *
 * 三條硬規則，這個元件全部要做到：
 *   1. 自動偵測卡號並預先遮好，市民可以手動補遮或取消；
 *   2. 遮罩在**瀏覽器端**燒進圖片，原圖永遠不上傳；
 *   3. `mustMask` 的文件，市民**必須自己勾選確認**才送得出去；
 *      任何遮罩異動都會把勾選清掉，逼他再看一次。
 *
 * 而且要讓市民**看得到**這件事——隱私設計如果不講，對他而言等於不存在。
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, Check, Eraser, Loader2, Plus, ScanLine, Trash2, X } from 'lucide-react'
import type { Worker } from 'tesseract.js'
import { Button, Checkbox, cx } from '@maydru/ui'
import {
  applyMasks,
  disposeCanvas,
  isMaskBigEnough,
  rectFromDrag,
  topmostMaskAt,
  type DragBox,
  type MaskRect,
} from './mask'
import { CardOcrDetectionError, createCardOcrWorker, detectCardMasks, verifyCardMask, type CardOcrResult } from './cardOcr'

export interface MaskEditorMeta {
  masks: MaskRect[]
  /** 自動偵測成功時的卡號末四碼。 */
  last4?: string
}

export interface MaskEditorProps {
  /** 已縮圖、已轉正的來源影像（`@maydru/ocr` 的 `loadImage()` 輸出）。 */
  source: HTMLCanvasElement
  /** 這份文件是否強制遮罩：true 時一定要勾選確認才送得出去。 */
  mustMask: boolean
  /** 是否自動偵測卡號（信用卡照片、帳單才需要）。 */
  autoDetectCardNumber: boolean
  /** 一句「請保留清楚可見」的提示，例如「持卡人姓名、卡號末四碼」。 */
  keepHint?: string
  onConfirm: (masked: HTMLCanvasElement, meta: MaskEditorMeta) => void
  onCancel: () => void
  /** 外部共用的 tesseract worker；沒給就自己開一個，並在收掉時終止。 */
  ocrWorker?: Worker
}

type OcrState = 'idle' | 'scanning' | 'ready' | 'manual' | 'verifying'

export function MaskEditor({
  source,
  mustMask,
  autoDetectCardNumber,
  keepHint,
  onConfirm,
  onCancel,
  ocrWorker,
}: MaskEditorProps) {
  const [masks, setMasks] = useState<MaskRect[]>([])
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [drawing, setDrawing] = useState<DragBox | null>(null)
  const [ocrState, setOcrState] = useState<OcrState>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrResult, setOcrResult] = useState<CardOcrResult | null>(null)
  const [ocrDetail, setOcrDetail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workerRef = useRef<Worker | null>(ocrWorker ?? null)

  /** 任何遮罩異動都要重新確認一次（SPEC §8.1「必須勾選確認」）。 */
  const changeMasks = useCallback((next: (current: MaskRect[]) => MaskRect[]) => {
    setMasks(next)
    setConfirmed(false)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = source.width
    canvas.height = source.height
    canvas.getContext('2d')?.drawImage(source, 0, 0)
  }, [source])

  useEffect(() => {
    if (!autoDetectCardNumber) return
    let cancelled = false
    let ownWorker: Worker | null = null

    void (async () => {
      setOcrState('scanning')
      try {
        const worker =
          ocrWorker ??
          (ownWorker = await createCardOcrWorker((progress) => {
            if (!cancelled) setOcrProgress(progress)
          }))
        if (cancelled) return
        workerRef.current = worker
        const result = await detectCardMasks(worker, source)
        if (cancelled) return
        setMasks(result.masks)
        setOcrResult(result)
        setConfirmed(false)
        setOcrState('ready')
      } catch (caught) {
        if (cancelled) return
        setOcrDetail(caught instanceof CardOcrDetectionError ? caught.message : '')
        setOcrState('manual')
      }
    })()

    return () => {
      cancelled = true
      if (ownWorker) {
        workerRef.current = null
        void ownWorker.terminate()
      }
    }
  }, [autoDetectCardNumber, ocrWorker, source])

  const busy = ocrState === 'scanning' || ocrState === 'verifying'

  const relative = (event: ReactPointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return
    const point = relative(event)
    if (mode === 'remove') {
      const hit = topmostMaskAt(masks, point.x, point.y)
      if (hit) changeMasks((current) => current.filter((mask) => mask !== hit))
      return
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrawing({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return
    const point = relative(event)
    setDrawing((current) => (current ? { ...current, x1: point.x, y1: point.y } : null))
  }

  const onPointerUp = () => {
    if (!drawing) return
    const rect = rectFromDrag(drawing)
    if (isMaskBigEnough(rect)) changeMasks((current) => [...current, { ...rect, source: 'MANUAL' }])
    setDrawing(null)
  }

  const confirm = async () => {
    if (mustMask && !confirmed) return
    setError('')
    let masked: HTMLCanvasElement
    try {
      masked = applyMasks(source, masks)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '遮罩失敗，請重新整理頁面再試一次。')
      return
    }

    /*
     * 自動偵測成功過的卡片，遮完再讀一次看有沒有漏掉的數字。
     *
     * 複檢的結果只是**提醒**，不擋送出：辨識本來就會失敗（反光、燙金字、
     * 卡面花紋），擋下去的人手上已經有一張自己檢查過、也勾了確認的圖，
     * 卻只能對著同一個錯誤重按——最後還是打電話。真的有漏，承辦人員看得到。
     */
    if (ocrResult && workerRef.current) {
      setOcrState('verifying')
      try {
        const verification = await verifyCardMask(workerRef.current, masked, ocrResult)
        if (!verification.safe) {
          setOcrDetail(
            `仍讀得到 ${verification.extraDigits.length} 個其他數字；末四碼${verification.last4Visible ? '可辨識' : '未完整辨識'}`,
          )
        }
      } catch {
        // 複檢自己壞掉更不該擋人——照原本的遮罩結果走。
      }
    }

    onConfirm(masked, { masks, ...(ocrResult ? { last4: ocrResult.last4 } : {}) })
  }

  const cancel = () => {
    disposeCanvas(source)
    onCancel()
  }

  const preview = drawing ? rectFromDrag(drawing) : null

  return (
    // 桌面從右邊滑出一個抽屜，手機仍然是整頁蓋上來：桌面有空間讓人一邊看抽屜、
    // 一邊對照後面的上傳清單；手機沒有，遮罩本來就是要專心做完的一件事。
    <div
      className="fixed inset-0 z-50 flex justify-end bg-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="編輯個資遮罩"
    >
      <div
        className="md-drawer flex h-full w-full flex-col overflow-hidden bg-background lg:max-w-4xl"
        style={{ boxShadow: 'var(--shadow-sheet)' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-canvas px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent">
              <ScanLine size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold tracking-tight text-primary">編輯個資遮罩</h2>
              <p className="truncate text-[12px] text-muted">圖片只在這台裝置處理，原圖不會上傳</p>
            </div>
          </div>
          <Button variant="ghost" size="md" onClick={cancel} icon={<X size={16} />} aria-label="取消並關閉">
            <span className="hidden sm:inline">取消</span>
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted">在照片上拖曳，框出要蓋掉的內容</p>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant={mode === 'add' ? 'primary' : 'secondary'}
                  aria-pressed={mode === 'add'}
                  onClick={() => setMode('add')}
                  icon={<Plus size={14} />}
                >
                  新增遮罩
                </Button>
                <Button
                  size="sm"
                  variant={mode === 'remove' ? 'primary' : 'secondary'}
                  aria-pressed={mode === 'remove'}
                  onClick={() => setMode('remove')}
                  icon={<Eraser size={14} />}
                >
                  移除遮罩
                </Button>
                {masks.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="清除全部遮罩"
                    onClick={() => changeMasks(() => [])}
                    icon={<Trash2 size={14} />}
                  />
                )}
              </div>
            </div>

            {/* `[&>*]:max-h-full` 讓照片的高度不超過這一格，`max-w-full` 管寬度；
                兩個都是上限、不是指定值，所以 `aspect-ratio` 仍然說了算，比例不會跑掉。 */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-background-lite p-2 sm:p-4">
              <div
                ref={wrapRef}
                data-testid="mask-surface"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={cx(
                  // 比例交給 `aspect-ratio`，尺寸交給 `max-w`／`max-h`——
                  // 原本是 `w-full` + `max-h-full`：容器一矮，高度被切掉但寬度還是
                  // 100%，圖就被壓扁了。改成兩邊都只設上限，瀏覽器會在維持比例的
                  // 前提下取較小的那一邊。
                  'relative max-h-full max-w-full touch-none overflow-hidden rounded-lg bg-canvas select-none',
                  mode === 'add' ? 'cursor-crosshair' : 'cursor-pointer',
                )}
                style={{ aspectRatio: `${source.width} / ${source.height}` }}
              >
                <canvas ref={canvasRef} className="block h-full w-full" />
                {masks.map((mask, index) => (
                  <div
                    key={`${mask.x}-${mask.y}-${index}`}
                    data-testid="mask-rect"
                    className={cx(
                      'absolute bg-[#0f172a]',
                      mode === 'remove' ? 'ring-2 ring-danger' : 'ring-1 ring-white/70',
                    )}
                    style={{
                      left: `${mask.x * 100}%`,
                      top: `${mask.y * 100}%`,
                      width: `${mask.w * 100}%`,
                      height: `${mask.h * 100}%`,
                    }}
                  />
                ))}
                {preview && (
                  <div
                    aria-hidden
                    className="absolute border-2 border-dashed border-white bg-[#0f172a]/60"
                    style={{
                      left: `${preview.x * 100}%`,
                      top: `${preview.y * 100}%`,
                      width: `${preview.w * 100}%`,
                      height: `${preview.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </section>

          <aside className="flex shrink-0 flex-col border-t border-border bg-canvas lg:border-l lg:border-t-0">
            <div className="space-y-3 overflow-y-auto p-4">
              {keepHint && (
                <div className="rounded-xl bg-accent-bg p-3.5">
                  <p className="text-[11px] font-semibold tracking-wide text-accent">請保留清楚可見</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-primary">{keepHint}</p>
                </div>
              )}

              {autoDetectCardNumber && (
                <div aria-live="polite" className="space-y-2">
                  {ocrState === 'scanning' && (
                    <p className="flex items-center gap-2 rounded-xl bg-background-lite p-3 text-[13px] text-muted">
                      <Loader2 aria-hidden size={15} className="shrink-0 animate-spin text-accent" />
                      正在這台裝置辨識… {Math.round(ocrProgress * 100)}%
                    </p>
                  )}
                  {ocrState === 'ready' && ocrResult && (
                    <p className="flex items-start gap-2 rounded-xl bg-accent-bg p-3 text-[13px] leading-relaxed text-accent">
                      <Check aria-hidden size={15} className="mt-0.5 shrink-0" />
                      已自動蓋住其他數字，只留末四碼 {ocrResult.last4}。請看一下預覽有沒有漏掉的。
                    </p>
                  )}
                  {ocrState === 'manual' && (
                    <p className="flex items-start gap-2 rounded-xl bg-warn-bg p-3 text-[13px] leading-relaxed text-warn">
                      <AlertTriangle aria-hidden size={15} className="mt-0.5 shrink-0" />
                      <span>
                        這張照片沒辦法自動判讀。請自己把安全碼、有效期限，以及末四碼以外的數字框起來蓋掉。
                        {ocrDetail && <small className="mt-1 block opacity-80">辨識摘要：{ocrDetail}</small>}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-xl bg-danger-bg p-3 text-[13px] leading-relaxed text-danger">
                  {error}
                </p>
              )}

              <p className="text-[13px] text-muted">目前有 {masks.length} 塊遮罩。</p>
            </div>

            <div className="mt-auto space-y-3 border-t border-border p-4">
              {mustMask && (
                <Checkbox
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  label="我已檢查過，敏感資訊都蓋住了"
                  description="需要保留的欄位仍然看得見，其餘個資已遮蔽。"
                />
              )}
              <Button
                variant="primary"
                size="lg"
                block
                loading={ocrState === 'verifying'}
                disabled={busy || (mustMask && !confirmed)}
                onClick={() => void confirm()}
                icon={<Check size={16} />}
              >
                {ocrState === 'verifying' ? '正在複檢…' : '完成，使用這張圖'}
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
