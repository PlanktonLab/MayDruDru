/** 第 4 步 準備指引（SPEC §8.1）。
 *
 * 在開相機之前先把「要哪幾份、每份要看得到什麼、去哪裡找」講完。
 * 每一份都掛一個「教我怎麼取得」連到 SOP（P4 接上真正的步驟卡）。
 */

import { ExternalLink, ShieldCheck } from 'lucide-react'
import { Card, Spinner } from '@maydru/ui'
import { sopHref } from './precheck'
import type { SchemeDocumentType, SchemePublic } from '../lib/types'

export interface GuideStepProps {
  scheme: SchemePublic
  /** 伺服器算出來的必備文件代碼，順序即顯示順序。 */
  requiredCodes: string[]
  loading?: boolean
}

export function documentTypesFor(scheme: SchemePublic, codes: string[]): SchemeDocumentType[] {
  const byCode = new Map(scheme.document_types.map((type) => [type.code, type]))
  return codes
    .map((code) => byCode.get(code))
    .filter((type): type is SchemeDocumentType => Boolean(type))
}

export function GuideStep({ scheme, requiredCodes, loading }: GuideStepProps) {
  const types = documentTypesFor(scheme, requiredCodes)

  if (loading) return <Spinner label="正在確認你要準備哪幾份文件…" />

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-primary">
        這次要準備 <strong className="tabular-nums">{types.length}</strong> 份文件。
      </p>

      <ol className="space-y-3">
        {types.map((type, index) => (
          <li key={type.code}>
            <Card
              title={
                <span className="flex items-baseline gap-2">
                  <span className="tabular-nums text-muted">{String(index + 1).padStart(2, '0')}</span>
                  {type.label}
                </span>
              }
              subtitle={type.hint}
            >
              {type.must_mask && (
                <p className="mb-2 flex items-start gap-2 text-[13px] leading-5 text-accent">
                  <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
                  上傳前會先在你的手機上遮罩，遮好才會送出。
                </p>
              )}
              <a
                href={sopHref(type.code)}
                className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-accent underline"
              >
                教我怎麼取得
                <ExternalLink size={14} aria-hidden />
              </a>
            </Card>
          </li>
        ))}
      </ol>

      {scheme.official_url && (
        <p className="text-[13px] leading-5 text-muted">
          完整簡章與規定請見{' '}
          <a href={scheme.official_url} target="_blank" rel="noreferrer" className="text-accent underline">
            計畫公告頁面
          </a>
          。有問題可洽 {scheme.contact}。
        </p>
      )}
    </div>
  )
}
