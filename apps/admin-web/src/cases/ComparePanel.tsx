/** 比對面板（SPEC §8.2「申請金額 vs 辨識金額」）。
 *
 * 只把兩個數字與容差並排放好，差額算給你看。它不說「建議退件」——
 * 容差之外未必是造假，可能只是帳單上有匯差或手續費，那是承辦要看的事。
 */

import { Card } from '@maydru/ui'
import { Badge } from '@maydru/ui'
import { money } from './labels'
import type { CaseFinding, ReviewRule } from './types'

export interface ToleranceConfig {
  source_rule_code?: string
  tolerance_pct?: number
  tolerance_abs?: number
}

export interface CompareResult {
  claimed: number | null
  extracted: number | null
  difference: number | null
  /** 容差說明；沒有 amount_tolerance 規則時是 null。 */
  toleranceNote: string | null
  within: boolean | null
}

function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/[^\d.-]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function compareAmounts(
  claimed: number | null,
  findings: CaseFinding[],
  rules: ReviewRule[],
): CompareResult {
  const toleranceRule = rules.find((rule) => rule.rule_type === 'amount_tolerance')
  const config = (toleranceRule?.config ?? {}) as ToleranceConfig
  const sourceCode = config.source_rule_code
  const source = findings.find((finding) => finding.rule_code === sourceCode && !finding.superseded)
  const extracted = parseAmount(source?.extracted_value)
  const difference = claimed != null && extracted != null ? Math.abs(claimed - extracted) : null

  // `tolerance_pct` 是百分比（5 = 5%），而且與 `tolerance_abs` 是 **且** 的關係——
  // 逐字對齊 `@maydru/review-rules` 的 `withinTolerance()` 與 services/review.py。
  const pct = config.tolerance_pct
  const abs = config.tolerance_abs
  const toleranceNote =
    toleranceRule && (pct != null || abs != null)
      ? `容差：${pct != null ? `${pct}%` : '—'} 以內，且不超過 ${abs != null ? money(abs) : '—'}。`
      : null

  let within: boolean | null = null
  if (difference != null && claimed != null && pct != null && abs != null) {
    within = claimed !== 0 && difference / Math.abs(claimed) <= pct / 100 && difference <= abs
  }

  return { claimed, extracted, difference, toleranceNote, within }
}

export function ComparePanel({
  claimed,
  findings,
  rules,
}: {
  claimed: number | null
  findings: CaseFinding[]
  rules: ReviewRule[]
}) {
  const result = compareAmounts(claimed, findings, rules)

  return (
    <Card title="金額比對" subtitle="申報金額與憑證上抽到的金額。">
      <dl className="space-y-1.5 text-[14px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">申報金額</dt>
          <dd className="tabular-nums text-primary">{money(result.claimed)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">憑證辨識金額</dt>
          <dd className="tabular-nums text-primary">
            {result.extracted == null ? '無法辨識' : money(result.extracted)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">差額</dt>
          <dd className="flex items-center gap-2 tabular-nums text-primary">
            {result.difference == null ? '—' : money(result.difference)}
            {result.within === true && <Badge tone="good">在容差內</Badge>}
            {result.within === false && <Badge tone="danger">超出容差</Badge>}
          </dd>
        </div>
      </dl>
      {result.toleranceNote && <p className="mt-2 text-[12px] leading-5 text-muted">{result.toleranceNote}</p>}
    </Card>
  )
}
