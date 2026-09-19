/** `/help` — 常見問題（SPEC §8.1）。
 *
 * 先用伺服器的關鍵字搜尋，同時在前端再過濾一次：弱網路下伺服器還沒回來時，
 * 已經載進來的那批也要能立刻縮小範圍，不能讓人對著轉圈的畫面等。
 */

import { useMemo, useState } from 'react'
import { HelpCircle, Search } from 'lucide-react'
import { Card, EmptyState, Field, Input, Spinner } from '@maydru/ui'
import { useFaqs } from '../lib/queries'
import type { Faq } from '../lib/types'

export function matchesFaq(faq: Faq, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    faq.question.toLowerCase().includes(needle) ||
    faq.answer.toLowerCase().includes(needle) ||
    faq.category.toLowerCase().includes(needle)
  )
}

export default function HelpPage() {
  const [query, setQuery] = useState('')
  const faqsQuery = useFaqs(query)
  const faqs = useMemo(() => (faqsQuery.data ?? []).filter((faq) => matchesFaq(faq, query)), [faqsQuery.data, query])

  return (
    <section className="md-risein space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">常見問題</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          找不到答案時，可以在申請頁面點「教我怎麼取得」，或直接洽承辦單位。
        </p>
      </header>

      <Field label="搜尋問題" hint="用你自己的話問就可以，例如「帳單」「要多久」。">
        {(props) => (
          <div className="relative">
            <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <Input
              {...props}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="例如：出帳帳單"
              autoComplete="off"
            />
          </div>
        )}
      </Field>

      {faqsQuery.isLoading ? (
        <Spinner label="載入常見問題…" />
      ) : faqs.length === 0 ? (
        <EmptyState
          icon={<HelpCircle size={20} />}
          title="沒有符合的問題"
          hint="換個說法再搜尋一次，或直接洽承辦單位。"
        />
      ) : (
        <ul className="space-y-3">
          {faqs.map((faq) => (
            <li key={faq.id}>
              <Card>
                <details>
                  <summary className="min-h-11 list-none text-[15px] font-medium leading-6 text-primary marker:hidden">
                    {faq.question}
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-[14px] leading-6 text-muted">{faq.answer}</p>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
