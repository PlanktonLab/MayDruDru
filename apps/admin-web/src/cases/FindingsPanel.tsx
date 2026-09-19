/** 規則判定卡（SPEC §8.2「規則 findings 卡（自動判定 + 人工覆寫 + 備註）」）。
 *
 * 每張卡只說事實：這條規則在哪份文件上抽到什麼值、對不對得上。
 * **不出現任何建議**——決策 D2／D3 把判斷留給承辦人，系統給的是證據不是結論。
 * 「定位」把 bbox 交回給文件檢視器畫框，「覆寫」寫一列 `source=reviewer` 的新判定。
 */

import { useState } from 'react'
import { Crosshair, PenLine, UserCheck } from 'lucide-react'
import { Badge, Button, Card, Field, Modal, Select, Textarea, Input, cx } from '@maydru/ui'
import { FINDING_LABEL, FINDING_TONE, dateTime } from './labels'
import type { CaseFinding, FindingOverrideInput, ReviewRule } from './types'

export interface FindingsPanelProps {
  findings: CaseFinding[]
  rules: ReviewRule[]
  /** 目前被「定位」選中的規則代碼。 */
  focusedRuleCode: string | null
  onLocate: (finding: CaseFinding) => void
  onOverride: (ruleCode: string, body: FindingOverrideInput) => Promise<void>
  /** 沒有 case_review 能力時只能看。 */
  canReview: boolean
}

const OVERRIDE_OPTIONS: FindingOverrideInput['status'][] = ['MATCH', 'MISMATCH', 'UNREADABLE']

export function FindingsPanel({
  findings,
  rules,
  focusedRuleCode,
  onLocate,
  onOverride,
  canReview,
}: FindingsPanelProps) {
  const [editing, setEditing] = useState<CaseFinding | null>(null)

  // 同一條規則可能有好幾列（auto 之後又被覆寫），契約已經把最新的排在前面。
  const latest = findings.filter((finding) => !finding.superseded)
  const ruleOf = (code: string) => rules.find((rule) => rule.code === code)

  return (
    <>
      <Card title="規則判定" subtitle="系統只列出抽到的值與比對結果，核定與否由你判斷。">
        <ul className="space-y-2">
          {latest.map((finding) => {
            const rule = ruleOf(finding.rule_code)
            const focused = focusedRuleCode === finding.rule_code
            return (
              <li
                key={finding.rule_code}
                className={cx(
                  'rounded-xl border p-3',
                  focused ? 'border-accent bg-accent-bg/40' : 'border-border bg-canvas',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-primary">{rule?.label ?? finding.rule_code}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {finding.document_type_code || '不限文件'}
                      {rule?.required && ' · 核定必備'}
                    </p>
                  </div>
                  <Badge tone={FINDING_TONE[finding.status]}>{FINDING_LABEL[finding.status]}</Badge>
                </div>

                <dl className="mt-2 space-y-1 text-[13px]">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted">抽到的值</dt>
                    <dd className="min-w-0 break-all text-primary">{finding.extracted_value ?? '—'}</dd>
                  </div>
                  {finding.expected_value && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">比對對象</dt>
                      <dd className="min-w-0 break-all text-primary">{finding.expected_value}</dd>
                    </div>
                  )}
                  {finding.confidence != null && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">辨識信心</dt>
                      <dd className="tabular-nums text-primary">{finding.confidence}</dd>
                    </div>
                  )}
                </dl>

                {finding.note && <p className="mt-2 text-[13px] leading-5 text-muted">{finding.note}</p>}

                {finding.source === 'reviewer' && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-accent">
                    <UserCheck size={13} aria-hidden />
                    由 {finding.reviewer?.name ?? '承辦人員'} 於 {dateTime(finding.decided_at)} 覆寫
                  </p>
                )}

                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    icon={<Crosshair size={13} />}
                    disabled={!finding.bbox}
                    onClick={() => onLocate(finding)}
                  >
                    定位
                  </Button>
                  {canReview && (
                    <Button size="sm" icon={<PenLine size={13} />} onClick={() => setEditing(finding)}>
                      覆寫
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {latest.length === 0 && <p className="text-[13px] text-muted">這件案子還沒有規則判定結果。</p>}
      </Card>

      {editing && (
        <OverrideModal
          finding={editing}
          label={ruleOf(editing.rule_code)?.label ?? editing.rule_code}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            await onOverride(editing.rule_code, body)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function OverrideModal({
  finding,
  label,
  onClose,
  onSubmit,
}: {
  finding: CaseFinding
  label: string
  onClose: () => void
  onSubmit: (body: FindingOverrideInput) => Promise<void>
}) {
  const [status, setStatus] = useState<FindingOverrideInput['status']>(
    finding.status === 'PENDING' ? 'MATCH' : (finding.status as FindingOverrideInput['status']),
  )
  const [value, setValue] = useState(finding.extracted_value ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <Modal
      open
      onClose={onClose}
      title={`覆寫判定：${label}`}
      subtitle="覆寫會另寫一列紀錄，自動判定保留在歷程裡。"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onSubmit({ status, extracted_value: value || undefined, note: note || undefined })
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '覆寫沒有寫入，請再試一次。')
              } finally {
                setBusy(false)
              }
            }}
          >
            儲存覆寫
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="判定">
          {(props) => (
            <Select
              {...props}
              value={status}
              onChange={(event) => setStatus(event.target.value as FindingOverrideInput['status'])}
            >
              {OVERRIDE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {FINDING_LABEL[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="更正後的值" hint="留空表示沿用系統抽到的值。">
          {(props) => <Input {...props} value={value} onChange={(event) => setValue(event.target.value)} />}
        </Field>
        <Field label="備註" hint="寫給下一位看這件案子的人；會留在稽核紀錄裡。">
          {(props) => <Textarea {...props} value={note} onChange={(event) => setNote(event.target.value)} rows={3} />}
        </Field>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
