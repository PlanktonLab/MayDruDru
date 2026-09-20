import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, Maximize2 } from 'lucide-react'
import { Badge, Button, Modal, Select } from '@maydru/ui'
import { DocumentViewer, toPercentBox, type DocumentViewerProps } from './DocumentViewer'
import type { CaseDocument } from './types'
import { dateTime } from './labels'

function isSupplement(doc: CaseDocument, since?: string) {
  return Boolean(since && doc.is_current && new Date(doc.uploaded_at) >= new Date(since))
}

function Preview({ doc, loadUrl, highlight, onOpen }: {
  doc: CaseDocument; loadUrl: DocumentViewerProps['loadUrl']; highlight: boolean; onOpen: () => void
}) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [failed, setFailed] = useState(false)
  const query = useQuery({ queryKey: ['document-preview', doc.id], queryFn: () => loadUrl(doc.id),
    enabled: !doc.purged_at, staleTime: 240_000, refetchInterval: 240_000 })
  if (doc.purged_at) return <p className="p-6 text-sm text-muted">文件已依保存期限清除</p>
  if (query.isPending) return <p className="p-6 text-sm text-muted">載入文件…</p>
  if (query.error || failed) return <div className="p-6 text-sm text-danger">無法載入文件。<button onClick={() => { setFailed(false); void query.refetch() }} className="ml-2 underline">重試</button></div>
  if (doc.mime === 'application/pdf') return <button onClick={onOpen} className="w-full p-10 text-sm text-accent">PDF 文件 · {doc.page_count} 頁 · 開啟檢視</button>
  return <button onClick={onOpen} aria-label={`展開 ${doc.document_type_label} 第 ${doc.period_index ?? 1} 期`} className="block w-full p-3">
    <span className="relative inline-block max-w-full align-middle">
      <img src={query.data} alt={doc.document_type_label} onError={() => setFailed(true)}
        onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        className="max-h-80 w-auto max-w-full rounded-lg object-contain" />
      {highlight && doc.ocr?.lines.map((line, i) => {
        const box = toPercentBox(line.bbox, size.width, size.height)
        return box && <span key={i} aria-hidden className="pointer-events-none absolute border border-accent bg-accent/10"
          style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }} />
      })}
    </span>
  </button>
}

export function DocumentOverview({ supplementSince, ...props }: DocumentViewerProps & { supplementSince?: string }) {
  const [highlight, setHighlight] = useState(true)
  const [period, setPeriod] = useState('all')
  const [onlySupplement, setOnlySupplement] = useState(false)
  const current = props.documents.filter((d) => d.is_current)
  const periods = [...new Set(current.map((d) => d.period_index ?? 1))].sort((a, b) => a - b)
  const supplementCount = current.filter((d) => isSupplement(d, supplementSince)).length
  const shown = current.filter((d) => (period === 'all' || (d.period_index ?? 1) === Number(period)) && (!onlySupplement || isSupplement(d, supplementSince)))
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-canvas p-4">
      <div><h2 className="font-semibold">文件總覽</h2><p className="mt-1 text-xs text-muted">目前版本 {current.length} 份，可展開單份文件檢視</p></div>
      <Button size="sm" onClick={() => setHighlight(!highlight)} aria-pressed={highlight} icon={<Eye size={14} />}>{highlight ? '隱藏高亮' : '顯示高亮'}</Button>
      {periods.length > 1 && <Select aria-label="文件期數" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">全部期數</option>{periods.map((p) => <option key={p} value={p}>第 {p} 期</option>)}</Select>}
      {supplementCount > 0 && <Button size="sm" onClick={() => setOnlySupplement(!onlySupplement)} aria-pressed={onlySupplement}>{onlySupplement ? '顯示全部文件' : `只看本次補件（${supplementCount}）`}</Button>}
    </header>
    <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
      {!shown.length && <p className="p-6 text-sm text-muted">沒有符合條件的文件。</p>}
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((doc) => <article key={doc.id} className={`overflow-hidden rounded-2xl border bg-canvas ${isSupplement(doc, supplementSince) ? 'border-accent ring-2 ring-accent' : 'border-border'}`}>
          <header className="border-b border-border p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{doc.document_type_label || doc.document_type_code}</h3><button onClick={() => props.onSelect(doc.id)} aria-label={`檢視 ${doc.document_type_label}`} className="rounded p-1 text-muted hover:text-accent"><Maximize2 size={16} /></button></div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isSupplement(doc, supplementSince) && <Badge tone="accent">本次補件</Badge>}
              {periods.length > 1 && <Badge tone="neutral">第 {doc.period_index ?? 1} 期</Badge>}
              <span className="text-xs text-muted">第 {doc.revision + 1} 版 · {dateTime(doc.uploaded_at)}</span>
              {doc.masked && <Badge tone="neutral">已遮罩</Badge>}
            </div>
          </header>
          <Preview doc={doc} loadUrl={props.loadUrl} highlight={highlight} onOpen={() => props.onSelect(doc.id)} />
        </article>)}
      </div>
    </div>
    {props.selectedId && <Modal open title="文件檢視" width={1200} onClose={() => props.onSelect('')}>
      <div className="h-[75vh]"><DocumentViewer {...props} /></div>
    </Modal>}
  </div>
}
