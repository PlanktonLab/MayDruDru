/** 第 2 步 身分：只問這次申請真的會用到的欄位（SPEC §11）。
 *
 * 手機與身分證只留末四碼的雜湊，所以身分證這裡就只收末四碼——問了全碼又不存，
 * 是在替自己製造一份不必要的個資。
 */

import { Check } from 'lucide-react'
import { Card, Field, Input, cx } from '@maydru/ui'
import type { SchemePublic } from '../lib/types'
import type { FieldErrors, Identity } from './state'

export interface IdentityStepProps {
  scheme: SchemePublic
  value: Identity
  onChange: (patch: Partial<Identity>) => void
  errors: FieldErrors
}

export function IdentityStep({ scheme, value, onChange, errors }: IdentityStepProps) {
  return (
    <div className="space-y-4">
      {/* 欄位不附說明文字：標籤本身已經說得夠清楚，每格底下再掛一行灰字，
          整頁的字量會比表單本身還多，反而讓人讀不到重點。只有電子郵件保留
          placeholder 說明用途——它是唯一「為什麼要問」不明顯的欄位。 */}
      <Card title="基本資料">
        {/* 桌面兩欄：這幾個欄位都短，一欄排下來會拉得很長，中間留一大片空白。
            手機仍是一欄——窄螢幕上兩欄會把每格擠到放不下一個完整的值。 */}
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="聯絡電話" required error={errors.phone}>
            {(props) => (
              <Input
                {...props}
                value={value.phone}
                onChange={(event) => onChange({ phone: event.target.value.replace(/\D/g, '').slice(0, 10) })}
                inputMode="numeric"
                autoComplete="tel"
              />
            )}
          </Field>
          <Field label="身分證字號末四碼" error={errors.id_last4}>
            {(props) => (
              <Input
                {...props}
                value={value.id_last4}
                onChange={(event) => onChange({ id_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                inputMode="numeric"
              />
            )}
          </Field>
          <Field label="電子郵件" error={errors.email}>
            {(props) => (
              <Input
                {...props}
                type="email"
                value={value.email}
                onChange={(event) => onChange({ email: event.target.value })}
                autoComplete="email"
                placeholder="用於案件通知"
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title="申請身分">
        {/* 單選題：左邊一個圓，選中是實心 accent 打勾、沒選是空心圈。
            圓圈畫在左邊而不是右邊，因為視線是從左往右讀，狀態要先於內容。
            兩個並排——身分別只有兩三個選項，排成一長串反而要多掃一次。 */}
        <fieldset role="radiogroup" aria-label="申請身分" className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">申請身分</legend>
          {scheme.tiers.map((tier) => {
            const selected = value.tier_code === tier.code
            return (
              <button
                key={tier.code}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ tier_code: tier.code })}
                className={cx(
                  'flex min-h-11 w-full items-center gap-3 rounded-xl border border-border bg-canvas p-3.5',
                  'text-left transition-colors hover:bg-background-lite',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-accent bg-accent text-on-accent' : 'border-tertiary bg-canvas text-transparent',
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="min-w-0 text-[15px] font-medium text-primary">{tier.label}</span>
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
