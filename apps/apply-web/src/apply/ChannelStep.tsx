/** 第 3 步 繳費管道與購買資訊（SPEC §8.1）。
 *
 * 繳費管道決定下一步要準備哪幾份憑證，所以它排在「準備指引」前面；
 * 金額以**帳單上實際扣款的臺幣**為準，這是退件率最高的一欄（見 FAQ `faq_billing`）。
 */

import { Check } from 'lucide-react'
import { Card, Checkbox, Field, Input, cx } from '@maydru/ui'
import type { SchemePublic } from '../lib/types'
import type { ChannelInfo, FieldErrors } from './state'

export interface ChannelStepProps {
  scheme: SchemePublic
  value: ChannelInfo
  onChange: (patch: Partial<ChannelInfo>) => void
  errors: FieldErrors
}

export function ChannelStep({ scheme, value, onChange, errors }: ChannelStepProps) {
  const labelOf = (code: string) =>
    scheme.document_types.find((type) => type.code === code)?.label ?? code

  return (
    <div className="space-y-4">
      <Card title="繳費方式" subtitle="選你實際刷卡／扣款的方式，選錯會要求補件。">
        {/* 與申請身分同一種單選樣式：左邊圓圈，選中是實心 accent 打勾。 */}
        <fieldset role="radiogroup" aria-label="繳費方式" className="space-y-2">
          <legend className="sr-only">繳費方式</legend>
          {scheme.payment_channels.map((channel) => {
            const selected = value.payment_channel_code === channel.code
            return (
              <button
                key={channel.code}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ payment_channel_code: channel.code })}
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
                  <span className="block text-[15px] font-medium text-primary">{channel.label}</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-muted">
                    需要：{channel.required_document_type_codes.map(labelOf).join('、') || '依方案規定'}
                  </span>
                  {channel.hint && (
                    <span className="mt-0.5 block text-[13px] leading-5 text-muted">{channel.hint}</span>
                  )}
                </span>
              </button>
            )
          })}
        </fieldset>
        {errors.payment_channel_code && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {errors.payment_channel_code}
          </p>
        )}
      </Card>

      <Card title="付款人">
        <Checkbox
          checked={value.paid_by_proxy}
          onChange={(event) => onChange({ paid_by_proxy: event.target.checked })}
          label="這筆錢是由父母、配偶或法定代理人代為支付"
          description="勾選後會多一份「代為支付切結書」要上傳。"
        />
      </Card>

      <Card title="購買資訊" subtitle="以帳單上實際扣款的那一筆為準。">
        <div className="space-y-4">
          <Field label="購買（扣款）日期" required error={errors.purchase_date}>
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
          <Field
            label="實際扣款臺幣金額"
            required
            error={errors.purchase_amount}
            hint="外幣訂閱請填帳單上換算後的臺幣金額，不要填美金。"
          >
            {(props) => (
              <Input
                {...props}
                value={value.purchase_amount}
                onChange={(event) => onChange({ purchase_amount: event.target.value.replace(/[^\d.]/g, '') })}
                inputMode="decimal"
                placeholder="6000"
              />
            )}
          </Field>
        </div>
      </Card>
    </div>
  )
}
