import type { ReactNode } from 'react'
import { Card } from '@maydru/ui'

/** 一頁一個主要標題 + 一段說明，其餘內容放在下面（SPEC §15）。 */
export function Page({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <section className="md-risein">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{lead}</p>
      {children ? <div className="mt-6 space-y-4">{children}</div> : null}
    </section>
  )
}

/** P0 佔位卡片：說明這一段在哪個階段長出來，不放任何假資料。 */
export function Placeholder({ phase, items }: { phase: string; items: string[] }) {
  return (
    <Card subtitle={phase}>
      <ul className="space-y-2 text-[15px]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-tertiary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
