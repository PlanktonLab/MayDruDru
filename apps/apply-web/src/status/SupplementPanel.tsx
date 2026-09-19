/** 補件面板（SPEC §8.1「補件」）。
 *
 * **只顯示 `supplement_items` 列出的文件類型**——其他已經通過的文件不要再讓人傳一次，
 * 那是把審核的成本轉嫁給民眾。每一項都附退件原因的「哪裡不對／怎麼修」與 SOP 連結。
 */

import { useCallback, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button, Card, Spinner } from '@maydru/ui'
import { DocField } from '../apply/DocField'
import { sopHref } from '../apply/precheck'
import { date } from '../lib/format'
import { submitSupplement } from '../lib/queries'
import type { UploadedDoc } from '../apply/state'
import type { CasePublic, SchemePublic } from '../lib/types'

export interface SupplementPanelProps {
  caseData: CasePublic
  scheme: SchemePublic | undefined
  onDone: () => void
}

export function SupplementPanel({ caseData, scheme, onDone }: SupplementPanelProps) {
  const [docs, setDocs] = useState<Record<string, UploadedDoc>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const items = caseData.supplement_items
  const codes = items.map((item) => item.document_type_code)
  const ready = codes.every((code) => docs[code])

  const send = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      await submitSupplement(
        caseData.case_no,
        codes
          .map((code) => docs[code])
          .filter(Boolean)
          .map((doc) => ({
            document_type_code: doc.document_type_code,
            masked: doc.masked,
            mime: doc.mime,
            page_count: doc.page_count,
            ocr: doc.ocr,
            blob: doc.blob,
            fileName: `${doc.document_type_code}.jpg`,
          })),
      )
      setDocs({})
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '補件沒有送出去，請再試一次。')
    } finally {
      setBusy(false)
    }
  }, [caseData.case_no, codes, docs, onDone])

  if (!scheme) return <Spinner label="載入文件說明…" />

  return (
    <section aria-labelledby="supplement-heading" className="space-y-4">
      <div>
        <h2 id="supplement-heading" className="text-[17px] font-semibold tracking-tight">
          要補的文件（{items.length} 份）
        </h2>
        {caseData.supplement_deadline && (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-warn">
            <CalendarClock size={14} aria-hidden />
            請在 {date(caseData.supplement_deadline)} 前補齊，逾期案件會自動結案。
          </p>
        )}
        <p className="mt-1 text-[13px] leading-5 text-muted">
          只需要重傳下面這幾份。審核順序仍依第一次送件的時間，不會重新排隊。
        </p>
      </div>

      {items.map((item) => {
        const type = scheme.document_types.find((entry) => entry.code === item.document_type_code)
        const rejection = scheme.rejection_codes.find((entry) => entry.code === item.rejection_code)
        if (!type) return null
        return (
          <div key={item.document_type_code} className="space-y-2">
            <Card className="border-warn/40 bg-warn-bg/40" padded>
              <p className="text-[14px] font-medium text-primary">
                {rejection?.public_what_wrong ?? '這份文件需要重新提供'}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                {item.note || rejection?.public_how_to_fix || '請依承辦說明重新取得一份再上傳。'}
              </p>
              <a
                className="mt-1.5 inline-flex min-h-11 items-center text-[14px] text-accent underline"
                href={sopHref(item.document_type_code, {
                  scheme: caseData.scheme.code,
                  rejectionCode: item.rejection_code,
                })}
              >
                教我怎麼取得
              </a>
            </Card>
            <DocField
              docType={type}
              required
              value={docs[item.document_type_code]}
              onChange={(doc) => setDocs((current) => ({ ...current, [item.document_type_code]: doc }))}
              onClear={() =>
                setDocs((current) => {
                  const next = { ...current }
                  delete next[item.document_type_code]
                  return next
                })
              }
            />
          </div>
        )
      })}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <Button variant="primary" size="lg" block loading={busy} disabled={!ready} onClick={() => void send()}>
        送出補件
      </Button>
      {!ready && (
        <p className="text-[13px] text-muted">上面每一份都上傳之後才能送出。</p>
      )}
    </section>
  )
}
