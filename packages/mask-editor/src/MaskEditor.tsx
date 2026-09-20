/**
 * Privacy-mask workflow shell.
 *
 * Image manipulation lives entirely in MaskCanvas. This component owns only
 * OCR, privacy confirmation, and returning a burned-in canvas to the caller.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, ScanLine, X } from 'lucide-react'
import type { Worker } from 'tesseract.js'
import { Button, Checkbox } from '@maydru/ui'
import { applyMasks, disposeCanvas, type MaskRect } from './mask'
import { MaskCanvas } from './MaskCanvas'
import { CardOcrDetectionError, createCardOcrWorker, detectCardMasks, verifyCardMask, type CardOcrResult } from './cardOcr'

export interface MaskEditorMeta {
  masks: MaskRect[]
  last4?: string
}

export interface MaskEditorProps {
  source: HTMLCanvasElement
  mustMask: boolean
  autoDetectCardNumber: boolean
  /** Demo／既有文件可帶入已存在的遮罩，進入編輯器後仍可拖曳與縮放。 */
  initialMasks?: MaskRect[]
  keepHint?: string
  onConfirm: (masked: HTMLCanvasElement, meta: MaskEditorMeta) => void
  onCancel: () => void
  ocrWorker?: Worker
}

type OcrState = 'idle' | 'scanning' | 'ready' | 'manual' | 'verifying'

export function MaskEditor({
  source,
  mustMask,
  autoDetectCardNumber,
  initialMasks = [],
  keepHint,
  onConfirm,
  onCancel,
  ocrWorker,
}: MaskEditorProps) {
  const [masks, setMasks] = useState<MaskRect[]>(initialMasks)
  const [ocrState, setOcrState] = useState<OcrState>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrResult, setOcrResult] = useState<CardOcrResult | null>(null)
  const [ocrDetail, setOcrDetail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const workerRef = useRef<Worker | null>(ocrWorker ?? null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const changeMasks = useCallback((next: MaskRect[]) => {
    setMasks(next)
    setConfirmed(false)
  }, [])

  useEffect(() => {
    if (!autoDetectCardNumber) return
    let cancelled = false
    let ownWorker: Worker | null = null

    void (async () => {
      setOcrState('scanning')
      try {
        const worker = ocrWorker ?? (ownWorker = await createCardOcrWorker((progress) => {
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

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_360px] md:overflow-hidden">
          <MaskCanvas source={source} masks={masks} onChange={changeMasks} disabled={busy} />

          <aside className="flex min-h-0 flex-col border-t border-border bg-canvas md:border-l md:border-t-0">
            <div className="space-y-3 overflow-y-auto p-4">
              <div className="rounded-xl bg-background-lite p-3 text-[12px] leading-relaxed text-muted">
                <p className="font-semibold text-primary">編輯方式</p>
                <p className="mt-1">像 SOP 標註一樣，直接在圖片上拖曳框選。拖動已有遮罩可移動，拉四角可調整大小。</p>
              </div>

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
                      已自動蓋住其他數字，只留末四碼 {ocrResult.last4}。請檢查預覽有沒有漏掉。
                    </p>
                  )}
                  {ocrState === 'manual' && (
                    <p className="flex items-start gap-2 rounded-xl bg-warn-bg p-3 text-[13px] leading-relaxed text-warn">
                      <AlertTriangle aria-hidden size={15} className="mt-0.5 shrink-0" />
                      <span>
                        這張照片沒辦法自動判讀。請把安全碼、有效期限，以及末四碼以外的數字遮住。
                        {ocrDetail && <small className="mt-1 block opacity-80">辨識摘要：{ocrDetail}</small>}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 text-[13px] text-danger">{error}</p>}
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
                variant="primary" size="lg" block loading={ocrState === 'verifying'}
                disabled={busy || (mustMask && !confirmed)} onClick={() => void confirm()} icon={<Check size={16} />}
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
