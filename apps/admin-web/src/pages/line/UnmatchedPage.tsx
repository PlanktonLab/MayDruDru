/**
 * 未命中訊息（SPEC §8.6）——民眾打了字，但意圖分類器認不出來。
 *
 * 這張表是待辦清單，不是紀錄：看過、決定要補哪一則罐頭訊息或 FAQ 之後就「忽略」
 * 掉（後端直接刪列）。按「產生 FAQ 建議」會把這些句子聚類交給內容助理 (b)，
 * 每一群回一則附引用的 FAQ 草稿（SPEC §9.6）。
 *
 * 隱私：這裡只有 userId hash 的前八碼，永遠不存 LINE user id，也就沒辦法從後台
 * 反推是誰問的；送去給模型的句子還會再去識別化一次（SPEC §11 外送資料清單）。
 */

import { useQuery } from '@tanstack/react-query'
import { EyeOff, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import type { UnmatchedMessage } from '../../lib/types'
import { Badge, Button, Empty, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../../components/admin/shared'
import {
  acceptFaqSuggestion, dismissFaqSuggestion, fetchFaqSuggestions, generateFaqSuggestions,
} from '../schemes/queries'
import type { FaqSuggestion } from '../schemes/types'
import { SuggestionList } from './SuggestionCards'
import { dismissUnmatched, fetchUnmatched } from './queries'

/** 信心值只在有數字時才顯示成百分比；0.42 這種原始小數對承辦人沒有意義。 */
const confidenceText = (row: UnmatchedMessage) =>
  typeof row.intent_result?.confidence === 'number' ? `${Math.round(row.intent_result.confidence * 100)}%` : ''

export default function LineUnmatchedPage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const query = useQuery({ queryKey: ['line-unmatched'], queryFn: () => fetchUnmatched(100) })
  const items = query.data?.items ?? []

  const suggestions = useQuery({
    queryKey: ['faq-suggestions'],
    queryFn: fetchFaqSuggestions,
    enabled: admin,
  })
  const cards = suggestions.data?.items ?? []

  const dismiss = async (row: UnmatchedMessage) => {
    setBusyId(row.id)
    try {
      await dismissUnmatched(row.id)
      await invalidate('line-unmatched')
      toast('已忽略')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const out = await generateFaqSuggestions()
      await invalidate('faq-suggestions')
      toast(out.items.length ? `整理出 ${out.items.length} 則建議，發布前請先看過` : '目前沒有可以歸納的句子')
    } catch (e) { toast(errMsg(e), 'err') } finally { setGenerating(false) }
  }

  const accept = async (s: FaqSuggestion) => {
    setBusyId(s.id)
    try {
      await acceptFaqSuggestion(s.id)
      await invalidate('faq-suggestions')
      toast('已建立一則停用中的常見問題，改完再去啟用')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  const drop = async (s: FaqSuggestion) => {
    setBusyId(s.id)
    try {
      await dismissFaqSuggestion(s.id)
      await invalidate('faq-suggestions')
      toast('已忽略這則建議')
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="未命中訊息"
        description="民眾打了字但系統聽不懂的句子。這些會餵給內容助理，用來建議該補哪一則罐頭訊息或 FAQ；這裡只留 LINE 帳號雜湊值的前幾碼，不存也查不到是誰問的。"
        actions={admin && (
          <Button variant="primary" loading={generating} onClick={() => void generate()}>
            <Sparkles size={14} /> 產生 FAQ 建議
          </Button>
        )}
      />

      {admin && <SuggestionList items={cards} canWrite={admin} busyId={busyId} onAccept={accept} onDismiss={drop} />}

      {query.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {query.error && <Notice tone="warn">{errMsg(query.error)}</Notice>}
      {query.data && !items.length && <Empty>目前沒有聽不懂的訊息</Empty>}
      {!!items.length && (
        <Table>
          <thead>
            <tr>
              <Th>民眾打的字</Th>
              <Th className="w-44">分類結果</Th>
              <Th className="w-28">帳號雜湊</Th>
              <Th className="w-36">時間</Th>
              {admin && <Th className="w-24 text-right">操作</Th>}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="hover:bg-background-lite">
                <Td className="max-w-md"><span className="block break-words">{row.text}</span></Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <Badge tone="muted">{row.intent_result?.intent || '無法判斷'}</Badge>
                    {confidenceText(row) && <span className="text-[11px] tabular-nums text-muted">信心 {confidenceText(row)}</span>}
                  </span>
                </Td>
                <Td className="font-mono text-[11px] text-secondary">{row.user_hash || '—'}…</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.created_at)}</Td>
                {admin && (
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => void dismiss(row)} loading={busyId === row.id}><EyeOff size={13} /> 忽略</Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
