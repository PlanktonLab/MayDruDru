/** 規則判定卡（SPEC §8.2「規則 findings 卡（自動判定 + 人工覆寫 + 備註）」）。
 *
 * 每張卡只說事實：這條規則在哪份文件上抽到什麼值、對不對得上。
 * **不出現任何建議**——決策 D2／D3 把判斷留給承辦人，系統給的是證據不是結論。
 * 「定位」把 bbox 交回給文件檢視器畫框，「覆寫」寫一列 `source=reviewer` 的新判定。
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Crosshair, PenLine, UserCheck } from 'lucide-react'
import { Badge, Button, Card, Field, Modal, Select, Textarea, Input, cx } from '@maydru/ui'
import { FINDING_LABEL, FINDING_TONE, dateTime } from './labels'
import type { CaseFinding, FindingOverrideInput, ReviewRule } from './types'

export interface FindingsPanelProps {
  findings: CaseFinding[]
  rules: ReviewRule[]
  /** 由案件必備文件扣掉目前版本後得到，直接用人看得懂的文件名稱。 */
  missingDocuments?: string[]
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
  missingDocuments = [],
  focusedRuleCode,
  onLocate,
  onOverride,
  canReview,
}: FindingsPanelProps) {
  const [editing, setEditing] = useState<CaseFinding | null>(null)

  // 同一條規則可能有好幾列（auto 之後又被覆寫），契約已經把最新的排在前面。
  const latest = findings.filter((finding) => !finding.superseded)
  const ruleOf = (code: string) => rules.find((rule) => rule.code === code)
  const rows = latest.map((finding) => ({ finding, rule: ruleOf(finding.rule_code) }))
  const attention = rows.filter(
    ({ finding, rule }) =>
      rule?.required
      && finding.status !== 'MATCH'
      && !(missingDocuments.length > 0 && rule.rule_type === 'required_doc'),
  )
  const found = rows.filter(({ finding }) => finding.status === 'MATCH')
  const other = rows.filter(({ finding, rule }) => finding.status !== 'MATCH' && !rule?.required)

  const renderFinding = (
    { finding, rule }: (typeof rows)[number],
    tone: 'attention' | 'found' | 'other',
  ) => {
    const focused = focusedRuleCode === finding.rule_code
    const isFound = tone === 'found'
    return (
      <li
        key={finding.rule_code}
        className={cx(
          'rounded-xl border px-3 py-2.5 transition-colors',
          focused && 'ring-2 ring-accent/30',
          tone === 'attention' && 'border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20',
          tone === 'found' && 'border-emerald-200/80 bg-emerald-50/50 dark:bg-emerald-950/15',
          tone === 'other' && 'border-border bg-canvas',
        )}
      >
        <div className="flex items-start gap-2.5">
          {tone === 'attention' ? (
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
          ) : isFound ? (
            <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-600" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-primary">{rule?.label ?? finding.rule_code}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {finding.document_type_code || rule?.document_type_code || '不限文件'}
                  {rule?.required && ' · 核定必備'}
                </p>
              </div>
              <Badge tone={FINDING_TONE[finding.status]}>{FINDING_LABEL[finding.status]}</Badge>
            </div>

            {isFound ? (
              <p className="mt-2 break-all rounded-lg bg-white/70 px-2.5 py-2 text-[14px] font-medium text-primary dark:bg-black/10">
                {finding.extracted_value || '已確認'}
              </p>
            ) : (
              <p className="mt-1.5 text-[12.5px] leading-5 text-muted">
                {finding.note || (finding.status === 'MISMATCH' ? '內容與申請資料不一致，請人工確認。' : '尚未讀到可判定的內容。')}
              </p>
            )}

            {finding.expected_value && tone !== 'attention' && (
              <p className="mt-1 text-[11px] text-muted">比對對象：{finding.expected_value}</p>
            )}
            {finding.source === 'reviewer' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent">
                <UserCheck size={12} aria-hidden />
                {finding.reviewer?.name ?? '承辦人員'}於 {dateTime(finding.decided_at)} 覆寫
              </p>
            )}

            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                icon={<Crosshair size={13} />}
                disabled={!finding.bbox}
                onClick={() => onLocate(finding)}
              >
                看文件
              </Button>
              {canReview && (
                <Button size="sm" icon={<PenLine size={13} />} onClick={() => setEditing(finding)}>
                  人工確認
                </Button>
              )}
            </div>
          </div>
        </div>
      </li>
    )
  }

  return (
    <>
      <Card
        title="審核重點"
        subtitle={`規則判定依處理優先度排列 · ${attention.length + missingDocuments.length} 項待處理 · ${found.length} 項已讀取`}
      >
        {missingDocuments.length > 0 && (
          <section aria-labelledby="missing-documents-title" className="mb-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 dark:bg-rose-950/20">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                <AlertTriangle size={16} aria-hidden />
                <h3 id="missing-documents-title" className="text-[12px] font-semibold">缺少文件</h3>
              </div>
              <ul className="mt-2 space-y-1 pl-6 text-[13px] font-medium text-primary">
                {missingDocuments.map((label) => <li key={label}>• {label}</li>)}
              </ul>
            </div>
          </section>
        )}

        {attention.length > 0 && (
          <section aria-labelledby="attention-title">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="attention-title" className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
                優先處理：缺少或無法確認
              </h3>
              <span className="text-[11px] tabular-nums text-muted">{attention.length} 項</span>
            </div>
            <ul className="space-y-2">{attention.map((row) => renderFinding(row, 'attention'))}</ul>
          </section>
        )}

        {found.length > 0 && (
          <section aria-labelledby="found-title" className={attention.length || missingDocuments.length ? 'mt-4 border-t border-border pt-4' : ''}>
            <div className="mb-2 flex items-center justify-between">
              <h3 id="found-title" className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                已掃描到的資訊
              </h3>
              <span className="text-[11px] tabular-nums text-muted">{found.length} 項</span>
            </div>
            <ul className="space-y-2">{found.map((row) => renderFinding(row, 'found'))}</ul>
          </section>
        )}

        {other.length > 0 && (
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-[12px] font-medium text-muted">
              其他非必要檢查（{other.length}）
            </summary>
            <ul className="mt-2 space-y-2">{other.map((row) => renderFinding(row, 'other'))}</ul>
          </details>
        )}
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
