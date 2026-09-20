/** 第 6 步 確認並送出（SPEC §8.1、§11）。
 *
 * 三件事要在按下「送出」**之前**說清楚（SPEC §15.6 信任）：遮罩做了什麼、
 * 文件保存多久、證明文件不會送 AI。說在事後就只是免責聲明，不是設計。
 */

import { AlertTriangle, Check, LifeBuoy } from 'lucide-react'
import { Badge, Card } from '@maydru/ui'
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
  error,
}: ConfirmStepProps) {
  const tier = scheme.tiers.find((item) => item.code === state.identity.tier_code)
  const channel = scheme.payment_channels.find((item) => item.code === state.channel.payment_channel_code)
  const types = documentTypesFor(scheme, requiredCodes)
  const amount = Number(state.channel.purchase_amount)
  const estimate = tier ? Math.min(Math.round(amount * tier.subsidy_rate), tier.cap_amount) : null

  const blocked = view?.verdict === 'FAIL' && !state.manualAssist

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
          {estimate != null && <Row label="最高補助金額" value={money(estimate)} />}
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

      {/* INDETERMINATE 不出聲：它不擋送出，而且市民也做不了什麼——
          承辦人員會親自看一眼，講出來只是讓人在送出前多一次不安。 */}

      {view?.verdict === 'FAIL' && (
        <>
          <div className="rounded-xl border border-warn/30 bg-warn-bg p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={17} aria-hidden className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-warn">OCR 可能沒找到以下資料</p>
                <p className="mt-1 text-[13px] leading-relaxed text-warn">這只是前端初審提示，辨識可能不準確；你可以換檔，或確認原圖有資料後忽略提示繼續送出。</p>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {view.blocking.map((finding) => {
                const problem = toProblem(scheme, finding)
                return (
                  <li
                    key={finding.rule_code}
                    className="rounded-xl border border-warn/20 bg-canvas p-3 text-[13px] leading-5"
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
                  忽略 OCR 提示，繼續送出
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
                  如果你已確認原圖包含需要的欄位，可以繼續下一步。承辦人員仍會人工檢視，
                  不會把這次前端辨識當成最終判定。
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
            已忽略前端 OCR 提示並標記為<span className="font-semibold">需人工檢視</span>
            。承辦人員會直接看你上傳的文件，不會只依前端辨識結果退件。
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[14px] leading-6 text-danger">
          {error}
        </p>
      )}

      {blocked && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Badge tone="warn">等待你的確認</Badge>
          換一份文件，或按「忽略 OCR 提示，繼續送出」。
        </p>
      )}

      {/* 「送出申請」畫在 `ApplyPage` 的導覽列，與「上一步」同一排——
          跟其他步驟的主要動作位置一致。 */}
    </div>
  )
}
