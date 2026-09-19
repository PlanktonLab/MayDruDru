/** 決策列（SPEC §8.2「依角色顯示可用轉移」、§7 狀態機）。
 *
 * 按鈕全部來自 `allowed_transitions`——後端已經濾掉這位承辦沒有能力做的轉移，
 * 前端不自己推算誰能按什麼。T3（核定）在 `approval_blockers` 非空時停用，
 * 而且把擋住的規則列出來：停用而不說原因，只會讓人以為系統壞了。
 */

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Textarea } from '@maydru/ui'
import { deadlineFromToday } from './labels'
import type {
  AllowedTransition,
  ApprovalBlocker,
  DocumentTypeOption,
  RejectionCodeOption,
  SupplementItem,
  TransitionInput,
} from './types'

export const APPROVE_CODE = 'T3'
export const SUPPLEMENT_CODE = 'T2'

export interface DecisionBarProps {
  transitions: AllowedTransition[]
  blockers: ApprovalBlocker[]
  rejectionCodes: RejectionCodeOption[]
  documentTypes: DocumentTypeOption[]
  supplementDays: number
  onSubmit: (input: TransitionInput) => Promise<void>
}

export function DecisionBar({
  transitions,
  blockers,
  rejectionCodes,
  documentTypes,
  supplementDays,
  onSubmit,
}: DecisionBarProps) {
  const [active, setActive] = useState<AllowedTransition | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (input: TransitionInput) => {
    setBusy(true)
    setError('')
    try {
      await onSubmit(input)
      setActive(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '這個動作沒有完成，請再試一次。')
    } finally {
      setBusy(false)
    }
  }

  // 只有在「核定」真的按得到的時候才解釋為什麼按不下去。案件已經在補件或已結案時
  // 再列一次擋住核定的規則，只是在講一件現在不相干的事。
  const blocked = blockers.length > 0 && transitions.some((t) => t.code === APPROVE_CODE)

  return (
    <Card title="決策" subtitle="每一次轉移都會寫一筆事件，無法刪改。">
      {transitions.length === 0 ? (
        <p className="text-[13px] text-muted">以你目前的權限，這件案子沒有可以執行的動作。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => {
            const disabled = transition.code === APPROVE_CODE && blocked
            return (
              <Button
                key={transition.code}
                variant={transition.code === APPROVE_CODE ? 'primary' : 'secondary'}
                disabled={disabled}
                loading={busy && active?.code === transition.code}
                onClick={() => {
                  setError('')
                  if (transition.needs_reason || transition.needs_rejection_codes || transition.needs_supplement_items)
                    setActive(transition)
                  else void run({ code: transition.code })
                }}
              >
                {transition.label}
              </Button>
            )
          })}
        </div>
      )}

      {blocked && (
        <div className="mt-3 rounded-xl bg-warn-bg px-3 py-2.5 text-[13px] leading-5">
          <p className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle size={14} aria-hidden />
            還不能核定：有 {blockers.length} 條必備規則尚未判定為「符合」
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {blockers.map((blocker) => (
              <li key={blocker.rule_code} className="flex items-center gap-2">
                <Badge tone="warn">{blocker.rule_code}</Badge>
                <span className="text-muted">{blocker.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {active?.needs_supplement_items && (
        <SupplementModal
          transition={active}
          rejectionCodes={rejectionCodes}
          documentTypes={documentTypes}
          supplementDays={supplementDays}
          busy={busy}
          error={error}
          onClose={() => setActive(null)}
          onSubmit={run}
        />
      )}

      {active && !active.needs_supplement_items && (
        <ReasonModal
          transition={active}
          rejectionCodes={rejectionCodes}
          busy={busy}
          error={error}
          onClose={() => setActive(null)}
          onSubmit={run}
        />
      )}
    </Card>
  )
}

interface DraftItem extends SupplementItem {
  checked: boolean
}

function SupplementModal({
  transition,
  rejectionCodes,
  documentTypes,
  supplementDays,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  transition: AllowedTransition
  rejectionCodes: RejectionCodeOption[]
  documentTypes: DocumentTypeOption[]
  supplementDays: number
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (input: TransitionInput) => Promise<void>
}) {
  const [items, setItems] = useState<DraftItem[]>(() =>
    documentTypes.map((type) => ({
      document_type_code: type.code,
      rejection_code: rejectionCodes[0]?.code ?? 'OTHER',
      note: '',
      checked: false,
    })),
  )
  const [deadline, setDeadline] = useState(() => deadlineFromToday(supplementDays))
  const [localError, setLocalError] = useState('')

  const selected = items.filter((item) => item.checked)

  const patch = (code: string, next: Partial<DraftItem>) =>
    setItems((current) =>
      current.map((item) => (item.document_type_code === code ? { ...item, ...next } : item)),
    )

  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title={transition.label}
      subtitle="勾選要補的文件，每一份都要選一個退件原因；市民看到的是那個原因的公開說明。"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              if (selected.length === 0) {
                setLocalError('請至少勾選一份要補的文件。')
                return
              }
              setLocalError('')
              void onSubmit({
                code: transition.code,
                supplement_items: selected.map(({ checked: _checked, ...item }) => item),
                supplement_deadline: deadline,
                rejection_codes: [...new Set(selected.map((item) => item.rejection_code))],
              })
            }}
          >
            送出補件要求
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="補件期限" hint={`預設今天 + ${supplementDays} 天；逾期案件會自動結案。`}>
          {(props) => (
            <Input {...props} type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          )}
        </Field>

        {items.length === 0 && (
          // 一份都列不出來時要說清楚，否則按鈕只會回一句「請至少勾選一份」卻沒得勾。
          <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-[13px] leading-5 text-warn">
            這件案子的方案還沒有設定必要文件，沒有可以要求補件的項目。請先到方案管理補上文件類型。
          </p>
        )}

        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.document_type_code} className="rounded-xl border border-border p-3">
              <Checkbox
                checked={item.checked}
                onChange={(event) => patch(item.document_type_code, { checked: event.target.checked })}
                label={documentTypes.find((type) => type.code === item.document_type_code)?.label ?? item.document_type_code}
              />
              {item.checked && (
                <div className="mt-2 space-y-2 pl-9">
                  <Field label="退件原因">
                    {(props) => (
                      <Select
                        {...props}
                        value={item.rejection_code}
                        onChange={(event) => patch(item.document_type_code, { rejection_code: event.target.value })}
                      >
                        {rejectionCodes.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.staff_label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="補充說明" hint="會直接顯示給市民，請寫「怎麼修」。">
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={2}
                        value={item.note}
                        onChange={(event) => patch(item.document_type_code, { note: event.target.value })}
                        placeholder={
                          rejectionCodes.find((option) => option.code === item.rejection_code)?.public_how_to_fix ?? ''
                        }
                      />
                    )}
                  </Field>
                </div>
              )}
            </li>
          ))}
        </ul>

        {(localError || error) && (
          <p role="alert" className="text-[13px] text-danger">
            {localError || error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function ReasonModal({
  transition,
  rejectionCodes,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  transition: AllowedTransition
  rejectionCodes: RejectionCodeOption[]
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (input: TransitionInput) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [localError, setLocalError] = useState('')

  return (
    <Modal
      open
      onClose={onClose}
      title={transition.label}
      subtitle="理由會留在事件紀錄裡，並作為通知市民的依據。"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              if (transition.needs_reason && !reason.trim()) {
                setLocalError('請填寫理由。')
                return
              }
              if (transition.needs_rejection_codes && codes.length === 0) {
                setLocalError('請至少選一個退件原因。')
                return
              }
              setLocalError('')
              void onSubmit({
                code: transition.code,
                reason: reason.trim() || undefined,
                rejection_codes: codes.length ? codes : undefined,
              })
            }}
          >
            確認{transition.label}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {transition.needs_rejection_codes && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-[13px] font-medium text-muted">退件原因（可複選）</legend>
            {rejectionCodes.map((option) => (
              <Checkbox
                key={option.code}
                checked={codes.includes(option.code)}
                onChange={(event) =>
                  setCodes((current) =>
                    event.target.checked
                      ? [...current, option.code]
                      : current.filter((code) => code !== option.code),
                  )
                }
                label={option.staff_label}
                description={option.public_what_wrong}
              />
            ))}
          </fieldset>
        )}
        <Field label="理由" required={transition.needs_reason}>
          {(props) => (
            <Textarea {...props} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </Field>
        {(localError || error) && (
          <p role="alert" className="text-[13px] text-danger">
            {localError || error}
          </p>
        )}
      </div>
    </Modal>
  )
}
