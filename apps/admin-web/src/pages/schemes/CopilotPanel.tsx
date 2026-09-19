/**
 * 內容助理 (c)：一鍵產生方案文案草稿（SPEC §8.6 c / §9.6 / 決策 D8）。
 *
 * 助理寫的是**草稿**，一個字都不會直接對外。所以這個面板只做兩件事：把產出的每一則
 * 連同引用列出來，再給一條路走到罐頭訊息頁去發布。發布鍵不在這裡，也不該在這裡——
 * 「按一下就對全市民生效」不該和「按一下生成」長得一樣近。
 *
 * 沒有依據的句子由伺服器標上「待查證」；這裡把那些句子挑出來放在最前面，因為那正是
 * 承辦人員唯一非看不可的部分。
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Badge, Button, Card, Empty, errMsg, useToast } from '../../components/ui'
import { Notice } from '../../components/admin/shared'
import { generateSchemeCopy } from './queries'
import type { SchemeCopyDraft, SchemeCopyResult } from './types'

export const UNVERIFIED = '（待查證）'

export const countUnverified = (drafts: SchemeCopyDraft[]) =>
  drafts.reduce((n, d) => n + d.draft.split('\n').filter((line) => line.includes(UNVERIFIED)).length, 0)

function DraftCard({ draft }: { draft: SchemeCopyDraft }) {
  const lines = draft.draft.split('\n').filter(Boolean)
  return (
    <li className="rounded-lg border border-border bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[11px] text-muted">{draft.key}</div>
        <Badge tone="muted">草稿</Badge>
      </div>
      <div className="mt-1.5 space-y-0.5 text-sm leading-6">
        {lines.map((line, i) => (
          <p key={i} className={line.includes(UNVERIFIED) ? 'text-warn' : undefined}>{line}</p>
        ))}
      </div>
      {!!draft.citations.length && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-secondary">
          {draft.citations.map((c, i) => (
            <li key={i}>
              <span className="font-mono">[{i}] {c.source_type}/{c.source_id}</span>　{c.quote}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function CopilotPanel({ code, canWrite }: { code: string; canWrite: boolean }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SchemeCopyResult | null>(null)

  const generate = async () => {
    setBusy(true)
    try {
      const out = await generateSchemeCopy(code)
      setResult(out)
      toast(`已寫入 ${out.drafts.length} 則草稿，發布前請先看過`)
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusy(false) }
  }

  const unverified = result ? countUnverified(result.drafts) : 0

  return (
    <Card
      title="內容助理"
      actions={canWrite && (
        <Button size="sm" variant="primary" loading={busy} onClick={() => void generate()}>
          <Sparkles size={13} /> 一鍵產生方案文案草稿
        </Button>
      )}
    >
      <div className="space-y-3">
        <Notice tone="muted">
          依這個方案的設定，一次產出每個案件狀態、每個退件碼與每份文件的對外文案草稿。
          助理只寫草稿，民眾看到的字要到「罐頭訊息」頁按發布才會換。
        </Notice>
        {!result && <Empty>還沒有產生過草稿</Empty>}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="accent">寫入 {result.drafts.length} 則草稿</Badge>
              {unverified > 0
                ? <Badge tone="warn">{unverified} 句沒有依據，已標「待查證」</Badge>
                : <Badge tone="good">每一句都指得出依據</Badge>}
              <Link to="/line/contents" className="text-xs text-accent underline">到罐頭訊息頁逐則過目並發布</Link>
            </div>
            <ul className="space-y-2">
              {result.drafts.map((d) => <DraftCard key={d.key} draft={d} />)}
            </ul>
          </>
        )}
      </div>
    </Card>
  )
}
