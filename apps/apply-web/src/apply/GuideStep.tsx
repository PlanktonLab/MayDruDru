/** 第 4 步 準備申請文件（SPEC §8.1）。
 *
 * 在開相機之前先把「去哪裡找、找到之後要看得到什麼」講完——這一步只講取得方式，
 * 逐份文件的清單留給下一步的上傳畫面，那裡本來就一份一張卡。
 */

import { useState } from 'react'
import { ChevronDown, Eye } from 'lucide-react'
import { Spinner, cx } from '@maydru/ui'
import { guideFor, type ChannelGuide } from './channelGuides'
import type { SchemeDocumentType, SchemePublic } from '../lib/types'

export interface GuideStepProps {
  scheme: SchemePublic
  /** 伺服器算出來的必備文件代碼，順序即顯示順序。 */
  requiredCodes: string[]
  /** 目前選的繳費管道；教學依它分流。 */
  channelCode?: string
  loading?: boolean
}

/**
 * 繳費管道的取件教學。
 *
 * 桌面把步驟與「送出前確認」並排：有足夠寬度時同時看得到兩者，對照更直接；
 * 手機是「讀完步驟 → 往下對照」，所以疊起來。預設展開——這一步存在的理由
 * 就是讀它，收起來等於沒有。
 */
function ChannelGuideCard({ guide }: { guide: ChannelGuide }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background-lite">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-[14px] font-semibold text-accent">{guide.title}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cx('shrink-0 text-accent transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 lg:flex lg:gap-5">
          <ol className="space-y-2.5 lg:min-w-0 lg:flex-1">
            {guide.steps.map((step, index) => (
              <li key={step.text} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-relaxed text-primary">{step.text}</span>
                  {step.tip && (
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{step.tip}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-3 lg:mt-0 lg:min-w-0 lg:flex-1">
            {guide.mustShow.length > 0 && (
              <div className="rounded-xl border border-border bg-canvas px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                  <Eye size={12} aria-hidden className="text-accent" />
                  送出前，確認這些都看得到
                </p>
                <ul className="mt-1.5 space-y-1">
                  {guide.mustShow.map((item) => (
                    <li key={item} className="flex items-start gap-1.5 text-[12.5px] leading-5 text-muted">
                      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 合格範例圖：民眾是在對照，不是在閱讀。一張標好必要欄位的圖
                比整段文字有效得多（原專案 PRD-1 F2.2）。 */}
            <figure className="mt-3">
              <img
                src={guide.sampleImage}
                alt={guide.sampleCaption}
                className="block w-full rounded-xl border border-border bg-canvas"
              />
              <figcaption className="mt-1.5 text-[11.5px] leading-5 text-muted">{guide.sampleCaption}</figcaption>
            </figure>
          </div>
        </div>
      )}
    </div>
  )
}

export function documentTypesFor(scheme: SchemePublic, codes: string[]): SchemeDocumentType[] {
  const byCode = new Map(scheme.document_types.map((type) => [type.code, type]))
  return codes
    .map((code) => byCode.get(code))
    .filter((type): type is SchemeDocumentType => Boolean(type))
}

export function GuideStep({ channelCode = '', loading }: GuideStepProps) {
  const guide = guideFor(channelCode)

  if (loading) return <Spinner label="正在確認你要準備哪幾份文件…" />

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-muted">請依照付款方式準備帳單，並確認必要欄位清楚可見。</p>

      {/* 依繳費方式分流的取件教學：四種管道要找的東西完全不同，
          講「一般性的準備方式」等於每個人都得自己翻譯一次。 */}
      {guide && <ChannelGuideCard guide={guide} />}

      {/* 逐份文件的清單不列在這裡：下一步的上傳畫面本來就一份一張卡，
          在這裡先列一次只是同一份資訊讀兩遍。這一步專心講「怎麼取得」。
          簡章連結與聯絡方式也不放——「說明」分頁就是為這件事存在的。 */}
    </div>
  )
}
