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
import { ArrowRight, Check } from 'lucide-react'
import { Button, cx } from '@maydru/ui'
import { DocField, type DocProblem } from './DocField'
import { documentTypesFor } from './GuideStep'
import { expandSlots, groupDocuments } from './docGroups'
import type { SchemePublic } from '../lib/types'
import type { UploadedDoc } from './state'

export interface DocsStepProps {
  scheme: SchemePublic
  requiredCodes: string[]
  docs: Record<string, UploadedDoc>
  onDoc: (code: string, doc: UploadedDoc) => void
  onClear: (code: string) => void
  problemsByDoc: Record<string, DocProblem[]>
  /** 申請補助的期數；多期時收據與繳款憑證每期各要一份。 */
  periods?: number
  /** 最後一段填齊、按下「下一步」時離開整個上傳步驟。 */
  onDone: () => void
}

export function DocsStep({
  scheme,
  requiredCodes,
  docs,
  onDoc,
  onClear,
  problemsByDoc,
  periods = 1,
  onDone,
}: DocsStepProps) {
  const types = documentTypesFor(scheme, requiredCodes)
  // 申請多期時，收據與繳款憑證會展開成每期一份。
  const slots = expandSlots(types, periods)
  const groups = groupDocuments(slots, docs)
  const [active, setActive] = useState(0)

  // 必備文件會隨繳費方式或身分別變動，分段數也跟著變；索引超出範圍就收回最後一段。
  useEffect(() => {
    if (active > groups.length - 1) setActive(Math.max(0, groups.length - 1))
  }, [active, groups.length])

  const current = groups[active]
  const nextGroup = groups[active + 1]
  // 這一段還有沒傳的就不讓走——一次只檢查眼前這幾份，而不是把八份的缺漏一起丟出來。
  const currentIncomplete = (current?.done ?? 0) < (current?.slots.length ?? 0)

  return (
    <div className="space-y-4">
      {/* 分段指示只顯示進度，不能點著跳——每一段都得填齊才走得到下一段，
          能跳的話等於繞過那道檢查，人會一路跳到最後才發現前面都沒填。 */}
      {groups.length > 1 && (
        <nav aria-label="上傳分段" className="rounded-xl border border-border bg-canvas p-4">
          <ol className="flex items-center gap-1">
            {groups.map((group, index) => {
              const complete = group.done === group.slots.length
              const isActive = index === active
              return (
                <li key={group.key} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
                  <span className="flex min-w-0 items-center gap-2">
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
                        aria-current={isActive ? 'step' : undefined}
                        className={cx(
                          'block truncate text-[13px]',
                          isActive ? 'font-semibold text-accent' : 'text-primary',
                        )}
                      >
                        {group.label}
                      </span>
                      <span className="block text-[12px] tabular-nums text-muted">
                        {group.done}/{group.slots.length} 份
                      </span>
                    </span>
                  </span>
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
        {current?.slots.map((slot) => (
          <DocField
            key={slot.key}
            docType={slot.type}
            label={slot.label}
            value={docs[slot.key]}
            required
            problems={problemsByDoc[slot.key] ?? problemsByDoc[slot.code] ?? []}
            onChange={(doc) => onDoc(slot.key, doc)}
            onClear={() => onClear(slot.key)}
          />
        ))}
      </div>

      {/* 整個上傳步驟只有這一顆「下一步」：在段落之間時它走到下一段，
          在最後一段時它離開上傳步驟。這一段沒填齊就 disable——
          按不下去比按了才被擋更誠實。 */}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={currentIncomplete}
        onClick={() => {
          if (nextGroup) {
            setActive(active + 1)
            window.scrollTo({ top: 0, behavior: 'smooth' })
            return
          }
          onDone()
        }}
      >
        {nextGroup ? `下一步：${nextGroup.label}` : '下一步'}
        <ArrowRight size={16} aria-hidden />
      </Button>
    </div>
  )
}
