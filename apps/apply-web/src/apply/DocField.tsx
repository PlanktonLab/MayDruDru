/** 一份文件的上傳欄位（SPEC §8.1 上傳流程五個步驟的 UI）。
 *
 * 讀檔 →（`must_mask` 時）遮罩編輯器 → 辨識 → 交回給上一層做 precheck。
 * 原圖只在記憶體裡走這一遭，離開瀏覽器的只有遮罩後合併好的那張 JPEG（SPEC §11）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, FileUp, RefreshCcw, ShieldCheck, X } from 'lucide-react'
import { Badge, Button, Card, Spinner, cx } from '@maydru/ui'
import { MaskEditor } from '@maydru/mask-editor'
import { disposeAll, encodePages, prepareFile, recognizePages } from './pipeline'
import { captureOcrProgress, getOcrWorker } from '../lib/ocrWorker'
import type { UploadedDoc } from './state'
import type { SchemeDocumentType } from '../lib/types'

/** 這份文件被規則擋下來時要說的話（都來自 `rejection_codes`，不是我們自己造句）。 */
export interface DocProblem {
  rule_code: string
  what_wrong: string
  how_to_fix: string
  /** 對應的 SOP 教學；P4 會接上真正的步驟卡。 */
  sop_href: string
}

type Stage = 'idle' | 'reading' | 'masking' | 'recognizing' | 'done' | 'error'

export interface DocFieldProps {
  docType: SchemeDocumentType
  /** 覆寫顯示名稱；多期申請時會帶上「（第 N 期）」。預設用 `docType.label`。 */
  label?: string
  value?: UploadedDoc
  onChange: (doc: UploadedDoc) => void
  onClear: () => void
  problems?: DocProblem[]
  /** 缺這份就不能進下一步。 */
  required?: boolean
}

const ACCEPT = 'image/*,.heic,.heif,application/pdf'

/** 卡號自動偵測只對卡片與信用卡帳單有意義，其他文件跑它只是白等。 */
function wantsCardDetection(code: string): boolean {
  return code === 'CARD_LAST4_PHOTO' || code === 'BILLING_STATEMENT'
}

export function DocField({
  docType,
  label,
  value,
  onChange,
  onClear,
  problems = [],
  required = false,
}: DocFieldProps) {
  const title = label ?? docType.label
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [pageNote, setPageNote] = useState('')
  /** 等著進遮罩編輯器的頁面，以及已經遮好的那幾頁。 */
  const [pending, setPending] = useState<{
    canvases: HTMLCanvasElement[]
    masked: HTMLCanvasElement[]
    originalFormat: string
    qualityNote: string | null
    fileName: string
  } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(value?.previewUrl ?? null)

  // 外面換掉 value（例如補件面板重置）時，要 revoke 的還是最新那一個。
  useEffect(() => {
    previewRef.current = value?.previewUrl ?? null
  }, [value])

  // 換一張或離開頁面時把 objectURL 收掉，不然記憶體會一直長。
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  const finish = useCallback(
    async (
      canvases: HTMLCanvasElement[],
      meta: { masked: boolean; originalFormat: string; qualityNote: string | null; fileName: string },
    ) => {
      setStage('recognizing')
      setProgress(0)
      const release = captureOcrProgress(setProgress)
      try {
        const worker = await getOcrWorker()
        const ocr = await recognizePages(worker, canvases, (index, total) =>
          setPageNote(total > 1 ? `第 ${index + 1} / ${total} 頁` : ''),
        )
        const blob = await encodePages(canvases)
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        const previewUrl = URL.createObjectURL(blob)
        previewRef.current = previewUrl
        onChange({
          document_type_code: docType.code,
          blob,
          previewUrl,
          mime: blob.type || 'image/jpeg',
          page_count: canvases.length,
          masked: meta.masked,
          ocr,
          originalFormat: meta.originalFormat,
          qualityNote: meta.qualityNote,
          fileName: meta.fileName,
        })
        setStage('done')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '處理這個檔案時出了問題，請換一張照片再試一次。')
        setStage('error')
      } finally {
        release()
        setPageNote('')
        disposeAll(canvases)
        setPending(null)
      }
    },
    [docType.code, onChange],
  )

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError('')
      setStage('reading')
      try {
        const prepared = await prepareFile(file, docType.max_pages || 5)
        if (prepared.canvases.length === 0) {
          setError('這個檔案沒有可以辨識的內容，請換一份檔案。')
          setStage('error')
          return
        }
        if (docType.must_mask) {
          setPending({
            canvases: prepared.canvases,
            masked: [],
            originalFormat: prepared.originalFormat,
            qualityNote: prepared.qualityNote,
            fileName: file.name,
          })
          setStage('masking')
          return
        }
        await finish(prepared.canvases, {
          masked: false,
          originalFormat: prepared.originalFormat,
          qualityNote: prepared.qualityNote,
          fileName: file.name,
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '無法讀取這個檔案，請換一張照片或改用 JPG／PNG。')
        setStage('error')
      }
    },
    [docType.max_pages, docType.must_mask, finish],
  )

  const onMaskConfirm = useCallback(
    (masked: HTMLCanvasElement) => {
      setPending((current) => {
        if (!current) return null
        const done = [...current.masked, masked]
        if (done.length >= current.canvases.length) {
          void finish(done, {
            masked: true,
            originalFormat: current.originalFormat,
            qualityNote: current.qualityNote,
            fileName: current.fileName,
          })
          return current
        }
        return { ...current, masked: done }
      })
    },
    [finish],
  )

  const cancelMask = useCallback(() => {
    setPending((current) => {
      if (current) disposeAll([...current.canvases, ...current.masked])
      return null
    })
    setStage('idle')
  }, [])

  const clear = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setStage('idle')
    setError('')
    onClear()
  }, [onClear])

  const busy = stage === 'reading' || stage === 'recognizing'
  const blocked = problems.length > 0
  const maskIndex = pending ? pending.masked.length : 0

  return (
    <Card
      // 填好的欄位整張卡換成淺灰底：一排文件掃過去，還沒處理的那幾張是白的，
      // 一眼就看得出剩下哪些（被規則擋下的那張則是紅框，優先於已填）。
      className={cx(blocked ? 'border-danger' : value && 'bg-background-lite')}
      title={
        <span className="flex items-center gap-2">
          {title}
          {required && (
            <span className="text-danger" aria-label="必備文件">
              *
            </span>
          )}
        </span>
      }
      subtitle={docType.hint}
      actions={
        value ? (
          <span
            aria-label="已上傳"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
          >
            <Check size={14} strokeWidth={3} aria-hidden />
          </span>
        ) : undefined
      }
    >
      {docType.must_mask && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-accent-bg px-3 py-2 text-[13px] leading-5 text-accent">
          <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
          這份文件會先在你的手機上遮罩，遮好、你確認過之後才會上傳。原圖不會離開這支手機。
        </p>
      )}

      {value && !busy && stage !== 'masking' ? (
        <div className="space-y-3">
          <img
            src={value.previewUrl}
            alt={`${title}預覽（已處理）`}
            className="max-h-56 w-full rounded-xl border border-border object-contain"
          />
          <div className="flex flex-wrap gap-1.5">
            {value.masked && <Badge tone="good">已遮罩</Badge>}
            {value.originalFormat === 'HEIC' && <Badge tone="neutral">HEIC 已轉 JPEG</Badge>}
            {value.page_count > 1 && <Badge tone="neutral">{value.page_count} 頁</Badge>}
            {value.ocr && value.ocr.lines.length === 0 && <Badge tone="warn">沒有辨識到文字</Badge>}
          </div>
          {value.qualityNote && (
            <p className="flex items-start gap-2 text-[13px] leading-5 text-warn">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
              {value.qualityNote}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="md" icon={<RefreshCcw size={15} />} onClick={() => fileRef.current?.click()}>
              換一張
            </Button>
            <Button size="md" variant="ghost" icon={<X size={15} />} onClick={clear}>
              移除
            </Button>
          </div>
        </div>
      ) : busy ? (
        <div className="space-y-2 py-2">
          <Spinner label={stage === 'reading' ? '正在讀取檔案…' : '正在辨識文字…'} />
          {stage === 'recognizing' && (
            <div
              role="progressbar"
              aria-label="辨識進度"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-background-lite"
            >
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {pageNote && <p className="text-[13px] text-muted">{pageNote}</p>}
          <p className="text-[13px] text-muted">辨識在你的手機上進行，不會上傳原圖。</p>
        </div>
      ) : (
        // 兩顆等寬：手機上拇指不用瞄準，而且「拍照」與「選檔案」是同一層級的選擇，
        // 不該一大一小看起來像主／次要動作。
        <div className="grid grid-cols-2 gap-2">
          <Button size="md" block icon={<Camera size={16} />} onClick={() => cameraRef.current?.click()}>
            拍照
          </Button>
          <Button size="md" block icon={<FileUp size={16} />} onClick={() => fileRef.current?.click()}>
            選擇檔案
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] leading-5 text-danger">
          {error}
        </p>
      )}

      {blocked && (
        <ul className="mt-3 space-y-2">
          {problems.map((problem) => (
            <li key={problem.rule_code} className="rounded-xl bg-danger-bg px-3 py-2.5 text-[13px] leading-5">
              <p className="font-medium text-danger">{problem.what_wrong}</p>
              <p className="mt-1 text-muted">{problem.how_to_fix}</p>
              <a className="mt-1.5 inline-flex min-h-11 items-center text-accent underline" href={problem.sop_href}>
                教我怎麼取得
              </a>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label={`選擇${title}的檔案`}
        onChange={(event) => {
          void pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={`拍攝${title}`}
        onChange={(event) => {
          void pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {pending && stage === 'masking' && (
        <div className="mt-3">
          {pending.canvases.length > 1 && (
            <p className="mb-2 text-[13px] text-muted">
              第 {maskIndex + 1} / {pending.canvases.length} 頁，每一頁都要確認一次。
            </p>
          )}
          <MaskEditor
            key={maskIndex}
            source={pending.canvases[maskIndex]}
            mustMask
            autoDetectCardNumber={wantsCardDetection(docType.code)}
            keepHint={docType.keep_visible ?? docType.hint}
            onConfirm={onMaskConfirm}
            onCancel={cancelMask}
          />
        </div>
      )}
    </Card>
  )
}
