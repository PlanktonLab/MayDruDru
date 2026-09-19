/** 文件卡內的情境式 SOP（SPEC §8.1、D41）。
 *
 * 不把人送離申請流程：先依方案與文件類型找已發布流程，唯一答案直接開始；
 * 真的有多個平台才問一次。完整 `/sop` 頁仍負責「我卡住了」的截圖定位。
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BookOpen, Check, Expand, ExternalLink, Map } from 'lucide-react'
import { Button, EmptyState, Modal, Spinner } from '@maydru/ui'
import { fetchSopFlows, fetchSopSteps } from '../lib/queries'

export interface DocumentSopHelpProps {
  documentTypeCode: string
  documentLabel: string
  schemeCode: string
  onReady: () => void
}

export function DocumentSopHelp({
  documentTypeCode,
  documentLabel,
  schemeCode,
  onReady,
}: DocumentSopHelpProps) {
  const [open, setOpen] = useState(false)
  const [flowId, setFlowId] = useState('')
  const [index, setIndex] = useState(0)

  const flows = useQuery({
    queryKey: ['document-sop', 'flows', documentTypeCode, schemeCode],
    queryFn: () => fetchSopFlows(documentTypeCode, '', schemeCode),
    enabled: open,
    retry: false,
  })
  // 唯一答案就直接開始。這是衍生值，不用先 setState 再多 render 一次。
  const activeFlowId = flowId || (flows.data?.length === 1 ? flows.data[0]!.flow_id : '')
  const steps = useQuery({
    queryKey: ['document-sop', 'steps', activeFlowId],
    queryFn: () => fetchSopSteps(activeFlowId),
    enabled: open && Boolean(activeFlowId),
    retry: false,
  })

  const close = () => {
    setOpen(false)
    setFlowId('')
    setIndex(0)
  }
  const ready = () => {
    close()
    onReady()
  }

  const messages = steps.data?.messages ?? []
  const current = messages[index]
  const last = messages.length > 0 && index === messages.length - 1
  const fullSopHref = activeFlowId
    ? `/sop/${encodeURIComponent(activeFlowId)}?document_type=${encodeURIComponent(documentTypeCode)}&scheme=${encodeURIComponent(schemeCode)}`
    : `/sop?document_type=${encodeURIComponent(documentTypeCode)}&scheme=${encodeURIComponent(schemeCode)}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 text-left text-[14px] font-semibold text-accent"
      >
        <BookOpen size={15} aria-hidden />
        還沒有這份文件？帶我取得
      </button>

      <Modal
        open={open}
        onClose={close}
        width={1280}
        maxHeight="94vh"
        title={`取得「${documentLabel}」`}
        subtitle={activeFlowId ? '一次只做一個步驟，完成後直接回來上傳。' : '選擇最符合你的操作方式。'}
        footer={
          current ? (
            <div className="flex w-full items-center gap-2">
              <Button
                size="lg"
                aria-label="上一步"
                disabled={index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                className="w-[52px] px-0"
              >
                <ArrowLeft size={16} aria-hidden />
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="min-w-0 flex-1"
                onClick={() => last ? ready() : setIndex((value) => value + 1)}
              >
                {last ? '我找到了，回來上傳' : '下一步'}
                {last ? <Check size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}
              </Button>
            </div>
          ) : undefined
        }
      >
        {flows.isLoading && <Spinner label="正在找適合你的教學…" />}

        {flows.error && (
          <EmptyState
            icon={<Map size={20} />}
            title="暫時無法載入教學"
            hint="你仍然可以先拍照或選擇檔案，系統會在送出前協助檢查。"
          />
        )}

        {!flows.isLoading && !flows.error && flows.data?.length === 0 && (
          <EmptyState
            icon={<Map size={20} />}
            title="這份文件還沒有逐步教學"
            hint="你可以先查看卡片上的合格範例，再拍照或選擇檔案。"
            action={<Button variant="primary" onClick={close}>回到上傳欄位</Button>}
          />
        )}

        {!flowId && (flows.data?.length ?? 0) > 1 && (
          <div className="grid gap-2" aria-label="選擇教學平台">
            {flows.data!.map((flow) => (
              <button
                key={flow.flow_id}
                type="button"
                onClick={() => { setFlowId(flow.flow_id); setIndex(0) }}
                className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-border bg-canvas px-4 py-3 text-left hover:border-accent"
              >
                <span>
                  <span className="block font-medium text-primary">{flow.flow_name}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{flow.platform?.display_name ?? '通用教學'}</span>
                </span>
                <ArrowRight size={18} className="text-accent" aria-hidden />
              </button>
            ))}
          </div>
        )}

        {activeFlowId && steps.isLoading && <Spinner label="載入步驟…" />}
        {activeFlowId && steps.error && (
          <EmptyState
            icon={<Map size={20} />}
            title="找不到這份教學"
            hint="流程可能正在更新。請先回到上傳欄位，或改用完整教學頁查看其他平台。"
          />
        )}

        {current && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.85fr)_minmax(280px,.65fr)] lg:items-start">
            <figure className="overflow-hidden rounded-2xl border border-border bg-background-lite">
              {current.url ? (
                <a
                  href={current.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block bg-canvas"
                  aria-label="以原始尺寸開啟教學圖片"
                >
                  <img
                    src={current.url}
                    alt={current.alt || `步驟 ${index + 1}：${current.title}`}
                    className="mx-auto block max-h-[70vh] w-full object-contain"
                  />
                  <span className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-canvas/95 px-3 text-[13px] font-medium text-primary shadow-sm backdrop-blur group-hover:bg-background-lite">
                    <Expand size={14} aria-hidden /> 原始尺寸
                  </span>
                </a>
              ) : (
                <div className="flex min-h-64 items-center justify-center px-4 text-center text-[13px] text-muted">
                  這個步驟沒有圖片，請依右側文字操作。
                </div>
              )}
            </figure>

            <div className="min-w-0">
              <p className="text-[12px] font-medium tabular-nums text-muted">步驟 {index + 1}／{messages.length}</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((index + 1) / messages.length) * 100}%` }} />
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight text-primary">{current.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{current.instruction}</p>
              <a
                href={fullSopHref}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-accent underline"
              >
                畫面不一樣？在新分頁使用截圖定位 <ExternalLink size={13} aria-hidden />
              </a>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
