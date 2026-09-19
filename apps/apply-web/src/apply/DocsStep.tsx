/** 第 5 步 上傳（SPEC §8.1）。
 *
 * 一個 document_type 一張卡；每一張都自己跑完「讀檔 → 遮罩 → 辨識」。
 * 規則的即時判定結果由上層算好之後掛回對應的卡片上，市民不用捲到最後才知道哪份要重拍。
 *
 * 七、八份文件攤在同一頁會變成一面牆，所以再分成三段（身分／憑證／撥款），
 * 一次只看兩三張。分段純粹是呈現——過關條件仍然是「所有必備文件都齊了」，
 * 所以市民可以在段落之間來回，不必照順序填完。
 */

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cx } from '@maydru/ui'
import { DocField, type DocProblem } from './DocField'
import { documentTypesFor } from './GuideStep'
import { groupDocuments } from './docGroups'
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
  const groups = groupDocuments(types, docs)
  const [active, setActive] = useState(0)

  // 必備文件會隨繳費方式或身分別變動，分段數也跟著變；索引超出範圍就收回最後一段。
  useEffect(() => {
    if (active > groups.length - 1) setActive(Math.max(0, groups.length - 1))
  }, [active, groups.length])

  const current = groups[active]
  const nextGroup = groups[active + 1]

  return (
    <div className="space-y-4">
      {/* 分段指示：每一段標上「已傳幾份／共幾份」，點了可以直接跳過去。 */}
      {groups.length > 1 && (
        <nav aria-label="上傳分段" className="rounded-xl border border-border bg-canvas p-4">
          <ol className="flex items-center gap-1">
            {groups.map((group, index) => {
              const complete = group.done === group.types.length
              const isActive = index === active
              return (
                <li key={group.key} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
                  <button
                    type="button"
                    aria-current={isActive ? 'step' : undefined}
                    onClick={() => setActive(index)}
                    className="flex min-h-11 min-w-0 items-center gap-2 text-left"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        'flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums',
                        complete && !isActive && 'border-transparent bg-accent-bg text-accent',
                        isActive && 'border-accent bg-accent text-on-accent',
                        !complete && !isActive && 'border-border bg-canvas text-secondary',
                      )}
                    >
                      {complete && !isActive ? <Check size={13} strokeWidth={3} /> : String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cx(
                          'block truncate text-[13px]',
                          isActive ? 'font-semibold text-accent' : 'text-primary',
                        )}
                      >
                        {group.label}
                      </span>
                      <span className="block text-[12px] tabular-nums text-muted">
                        {group.done}/{group.types.length} 份
                      </span>
                    </span>
                  </button>
                  {index < groups.length - 1 && (
                    <span aria-hidden className="hidden h-px min-w-4 flex-1 bg-border sm:block" />
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      {/* 兩兩一排：這幾張卡片內容都短，一排一張在桌面會留下半頁空白。 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {current?.types.map((type) => (
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

      {/* 段落之間的移動；最後一段沒有下一段，交給整個流程的「下一步」。 */}
      {nextGroup && (
        <button
          type="button"
          onClick={() => {
            setActive(active + 1)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-canvas px-5 text-[16px] font-medium text-primary transition-colors hover:bg-background-lite"
        >
          下一段：{nextGroup.label}
        </button>
      )}
    </div>
  )
}
