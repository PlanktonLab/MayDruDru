/** 第 1 步 工具：先確認資格，再讓市民去翻帳單（SPEC §8.1）。
 *
 * 選工具用下拉選單而不是一長串卡片：清單有幾十個工具，攤開來會把整個第一步
 * 變成一面牆，而人要找的是「我買的那一個」——這是選單的工作，不是瀏覽的工作。
 * 選完之後才把該工具的判定（可補助／不予補助／需人工認定）攤在下面說清楚。
 *
 * 不予補助的工具照樣收在選單裡，而且**說明為什麼**——把它藏起來，市民只會在
 * 準備完所有文件之後才在送件時撞牆。沒有收錄的工具可以自己填，由承辦人工認定。
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Badge, Card, Field, FlatSelect, Input, cx } from '@maydru/ui'
import type { FlatSelectOption } from '@maydru/ui'
import type { EligibleTool, SchemePublic, ToolStatus } from '../lib/types'
import type { ToolChoice } from './state'

const STATUS_TONE: Record<ToolStatus, 'good' | 'danger' | 'warn'> = {
  APPROVED: 'good',
  REJECTED: 'danger',
  PENDING: 'warn',
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  APPROVED: '可補助',
  REJECTED: '不予補助',
  PENDING: '需人工認定',
}

/** 選單裡代表「不在清單上」的那一項；用不可能與 tool id 相撞的字串。 */
const OTHER = '__other__'

/**
 * 不予補助的三個類別（計畫簡章的排除條款）。
 *
 * 這裡列的是**規則**而不是工具清單：工具永遠列不完，但排除的理由只有這三條，
 * 而且市民要判斷的是「我買的那個算不算這三類」。個別工具的判定另外由
 * `eligible_tools` 的 `status` 負責，兩者互補。
 */
const EXCLUSIONS = [
  {
    title: '中港澳軟體',
    detail: '凡屬中國（含港澳）開發營運之工具（如 CapCut、Kling、美圖、Manus 等）均不予補助。',
  },
  {
    title: '代購與集合平台',
    detail: '透過 Poe.com、GoingBus 等代購或集合式平台購買者不予補助（須於軟體官網直購）。',
  },
  {
    title: '儲值、點數與 API',
    detail: '以預付儲值、Credit、點數、Token 或 API 額度扣抵之服務不予補助（僅補助固定週期訂閱）。',
  },
] as const

export function matchesQuery(tool: EligibleTool, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (tool.name.toLowerCase().includes(needle)) return true
  if (tool.vendor?.toLowerCase().includes(needle)) return true
  return tool.aliases.some((alias) => alias.toLowerCase().includes(needle))
}

export interface ToolStepProps {
  scheme: SchemePublic
  value: ToolChoice
  onChange: (tool: ToolChoice) => void
  error?: string
}

export function ToolStep({ scheme, value, onChange, error }: ToolStepProps) {
  // 「其他」是自己填的，所以沒有 tool_id；用這個條件回推目前是不是選了其他。
  const [other, setOther] = useState(() => Boolean(value.name) && value.tool_id === null)

  const options: FlatSelectOption[] = useMemo(
    () => [
      ...scheme.eligible_tools
        .map((tool) => ({ value: tool.id, label: tool.name, group: STATUS_LABEL[tool.status] }))
        // 依名稱排序，找起來才像在翻字典；伺服器的順序是給承辦看的。
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })),
      { value: OTHER, label: '其他（自行填寫）' },
    ],
    [scheme.eligible_tools],
  )

  const selected = scheme.eligible_tools.find((tool) => tool.id === value.tool_id) ?? null

  return (
    <div className="space-y-4">
      <Field label="AI 工具名稱" required error={error} hint="選你實際購買的那一個；找不到就選最後一項自己填。">
        {(props) => (
          <FlatSelect
            id={props.id}
            aria-describedby={props['aria-describedby']}
            aria-invalid={props['aria-invalid']}
            value={other ? OTHER : (value.tool_id ?? '')}
            options={options}
            placeholder="請選擇 AI 工具"
            onChange={(next) => {
              if (next === OTHER) {
                setOther(true)
                onChange({ name: '', tool_id: null })
                return
              }
              setOther(false)
              const tool = scheme.eligible_tools.find((item) => item.id === next)
              if (tool) onChange({ name: tool.name, tool_id: tool.id })
            }}
          />
        )}
      </Field>

      {/* 選到不能補助或需人工認定的工具時才出聲。可補助是預期結果，
          再跳一張綠卡只是把「一切正常」講成一件事，佔掉畫面也讓人多讀一次。 */}
      {selected && selected.status !== 'APPROVED' && (
        <div
          className={cx(
            'rounded-xl border p-4',
            selected.status === 'REJECTED' ? 'border-danger/30 bg-danger-bg' : 'border-border bg-background-lite',
          )}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              size={17}
              aria-hidden
              className={cx('mt-0.5 shrink-0', selected.status === 'REJECTED' ? 'text-danger' : 'text-warn')}
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-primary">{selected.name}</span>
                <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </p>
              {selected.verdict_note && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{selected.verdict_note}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {other && (
        <Card title="自己填寫工具名稱" subtitle="沒收錄不代表不能申請，只是需要承辦人工認定。">
          <Field label="工具名稱" required error={error} hint="請照帳單上的英文原名填寫，方便承辦查證。">
            {(props) => (
              <Input
                {...props}
                value={value.name}
                onChange={(event) => onChange({ name: event.target.value, tool_id: null })}
                placeholder="例如 Perplexity Pro"
              />
            )}
          </Field>
        </Card>
      )}

      {/* 不予補助的範圍在選工具的當下就講清楚，而不是等送出才擋：
          這三類是最常見的誤申請，講在前面能省掉一整趟準備文件的白工。
          講「類別」而不是逐一列工具——清單永遠列不完，但規則只有這三條。 */}
      <div className="rounded-xl border border-border bg-background-lite p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-primary">
          <Info size={15} aria-hidden className="shrink-0 text-accent" />
          不予補助範圍提醒（請於申請前確認）
        </p>
        <ul className="mt-2 space-y-2">
          {EXCLUSIONS.map((item) => (
            <li key={item.title} className="text-[13px] leading-relaxed">
              <span className="font-medium text-primary">✕ {item.title}：</span>
              <span className="text-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
