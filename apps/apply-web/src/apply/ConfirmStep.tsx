/** 第 6 步 確認並送出（SPEC §8.1、§11）。
 *
 * 三件事要在按下「送出」**之前**說清楚（SPEC §15.6 信任）：遮罩做了什麼、
 * 文件保存多久、證明文件不會送 AI。說在事後就只是免責聲明，不是設計。
 */

import { AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card, Checkbox } from '@maydru/ui'
import { money, date } from '../lib/format'
import { documentTypesFor } from './GuideStep'
import { toProblem } from './precheck'
import type { PrecheckView } from './precheck'
import type { SchemePublic } from '../lib/types'
import type { ApplyState } from './state'

export interface ConfirmStepProps {
  scheme: SchemePublic
  state: ApplyState
  requiredCodes: string[]
  view: PrecheckView | null
  onManualAssist: (value: boolean) => void
  onSubmit: () => void
  submitting: boolean
  error?: string
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] text-primary">{value}</dd>
    </div>
  )
}

export function ConfirmStep({
  scheme,
  state,
  requiredCodes,
  view,
  onManualAssist,
  onSubmit,
  submitting,
  error,
}: ConfirmStepProps) {
  const tier = scheme.tiers.find((item) => item.code === state.identity.tier_code)
  const channel = scheme.payment_channels.find((item) => item.code === state.channel.payment_channel_code)
  const types = documentTypesFor(scheme, requiredCodes)
  const amount = Number(state.channel.purchase_amount)
  const estimate = tier ? Math.min(Math.round(amount * tier.subsidy_rate), tier.cap_amount) : null

  const blocked = view?.verdict === 'FAIL' && !state.manualAssist
  const warnings = view?.warnings ?? []

  return (
    <div className="space-y-4">
      <Card title="申請內容">
        <dl className="divide-y divide-border">
          <Row label="補助方案" value={scheme.name} />
          <Row label="工具" value={state.tool.name} />
          <Row label="申請人" value={state.identity.applicant_name} />
          <Row label="手機" value={state.identity.phone} />
          <Row label="申請身分" value={tier?.label ?? '—'} />
          <Row label="繳費方式" value={channel?.label ?? '—'} />
          {state.channel.paid_by_proxy && <Row label="付款人" value="由他人代為支付" />}
          <Row label="購買日期" value={date(state.channel.purchase_date)} />
          <Row label="實際扣款金額" value={money(amount)} />
          {estimate != null && <Row label="預估可補助" value={money(estimate)} />}
          <Row label="上傳文件" value={`${types.filter((type) => state.docs[type.code]).length} 份`} />
        </dl>
      </Card>

      {view && view.verdict !== 'PASS' && (
        <Card
          title={view.verdict === 'FAIL' ? '有文件需要先處理' : '有幾處系統看不清楚'}
          subtitle={
            view.verdict === 'FAIL'
              ? '下面這幾項在送出前修好，可以少一次補件。'
              : '這幾項不擋送出，承辦人員會再看一次。'
          }
        >
          <ul className="space-y-2">
            {(view.verdict === 'FAIL' ? view.blocking : warnings).map((finding) => {
              const problem = toProblem(scheme, finding)
              return (
                <li key={finding.rule_code} className="rounded-xl bg-background-lite px-3 py-2.5 text-[13px] leading-5">
                  <p className="font-medium text-primary">{problem.what_wrong}</p>
                  <p className="mt-1 text-muted">{problem.how_to_fix}</p>
                  <a className="mt-1.5 inline-flex min-h-11 items-center text-accent underline" href={problem.sop_href}>
                    教我怎麼取得
                  </a>
                </li>
              )
            })}
          </ul>

          {view.verdict === 'FAIL' && (
            <div className="mt-3 border-t border-border pt-3">
              <Checkbox
                checked={state.manualAssist}
                onChange={(event) => onManualAssist(event.target.checked)}
                label="我確認文件沒問題，請人工協助審核"
                description="勾選後仍可送出，由承辦人員人工檢視。若確實缺件，還是會被要求補件。"
              />
            </div>
          )}
        </Card>
      )}

      <Card title="送出前請先知道" subtitle="這三件事會在你按下送出之後立刻發生。">
        <ul className="space-y-2.5 text-[14px] leading-6">
          <li className="flex gap-2">
            <ShieldCheck size={16} aria-hidden className="mt-1 shrink-0 text-good" />
            <span>
              需要遮罩的文件已經在這支手機上遮好，上傳的是<strong>遮罩後</strong>的影像；原圖從未離開瀏覽器。
            </span>
          </li>
          <li className="flex gap-2">
            <Info size={16} aria-hidden className="mt-1 shrink-0 text-accent" />
            <span>
              證明文件<strong>不會</strong>送給任何 AI 服務。文字辨識也是在你的手機上跑完的。
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle size={16} aria-hidden className="mt-1 shrink-0 text-warn" />
            <span>案件結案後，上傳的證明文件會依規定期限自動刪除，並保留案件編號與狀態供稽核。</span>
          </li>
        </ul>
      </Card>

      {error && (
        <p role="alert" className="text-[14px] leading-6 text-danger">
          {error}
        </p>
      )}

      {blocked && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Badge tone="danger">尚未通過檢查</Badge>
          修好上面的問題，或勾選「請人工協助審核」之後就能送出。
        </p>
      )}

      <Button variant="primary" size="lg" block loading={submitting} disabled={blocked} onClick={onSubmit}>
        送出申請
      </Button>
    </div>
  )
}
