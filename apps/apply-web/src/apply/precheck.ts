/** 送出前的即時 precheck（SPEC §8.1 第 4 步）。
 *
 * 這裡的判定**不是最終判定**——伺服器會用 Python 版的同一組規則重跑一次，
 * 前端的結果只是為了讓市民在還站在文件旁邊的時候就知道要重拍（SPEC §8.1 第 5 步）。
 * 因此：FAIL 擋送出但留一個「請人工協助」逃生門，INDETERMINATE 一律放行。
 */

import { evaluate, precheck, type ApplicationFacts, type Finding, type OcrDocument } from '@maydru/review-rules'
import type { SchemePublic, SchemeRejectionCode, Verdict } from '../lib/types'
import { renderNote } from '../lib/reviewNotes'
import type { DocProblem } from './DocField'
import type { UploadedDoc } from './state'

/** SOP 教學頁的連結；P4 才會有真正的步驟卡，先把 document_type 帶過去。 */
export function sopHref(
  documentTypeCode: string | null | undefined,
  context: { scheme?: string; rejectionCode?: string } = {},
): string {
  if (!documentTypeCode) return '/sop'
  const params = new URLSearchParams({ document_type: documentTypeCode })
  if (context.scheme) params.set('scheme', context.scheme)
  if (context.rejectionCode) params.set('rejection_code', context.rejectionCode)
  return `/sop?${params.toString()}`
}

/** 規則的 `config.rejection_code` 指向 `rejection_codes` 的哪一筆。 */
export function rejectionForRule(scheme: SchemePublic, ruleCode: string): SchemeRejectionCode | undefined {
  const rule = scheme.review_rules.find((item) => item.code === ruleCode)
  const code = (rule?.config as { rejection_code?: unknown } | undefined)?.rejection_code
  if (typeof code !== 'string') return undefined
  return scheme.rejection_codes.find((item) => item.code === code)
}

export interface PrecheckView {
  verdict: Verdict
  findings: Finding[]
  /** 擋住送出的（required + error + MISMATCH）。 */
  blocking: Finding[]
  /** 放行但要標記的（多半是 UNREADABLE）。 */
  warnings: Finding[]
  /** 依 document_type_code 分組的「哪裡不對、怎麼修」。 */
  problemsByDoc: Record<string, DocProblem[]>
  /** 規則建議補的文件類型（`required_doc` 判 MISMATCH 時）。 */
  missingDocumentTypes: string[]
}

export function toProblem(scheme: SchemePublic, finding: Finding): DocProblem {
  const rejection = rejectionForRule(scheme, finding.rule_code)
  const rule = scheme.review_rules.find((item) => item.code === finding.rule_code)
  return {
    rule_code: finding.rule_code,
    what_wrong: rejection?.public_what_wrong ?? rule?.label ?? '這份文件還缺一項必要資訊',
    // 伺服器回的 note 是文案 key（`review.note.*`）；TS 版規則引擎回的是句子。
    how_to_fix:
      rejection?.public_how_to_fix ?? renderNote(finding.note) ?? '請依文件說明重新取得一份，再上傳一次。',
    sop_href: sopHref(finding.document_type_code ?? rule?.document_type_code ?? null),
  }
}

export interface PrecheckInput {
  scheme: SchemePublic
  docs: UploadedDoc[]
  facts: ApplicationFacts
}

export function runPrecheck({ scheme, docs, facts }: PrecheckInput): PrecheckView {
  const documents: OcrDocument[] = docs.map((doc) => ({
    document_type_code: doc.document_type_code,
    ocr: doc.ocr,
  }))
  const findings = evaluate(scheme.review_rules, documents, facts)
  const { verdict, blocking, warnings } = precheck(findings, scheme.review_rules)

  const problemsByDoc: Record<string, DocProblem[]> = {}
  for (const finding of blocking) {
    const rule = scheme.review_rules.find((item) => item.code === finding.rule_code)
    const key = finding.document_type_code ?? rule?.document_type_code ?? ''
    if (!key) continue
    ;(problemsByDoc[key] ??= []).push(toProblem(scheme, finding))
  }

  const missingDocumentTypes = [
    ...new Set(blocking.flatMap((finding) => finding.suggested_supplement ?? [])),
  ]

  return { verdict, findings, blocking, warnings, problemsByDoc, missingDocumentTypes }
}
