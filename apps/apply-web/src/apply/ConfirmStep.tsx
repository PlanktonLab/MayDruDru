/** 第 6 步 確認並送出（SPEC §8.1、§11）。
 *
 * 三件事要在按下「送出」**之前**說清楚（SPEC §15.6 信任）：遮罩做了什麼、
 * 文件保存多久、證明文件不會送 AI。說在事後就只是免責聲明，不是設計。
 */

import { AlertTriangle, Check, Info, LifeBuoy, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card } from '@maydru/ui'
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

      {/* 三種判定的樣子刻意不同：PASS 安靜地確認一句就好；INDETERMINATE 是中性的說明，
          不能長得像錯誤（它不擋送出）；FAIL 才用紅色，而且每一條都要說「怎麼修」＋教學連結。 */}
      {view?.verdict === 'PASS' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-background-lite p-4">
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
          >
            <Check size={13} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-accent">文件看起來沒問題</p>
            <p className="mt-1 text-[13px] leading-relaxed text-accent">該有的資訊都找得到，可以送出了。</p>
          </div>
        </div>
      )}

      {view?.verdict === 'INDETERMINATE' && (
        <div className="rounded-xl border border-border bg-background-lite p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={17} aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-primary">有一部分系統看不太懂</p>
              <p className="mt-1 text-[13px] font-medium leading-relaxed text-primary">
                這不影響你送出，也不用重做——承辦人員會親自看一眼。
              </p>
              <ul className="mt-2.5 space-y-2">
                {warnings.map((finding) => {
                  const problem = toProblem(scheme, finding)
                  return (
                    <li key={finding.rule_code} className="rounded-xl bg-canvas px-3 py-2.5 text-[13px] leading-5">
                      <p className="font-medium text-primary">{problem.what_wrong}</p>
                      <p className="mt-1 text-muted">{problem.how_to_fix}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {view?.verdict === 'FAIL' && (
        <>
          <div className="rounded-xl border border-danger/30 bg-danger-bg p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={17} aria-hidden className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-danger">請先確認以下文件問題</p>
                <p className="mt-1 text-[13px] leading-relaxed text-danger">修正後即可重新檢查，可以少一次補件。</p>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {view.blocking.map((finding) => {
                const problem = toProblem(scheme, finding)
                return (
                  <li
                    key={finding.rule_code}
                    className="rounded-xl border border-danger/20 bg-canvas p-3 text-[13px] leading-5"
                  >
                    <p className="font-semibold text-primary">{problem.what_wrong}</p>
                    <p className="mt-0.5 text-muted">{problem.how_to_fix}</p>
                    <a className="mt-1.5 inline-flex min-h-11 items-center text-accent underline" href={problem.sop_href}>
                      教我怎麼取得
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* 人工出口是必備而非選配：我們窮舉不了全世界的帳單格式，
              沒有出口的人會困在無限 FAIL，最後還是打電話——回到要消滅的那個循環。 */}
          {!state.manualAssist && (
            <button
              type="button"
              onClick={() => onManualAssist(true)}
              className="flex w-full items-start gap-2 rounded-xl border border-border bg-canvas p-3.5 text-left transition-colors hover:bg-background-lite"
            >
              <LifeBuoy size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-primary">
                  我的文件格式比較特殊，需要人工協助
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
                  如果你確定文件沒問題、是系統看不懂，可以直接送出。承辦人員會人工檢視，
                  不會因為系統不認得就退件。
                </span>
              </span>
            </button>
          )}
        </>
      )}

      {state.manualAssist && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-bg p-3.5">
          <LifeBuoy size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-accent">
            已標記為<span className="font-semibold">需人工檢視</span>
            。承辦人員會直接看你上傳的文件，不會因為系統判讀不出來而退件。
          </p>
        </div>
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
