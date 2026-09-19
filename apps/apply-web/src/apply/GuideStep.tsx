/** 第 4 步 準備指引（SPEC §8.1）。
 *
 * 在開相機之前先把「要哪幾份、每份要看得到什麼、去哪裡找」講完。
 * 每一份都掛一個「教我怎麼取得」連到 SOP（P4 接上真正的步驟卡）。
 */

import { useState } from 'react'
import { ChevronDown, ExternalLink, Eye, ShieldCheck } from 'lucide-react'
import { Card, Spinner, cx } from '@maydru/ui'
import { sopHref } from './precheck'
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

          {guide.mustShow.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-canvas px-3 py-2.5 lg:mt-0 lg:min-w-0 lg:flex-1">
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

export function GuideStep({ scheme, requiredCodes, channelCode = '', loading }: GuideStepProps) {
  const types = documentTypesFor(scheme, requiredCodes)
  const guide = guideFor(channelCode)

  if (loading) return <Spinner label="正在確認你要準備哪幾份文件…" />

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-muted">請依照付款方式準備帳單，並確認必要欄位清楚可見。</p>

      {/* 依繳費方式分流的取件教學：四種管道要找的東西完全不同，
          講「一般性的準備方式」等於每個人都得自己翻譯一次。 */}
      {guide && <ChannelGuideCard guide={guide} />}

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
