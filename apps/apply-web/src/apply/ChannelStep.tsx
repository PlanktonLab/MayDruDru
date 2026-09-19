/** 第 3 步 繳費管道與購買資訊（SPEC §8.1）。
 *
 * 繳費管道決定下一步要準備哪幾份憑證，所以它排在「準備指引」前面；
 * 金額以**帳單上實際扣款的臺幣**為準，這是退件率最高的一欄（見 FAQ `faq_billing`）。
 */

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Card, Field, FlatSelect, Input, cx } from '@maydru/ui'
import type { FlatSelectOption } from '@maydru/ui'
import type { SchemePublic } from '../lib/types'
import type { ChannelInfo, FieldErrors } from './state'

/** 卡片標題帶必填星號；`Card` 的 title 收 ReactNode，所以直接塞一個小元件。 */
function RequiredTitle({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {children}
      <span className="text-danger" aria-label="必填">
        *
      </span>
    </span>
  )
}

/** 單選卡片：左邊一個圓，選中是實心 accent 打勾、未選是空心圈。 */
function RadioCard({
  selected,
  onClick,
  title,
  hint,
  example,
}: {
  selected: boolean
  onClick: () => void
  title: string
  hint?: string
  example?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        'flex min-h-11 w-full items-start gap-3 rounded-xl border border-border bg-canvas p-3.5',
        'text-left transition-colors hover:bg-background-lite',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent bg-accent text-on-accent' : 'border-tertiary bg-canvas text-transparent',
        )}
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-primary">{title}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-5 text-muted">{hint}</span>}
        {example && <span className="mt-0.5 block text-[12px] leading-5 text-secondary">{example}</span>}
      </span>
    </button>
  )
}

const PAYERS = [
  { proxy: false, label: '本人支付' },
  { proxy: true, label: '父母、配偶或法定代理人代為支付' },
] as const

const CYCLES = [
  { value: 'MONTHLY', label: '月費', hint: '按月扣款' },
  { value: 'ANNUAL', label: '年費', hint: '按年一次付清' },
] as const

/** 1–12 期。超過一年的訂閱不在本計畫範圍，所以不給更多選項。 */
const PERIODS: FlatSelectOption[] = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1} 個月（${index + 1} 期）`,
}))

const CURRENCIES: FlatSelectOption[] = [
  { value: 'USD', label: 'USD 美元 ($)' },
  { value: 'TWD', label: 'TWD 新臺幣 (NT$)' },
  { value: 'EUR', label: 'EUR 歐元 (€)' },
  { value: 'JPY', label: 'JPY 日圓 (¥)' },
  { value: 'GBP', label: 'GBP 英鎊 (£)' },
  { value: 'OTHER', label: '其他幣別' },
]

const SYMBOLS: Record<string, string> = {
  USD: '$',
  TWD: 'NT$',
  EUR: '€',
  JPY: '¥',
  GBP: '£',
}

function symbolOf(currency: string): string {
  return SYMBOLS[currency] ?? ''
}

export interface ChannelStepProps {
  scheme: SchemePublic
  value: ChannelInfo
  onChange: (patch: Partial<ChannelInfo>) => void
  errors: FieldErrors
}

export function ChannelStep({ scheme, value, onChange, errors }: ChannelStepProps) {
  return (
    <div className="space-y-4">
      <Card title={<RequiredTitle>繳費方式</RequiredTitle>}>
        {/* 與申請身分同一種單選樣式：左邊圓圈，選中是實心 accent 打勾。
            每個管道講「這是什麼」與「例如哪些」，不講「要準備哪幾份」——
            文件清單由伺服器依管道算出來，在下一步的準備指引完整列一次。 */}
        <fieldset role="radiogroup" aria-label="繳費方式" className="space-y-2">
          <legend className="sr-only">繳費方式</legend>
          {scheme.payment_channels.map((channel) => (
            <RadioCard
              key={channel.code}
              selected={value.payment_channel_code === channel.code}
              onClick={() => onChange({ payment_channel_code: channel.code })}
              title={channel.label}
              hint={channel.hint}
              example={channel.example}
            />
          ))}
        </fieldset>
        {errors.payment_channel_code && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {errors.payment_channel_code}
          </p>
        )}
      </Card>

      <Card title={<RequiredTitle>付款人</RequiredTitle>}>
        {/* 本人／代為支付是單選題，不是一個「要不要勾」的開關：
            兩個選項並排講清楚，比一句否定句的 checkbox 好讀。 */}
        <fieldset role="radiogroup" aria-label="付款人" className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">付款人</legend>
          {PAYERS.map((payer) => (
            <RadioCard
              key={payer.label}
              selected={value.paid_by_proxy === payer.proxy}
              onClick={() => onChange({ paid_by_proxy: payer.proxy })}
              title={payer.label}
            />
          ))}
        </fieldset>
      </Card>

      <Card title="訂閱與費用明細">
        <div className="space-y-4">
          <Field label="繳費制度" required>
            {() => (
              <fieldset role="radiogroup" aria-label="繳費制度" className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">繳費制度</legend>
                {CYCLES.map((cycle) => (
                  <RadioCard
                    key={cycle.value}
                    selected={value.billing_cycle === cycle.value}
                    onClick={() =>
                      // 年費就是一次付清，期數固定一期，不該讓人再選一次。
                      onChange({
                        billing_cycle: cycle.value,
                        billing_periods: cycle.value === 'ANNUAL' ? 1 : value.billing_periods,
                      })
                    }
                    title={cycle.label}
                    hint={cycle.hint}
                  />
                ))}
              </fieldset>
            )}
          </Field>

          {value.billing_cycle === 'MONTHLY' && (
            <Field
              label="申請期數（月份數）"
              required
              hint="請依欲申請補助的訂閱月份數選擇（需檢附每期憑證）"
            >
              {(props) => (
                <FlatSelect
                  id={props.id}
                  aria-describedby={props['aria-describedby']}
                  value={String(value.billing_periods)}
                  options={PERIODS}
                  onChange={(next) => onChange({ billing_periods: Number(next) })}
                />
              )}
            </Field>
          )}

          <Field
            label="購買日期"
            required
            error={errors.purchase_date}
            hint="請填寫購買、扣款成功或收據上的日期"
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                value={value.purchase_date}
                min={scheme.application_start ?? undefined}
                onChange={(event) => onChange({ purchase_date: event.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="原始幣別" required>
              {(props) => (
                <FlatSelect
                  id={props.id}
                  value={value.original_currency}
                  options={CURRENCIES}
                  onChange={(next) => onChange({ original_currency: next })}
                />
              )}
            </Field>
            {value.original_currency !== 'TWD' && (
              <Field
                label={`原始費用（${value.original_currency} ${symbolOf(value.original_currency)}）`}
                required
                error={errors.original_amount}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={value.original_amount}
                    onChange={(event) => onChange({ original_amount: event.target.value.replace(/[^\d.]/g, '') })}
                    inputMode="decimal"
                    placeholder={symbolOf(value.original_currency)}
                  />
                )}
              </Field>
            )}
          </div>

          <Field
            label="換算台幣費用"
            required
            error={errors.purchase_amount}
            hint="以信用卡帳單或扣款明細上實際扣款的臺幣金額為準"
          >
            {(props) => (
              <Input
                {...props}
                value={value.purchase_amount}
                onChange={(event) => onChange({ purchase_amount: event.target.value.replace(/[^\d.]/g, '') })}
                inputMode="decimal"
              />
            )}
          </Field>
        </div>
      </Card>
    </div>
  )
}
