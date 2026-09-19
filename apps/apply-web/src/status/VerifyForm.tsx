/** 案件查詢的第二因子（SPEC §8.1「查詢驗證」、決策 D17）。
 *
 * 只問末四碼，不再要一次完整個資。連續失敗 5 次鎖 15 分鐘；被鎖的時候要說**還要等多久**，
 * 不然市民只會一直重按。查無此案與末四碼錯誤的訊息刻意一致——回應不一致就等於
 * 把查詢介面變成掃號工具（D17）。
 */

import { useState, type FormEvent } from 'react'
import { Button, Card, Field, Input } from '@maydru/ui'
import { ApiError } from '../lib/api'
import { duration } from '../lib/format'
import { caseToken } from '../lib/api'
import { verifyCase } from '../lib/queries'

export const MISMATCH_MESSAGE = '案件編號或末四碼不正確。請對照送件後的截圖再輸入一次。'

export function lockoutMessage(seconds: number): string {
  return `嘗試次數太多，已暫時鎖定。請在 ${duration(seconds)} 後再試一次；若忘記編號，請洽承辦單位協助查詢。`
}

export interface VerifyFormProps {
  /** 預填的案件編號（從送件成功頁點進來時會有）。 */
  initialCaseNo?: string
  onVerified: (caseNo: string) => void
}

export function VerifyForm({ initialCaseNo = '', onVerified }: VerifyFormProps) {
  const [caseNo, setCaseNo] = useState(initialCaseNo)
  const [last4, setLast4] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!caseNo.trim()) {
      setError('請輸入案件編號，例如 HC-2026-900001。')
      return
    }
    if (!/^\d{4}$/.test(last4.trim())) {
      setError('末四碼請填 4 位數字，手機或身分證的都可以。')
      return
    }
    setBusy(true)
    try {
      const result = await verifyCase(caseNo.trim().toUpperCase(), last4.trim())
      caseToken.set(result.token)
      onVerified(result.case_no)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'LOCKED') {
        const seconds = Number((cause.body as { retry_after_seconds?: number } | null)?.retry_after_seconds ?? 900)
        setError(lockoutMessage(seconds))
      } else if (cause instanceof ApiError && cause.status === 401) {
        setError(MISMATCH_MESSAGE)
      } else {
        setError(cause instanceof Error ? cause.message : MISMATCH_MESSAGE)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="查詢案件進度" subtitle="輸入送件後拿到的編號，加上當時填的手機或身分證末四碼。">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="案件編號" required hint="格式像 HC-2026-900001，在送件成功頁上。">
          {(props) => (
            <Input
              {...props}
              value={caseNo}
              onChange={(event) => setCaseNo(event.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              placeholder="HC-2026-900001"
            />
          )}
        </Field>
        <Field label="手機或身分證末四碼" required hint="只需要最後 4 位數字。">
          {(props) => (
            <Input
              {...props}
              value={last4}
              onChange={(event) => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="1234"
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="text-[13px] leading-5 text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          查詢
        </Button>
      </form>
    </Card>
  )
}
