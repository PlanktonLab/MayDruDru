/** Admin-only advanced mode: edit the replica HTML directly (SPEC §6.2 step 5). */
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, put } from '../../lib/api'
import { Button, Modal, Spinner, Textarea, confirm, errMsg, useToast } from '../ui'
import { fetchProtectedText } from './hooks'

interface Props { open: boolean; onClose: () => void; variantId: string; onSaved: () => Promise<unknown> }

export function AdvancedHtmlModal({ open, onClose, variantId, onSaved }: Props) {
  const toast = useToast()
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setLoadError(''); setHtml('')
    fetchProtectedText(`/api/variants/${variantId}/replica.html`)
      .then((t) => { if (!cancelled) setHtml(t) })
      .catch((e: unknown) => { if (!cancelled) setLoadError(errMsg(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, variantId])

  const save = async () => {
    if (!await confirm({ title: '套用這份 HTML？', body: '復刻圖會重新渲染，所有標註與教學圖都會被清空。', action: '套用', danger: true })) return
    setBusy(true)
    try {
      await put(`/api/variants/${variantId}/replica-html`, { html })
      await onSaved()
      toast('HTML 已套用並重新渲染')
      onClose()
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e), 'err') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="直接編輯復刻 HTML" subtitle="管理員的進階功能" width={900}>
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>套用後會以此 HTML 重新渲染復刻圖，並<strong>清空所有標註與教學圖</strong>，狀態回到「標註中」。HTML 必須自包含、無 script、無外部資源。</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> 讀取 HTML 中…</div>
      ) : loadError ? (
        <div className="py-4 text-sm text-danger">{loadError}</div>
      ) : (
        <Textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={22} spellCheck={false} className="font-mono text-xs leading-5" />
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-secondary">{html.length.toLocaleString()} 字元</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={loading || !!loadError || !html.trim()}>套用並重新渲染</Button>
        </div>
      </div>
    </Modal>
  )
}
