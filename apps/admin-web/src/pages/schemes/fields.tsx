/**
 * 方案設定表單的欄位元件（SPEC §15：一致、可及）。
 *
 * 每一張子設定表的欄位都不一樣，所以表單是**由欄位規格生出來的**，不是每張表各寫
 * 一份 JSX。規格就在各自的分頁檔裡，看得到欄位名、標籤與提示三件事排在一起。
 */

import type { ReactNode } from 'react'
import { Field, Input, Select, Textarea } from '../../components/ui'
import { TagInput } from '../../components/admin/TagInput'

export interface Option { value: string; label: string }

export type FieldSpec = {
  name: string
  label: string
  hint?: string
  /** 空白就擋下來，並說明哪一欄沒填。 */
  required?: boolean
  /** 佔滿整列（說明、提示這種長文字）。 */
  wide?: boolean
} & (
  | { kind: 'text' | 'textarea' | 'date' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'bool' }
  | { kind: 'tags' }
  | { kind: 'select'; options: Option[] }
  | { kind: 'multi'; options: Option[] }
)

export type FormValues = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** 少了哪些必填欄位。回傳的是標籤而不是欄位名——訊息是給人看的。 */
export function missingFields(specs: FieldSpec[], values: FormValues): string[] {
  return specs
    .filter((f) => f.required && !str(values[f.name]).trim() && !list(values[f.name]).length)
    .map((f) => f.label)
}

export function FieldInput({ spec, value, onChange, disabled }: {
  spec: FieldSpec
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  const id = `field-${spec.name}`
  if (spec.kind === 'bool') {
    return (
      <label className="flex items-center gap-2 py-1.5 text-sm" htmlFor={id}>
        <input id={id} type="checkbox" checked={!!value} disabled={disabled}
               onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border" />
        <span>{spec.label}</span>
        {spec.hint && <span className="text-[11px] text-secondary">{spec.hint}</span>}
      </label>
    )
  }
  const body = (() => {
    switch (spec.kind) {
      case 'textarea':
        return <Textarea id={id} rows={3} value={str(value)} disabled={disabled}
                         onChange={(e) => onChange(e.target.value)} />
      case 'number':
        return <Input id={id} type="number" min={spec.min} max={spec.max} step={spec.step ?? 1}
                      value={str(value)} disabled={disabled}
                      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      case 'date':
        return <Input id={id} type="date" value={str(value)} disabled={disabled}
                      onChange={(e) => onChange(e.target.value || null)} />
      case 'tags':
        return <TagInput value={list(value)} onChange={onChange} disabled={disabled} />
      case 'select':
        return (
          <Select id={id} value={str(value)} disabled={disabled} className="w-full"
                  onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )
      case 'multi':
        return <CheckboxList name={spec.name} options={spec.options} value={list(value)}
                             onChange={onChange} disabled={disabled} />
      default:
        return <Input id={id} value={str(value)} disabled={disabled}
                      onChange={(e) => onChange(e.target.value)} />
    }
  })()
  return <Field label={spec.label} hint={spec.hint}>{body}</Field>
}

/**
 * 多選用一排核取方塊，不用 `<select multiple>`：後者在觸控裝置上幾乎按不到，
 * 而且看不見「總共有哪些選項」——這裡的選項就是這個方案自己的文件類型代碼，
 * 承辦人員需要一眼看完。
 */
export function CheckboxList({ name, options, value, onChange, disabled }: {
  name: string
  options: Option[]
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}) {
  if (!options.length) return <div className="text-[11px] text-secondary">還沒有可以選的項目</div>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
            className="h-4 w-4 rounded border-border"
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

/** 表單本體：兩欄網格，`wide` 的欄位佔滿一整列。 */
export function FieldGrid({ specs, values, onChange, disabled, children }: {
  specs: FieldSpec[]
  values: FormValues
  onChange: (name: string, v: unknown) => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {specs.map((spec) => (
        <div key={spec.name} className={spec.wide || spec.kind === 'multi' ? 'sm:col-span-2' : undefined}>
          <FieldInput spec={spec} value={values[spec.name]} onChange={(v) => onChange(spec.name, v)} disabled={disabled} />
        </div>
      ))}
      {children}
    </div>
  )
}
