/** 第 1 步 工具：先確認資格，再讓市民去翻帳單（SPEC §8.1）。
 *
 * 不予補助的工具照樣列出來，而且**說明為什麼**——把它藏起來，市民只會在準備完
 * 所有文件之後才在送件時撞牆。沒有收錄的工具可以自己填，由承辦人工認定。
 */

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Badge, Card, Field, Input, cx } from '@maydru/ui'
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
  const [query, setQuery] = useState('')
  const [other, setOther] = useState(() => Boolean(value.name) && value.tool_id === null)

  const tools = useMemo(
    () => scheme.eligible_tools.filter((tool) => matchesQuery(tool, query)),
    [scheme.eligible_tools, query],
  )

  return (
    <div className="space-y-4">
      <Field label="搜尋工具名稱" hint="輸入你在帳單上看到的名字，中英文都可以。">
        {(props) => (
          <div className="relative">
            <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <Input
              {...props}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 ChatGPT、Claude、Canva"
              className="pl-9"
              autoComplete="off"
            />
          </div>
        )}
      </Field>

      <ul className="space-y-2" aria-label="可選的工具">
        {tools.map((tool) => {
          const selected = value.tool_id === tool.id
          const rejected = tool.status === 'REJECTED'
          return (
            <li key={tool.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setOther(false)
                  onChange({ name: tool.name, tool_id: tool.id })
                }}
                className={cx(
                  'flex w-full min-h-11 items-start gap-3 rounded-2xl border p-4 text-left transition-colors',
                  selected ? 'border-accent bg-accent-bg' : 'border-border bg-canvas hover:bg-background-lite',
                  rejected && 'opacity-90',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-primary">{tool.name}</span>
                    <Badge tone={STATUS_TONE[tool.status]}>{STATUS_LABEL[tool.status]}</Badge>
                  </span>
                  {tool.vendor && <span className="mt-0.5 block text-[13px] text-muted">{tool.vendor}</span>}
                  {tool.verdict_note && (
                    <span className="mt-1 block text-[13px] leading-5 text-muted">{tool.verdict_note}</span>
                  )}
                </span>
                {selected && <Check size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />}
              </button>
            </li>
          )
        })}
      </ul>

      {tools.length === 0 && (
        <p className="text-[14px] text-muted">
          沒有符合「{query}」的工具。你可以在下面自己填寫名稱，由承辦人員認定。
        </p>
      )}

      <Card title="找不到你的工具？" subtitle="沒收錄不代表不能申請，只是需要人工認定。">
        <button
          type="button"
          aria-pressed={other}
          onClick={() => {
            setOther(true)
            onChange({ name: '', tool_id: null })
          }}
          className={cx(
            'min-h-11 w-full rounded-xl border px-4 py-2.5 text-left text-[15px]',
            other ? 'border-accent bg-accent-bg text-accent' : 'border-border bg-canvas',
          )}
        >
          其他（自行填寫）
        </button>
        {other && (
          <div className="mt-3">
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
          </div>
        )}
      </Card>

      {error && !other && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
