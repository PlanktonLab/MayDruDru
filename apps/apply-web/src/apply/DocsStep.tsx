/** 第 5 步 上傳（SPEC §8.1）。
 *
 * 一個 document_type 一張卡；每一張都自己跑完「讀檔 → 遮罩 → 辨識」。
 * 規則的即時判定結果由上層算好之後掛回對應的卡片上，市民不用捲到最後才知道哪份要重拍。
 *
 * 七、八份文件攤在同一頁會變成一面牆，所以再分成三段（身分／憑證／撥款），
 * 一次只看兩三張。分段純粹是呈現——過關條件仍然是「所有必備文件都齊了」，
 * 所以市民可以在段落之間來回，不必照順序填完。
 */

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cx } from '@maydru/ui'
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
  /** 目前這一段的狀態；上層用它決定「下一步」的字與能不能按。 */
  onNavChange?: (nav: DocsNav) => void
}

/** 上傳步驟的導覽狀態。按鈕由上層與「上一步」排在同一列，這裡只負責算內容。 */
export interface DocsNav {
  /** 按鈕上的字；還有下一段時帶著段落名。 */
  label: string
  /** 當段沒填齊就不能走。 */
  disabled: boolean
  /** 按下去要做的事：走到下一段，或走完整個步驟（上層接手）。 */
  advance: () => void
  /** 已經在最後一段——上層據此知道這次 advance 會離開這一步。 */
  onLastGroup: boolean
}

export function DocsStep({
  scheme,
  requiredCodes,
  docs,
  onDoc,
  onClear,
  problemsByDoc,
  periods = 1,
  onNavChange,
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

  /**
   * 把「下一步」的內容交給上層，讓它與「上一步」排在同一列——按鈕畫在這裡的話
   * 會卡在面板內容中間，跟其他步驟的位置對不齊。
   *
   * 相依只放**原始值**：`groups` 每次 render 都是新陣列，把它（或從它取出的
   * `nextGroup` 物件）放進相依陣列，effect 就每次都跑、上層每次都 setState，
   * 兩邊互相觸發成無限迴圈。`advance` 用 `useCallback` 固定住，理由相同。
   */
  const hasNext = Boolean(nextGroup)
  const nextLabel = nextGroup?.label ?? ''

  const advance = useCallback(() => {
    setActive((index) => index + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    onNavChange?.({
      label: hasNext ? `下一步：${nextLabel}` : '下一步',
      disabled: currentIncomplete,
      onLastGroup: !hasNext,
      advance,
    })
  }, [onNavChange, hasNext, nextLabel, currentIncomplete, advance])

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

    </div>
  )
}
