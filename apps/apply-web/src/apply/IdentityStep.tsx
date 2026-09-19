/** 第 2 步 身分：只問這次申請真的會用到的欄位（SPEC §11）。
 *
 * 手機與身分證只留末四碼的雜湊，所以身分證這裡就只收末四碼——問了全碼又不存，
 * 是在替自己製造一份不必要的個資。
 */

import { Check } from 'lucide-react'
import { Card, Field, Input, cx } from '@maydru/ui'
import type { SchemePublic } from '../lib/types'
import type { FieldErrors, Identity } from './state'
import { money } from '../lib/format'

export interface IdentityStepProps {
  scheme: SchemePublic
  value: Identity
  onChange: (patch: Partial<Identity>) => void
  errors: FieldErrors
}

export function IdentityStep({ scheme, value, onChange, errors }: IdentityStepProps) {
  return (
    <div className="space-y-4">
      <Card title="基本資料" subtitle="請填寫與身分證相同的姓名，方便承辦核對。">
        <div className="space-y-4">
          <Field label="姓名" required error={errors.applicant_name}>
            {(props) => (
              <Input
                {...props}
                value={value.applicant_name}
                onChange={(event) => onChange({ applicant_name: event.target.value })}
                autoComplete="name"
              />
            )}
          </Field>
          <Field
            label="手機號碼"
            required
            error={errors.phone}
            hint="查詢進度時會用到末四碼。系統只保留末四碼的雜湊值。"
          >
            {(props) => (
              <Input
                {...props}
                value={value.phone}
                onChange={(event) => onChange({ phone: event.target.value.replace(/\D/g, '').slice(0, 10) })}
                inputMode="numeric"
                autoComplete="tel"
                placeholder="0912345678"
              />
            )}
          </Field>
          <Field
            label="身分證字號末四碼"
            error={errors.id_last4}
            hint="可不填。填了之後查詢進度時兩種末四碼都能用。"
          >
            {(props) => (
              <Input
                {...props}
                value={value.id_last4}
                onChange={(event) => onChange({ id_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                inputMode="numeric"
                placeholder="1234"
              />
            )}
          </Field>
          <Field label="電子信箱" error={errors.email} hint="可不填。通知以 LINE 為主。">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={value.email}
                onChange={(event) => onChange({ email: event.target.value })}
                autoComplete="email"
                placeholder="name@example.com"
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title="申請身分" subtitle={scheme.amount_note}>
        <fieldset className="space-y-2">
          <legend className="sr-only">申請身分</legend>
          {scheme.tiers.map((tier) => {
            const selected = value.tier_code === tier.code
            return (
              <button
                key={tier.code}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ tier_code: tier.code })}
                className={cx(
                  'relative flex min-h-11 w-full flex-col items-start rounded-xl border p-3.5 pr-10 text-left transition-colors',
                  selected
                    ? 'border-accent bg-accent-bg'
                    : 'border-border bg-canvas hover:border-accent/40 hover:bg-background-lite',
                )}
              >
                {selected && (
                  <span
                    aria-hidden
                    className="absolute right-3.5 top-3.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <span className="text-[15px] font-medium text-primary">{tier.label}</span>
                <span className="mt-0.5 text-[13px] text-muted">
                  補助 {Math.round(tier.subsidy_rate * 100)}%，上限 {money(tier.cap_amount)}
                  {tier.required_proof_doc_types.length > 0 && '（需另附證明文件）'}
                </span>
              </button>
            )
          })}
        </fieldset>
        {errors.tier_code && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {errors.tier_code}
          </p>
        )}
      </Card>
    </div>
  )
}
