/** 送件流程的側欄摘要（桌面限定）。
 *
 * 桌面版有一整欄空間放不下的東西，最該放的是「我到目前為止填了什麼」——
 * 六步流程裡最容易讓人放棄的就是填到一半忘記前面選過什麼。手機沒有這欄，
 * 同一份資訊在最後的確認步驟完整出現一次（`ConfirmStep`），不重複佔畫面。
 *
 * 尚未填的欄位顯示「尚未填寫」而不是空白：空白看起來像壞掉，占位字看起來像待辦。
 */

import { money, date } from '../lib/format'
import type { SchemePublic } from '../lib/types'
import type { ApplyState } from './state'

const PENDING = '尚未填寫'

function Row({ label, value }: { label: string; value: string }) {
  const pending = value === PENDING
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className={`min-w-0 text-right text-[14px] ${pending ? 'text-secondary' : 'text-primary'}`}>{value}</dd>
    </div>
  )
}

export interface SummaryAsideProps {
  scheme: SchemePublic
  state: ApplyState
  requiredCodes: string[]
}

export function SummaryAside({ scheme, state, requiredCodes }: SummaryAsideProps) {
  const tier = scheme.tiers.find((item) => item.code === state.identity.tier_code)
  const channel = scheme.payment_channels.find((item) => item.code === state.channel.payment_channel_code)
  const amount = Number(state.channel.purchase_amount)
  // 預估金額只在金額與身分都齊了才算得出來；缺一個就先留白，不要秀一個會變的數字。
  const estimate =
    tier && Number.isFinite(amount) && amount > 0
      ? Math.min(Math.round(amount * tier.subsidy_rate), tier.cap_amount)
      : null
  const uploaded = requiredCodes.filter((code) => state.docs[code]).length

  return (
    <aside
      aria-label="申請摘要"
      className="apply-aside rounded-2xl border border-border bg-canvas p-6"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <h2 className="text-[15px] font-semibold tracking-tight text-primary">申請摘要</h2>

      <dl className="mt-5 space-y-4">
        <Row label="申請工具" value={state.tool.name || PENDING} />
        <Row label="申請人" value={state.identity.applicant_name || PENDING} />
        <Row label="申請身分" value={tier?.label ?? PENDING} />
        <Row label="繳費方式" value={channel?.label ?? PENDING} />
        <Row label="購買日期" value={state.channel.purchase_date ? date(state.channel.purchase_date) : PENDING} />
        <Row label="扣款金額" value={amount > 0 ? money(amount) : PENDING} />
        <Row
          label="上傳文件"
          value={requiredCodes.length > 0 ? `${uploaded} / ${requiredCodes.length} 份` : PENDING}
        />
      </dl>

      <div className="mt-6 rounded-2xl bg-background-lite p-5">
        <p className="text-[13px] text-muted">預估補助金額</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-primary">
          {estimate != null ? money(estimate) : '—'}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-muted">實際金額以承辦人員審核結果為準。</p>
      </div>
    </aside>
  )
}
