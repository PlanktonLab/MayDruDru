/** 第 5 步 上傳（SPEC §8.1）。
 *
 * 一個 document_type 一張卡；每一張都自己跑完「讀檔 → 遮罩 → 辨識」。
 * 規則的即時判定結果由上層算好之後掛回對應的卡片上，市民不用捲到最後才知道哪份要重拍。
 */

import { Card } from '@maydru/ui'
import { DocField, type DocProblem } from './DocField'
import { documentTypesFor } from './GuideStep'
import type { SchemePublic } from '../lib/types'
import type { UploadedDoc } from './state'

export interface DocsStepProps {
  scheme: SchemePublic
  requiredCodes: string[]
  docs: Record<string, UploadedDoc>
  onDoc: (code: string, doc: UploadedDoc) => void
  onClear: (code: string) => void
  problemsByDoc: Record<string, DocProblem[]>
}

export function DocsStep({ scheme, requiredCodes, docs, onDoc, onClear, problemsByDoc }: DocsStepProps) {
  const types = documentTypesFor(scheme, requiredCodes)
  const done = types.filter((type) => docs[type.code]).length

  return (
    <div className="space-y-4">
      <Card padded={false} className="px-4 py-3">
        <p className="text-[15px] text-primary">
          已上傳 <strong className="tabular-nums">{done}</strong> / {types.length} 份
        </p>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          照片會在這支手機上縮圖、遮罩、辨識完才上傳。原圖不會離開瀏覽器。
        </p>
      </Card>

      {types.map((type) => (
        <DocField
          key={type.code}
          docType={type}
          value={docs[type.code]}
          required
          problems={problemsByDoc[type.code] ?? []}
          onChange={(doc) => onDoc(type.code, doc)}
          onClear={() => onClear(type.code)}
        />
      ))}
    </div>
  )
}
