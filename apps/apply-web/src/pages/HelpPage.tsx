/** `/help` — 常見問題與自助客服中心（SPEC §8.1）。
 *
 * 現代自助客服服務架構：
 * 1. 核心自助服務快捷入口（進度查詢、扣款證明 SOP、隱私遮罩機制）。
 * 2. 智慧搜尋列搭配熱門關鍵字標籤，支援伺服器快搜與前端即時縮小範圍。
 * 3. 多維度主題分類標籤導覽，附帶題目計數徽章。
 * 4. 現代折疊問答卡片，支援微互動與解答滿意度（Helpfulness）回饋。
 * 5. 專人客服支援窗口（LINE 官方帳號、市民電話專線、諮詢信箱）。
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  HelpCircle,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { Button, Card, EmptyState, Field, Input, Spinner, cx } from '@maydru/ui'
import { useFaqs } from '../lib/queries'
import type { Faq } from '../lib/types'

export const CATEGORY_LABELS: Record<string, string> = {
  ALL: '全部問題',
  DOCUMENTS: '證明文件',
  PRIVACY: '隱私安全',
  PROCESS: '申辦審核',
  TOOLS: '工具認列',
  ELIGIBILITY: '資格金額',
  REGULATION: '簡章規定',
}

export const POPULAR_SEARCHES = [
  '出帳帳單',
  '身分證遮罩',
  '退件補件',
  '補助上限',
  'AI工具認列',
  'iPhone 照片',
]

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
  const [activeCategory, setActiveCategory] = useState('ALL')
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const faqsQuery = useFaqs(query)
  const rawFaqs = faqsQuery.data ?? []

  // 前端即時搜尋過濾（伺服器回傳前亦能在記憶體中先縮小範圍）
  const searchFilteredFaqs = useMemo(
    () => rawFaqs.filter((faq) => matchesFaq(faq, query)),
    [rawFaqs, query],
  )

  // 依當前選取的分類過濾
  const displayedFaqs = useMemo(() => {
    if (activeCategory === 'ALL') return searchFilteredFaqs
    return searchFilteredFaqs.filter((faq) => faq.category === activeCategory)
  }, [searchFilteredFaqs, activeCategory])

  // 各分類目前符合搜尋條件的數量統計
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: searchFilteredFaqs.length }
    for (const faq of searchFilteredFaqs) {
      counts[faq.category] = (counts[faq.category] ?? 0) + 1
    }
    return counts
  }, [searchFilteredFaqs])

  // 現有題目涵蓋的所有有效分類
  const availableCategories = useMemo(() => {
    const catSet = new Set<string>()
    for (const faq of rawFaqs) {
      if (faq.category) catSet.add(faq.category)
    }
    const list = ['ALL', ...Array.from(catSet)]
    // 若特定分類在 CATEGORY_LABELS 有自訂順序，保持整齊排版
    return list.sort((a, b) => {
      const order = ['ALL', 'DOCUMENTS', 'PRIVACY', 'PROCESS', 'TOOLS', 'ELIGIBILITY', 'REGULATION']
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })
  }, [rawFaqs])

  const handleVote = (faqId: string, vote: 'yes' | 'no') => {
    setFeedback((prev) => ({ ...prev, [faqId]: vote }))
  }

  const handleCopyQuestion = async (faq: Faq) => {
    try {
      await navigator.clipboard.writeText(`${faq.question}\n\n${faq.answer}`)
      setCopiedId(faq.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // 剪貼簿失敗時靜默降級
    }
  }

  return (
    <section className="md-risein space-y-8">
      {/* 1. Hero 自助客服頂部 */}
      <header className="space-y-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-3 py-1 text-xs font-semibold text-accent">
          <HelpCircle size={14} aria-hidden />
          自助服務與幫助中心
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
          我們能為你提供什麼協助？
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          快速搜尋申辦疑問、文件準備與審核規則；或使用下方的快捷工具自助排查。
        </p>
      </header>

      {/* 2. 智慧搜尋框與熱門關鍵字標籤 */}
      <div className="space-y-3">
        <Field label="搜尋問題" hint="用你自己的話問就可以，例如「帳單」「要多久」「身分證遮罩」。">
          {(props) => (
            <div className="relative">
              <Search
                size={18}
                aria-hidden
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary"
              />
              <Input
                {...props}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pr-10 pl-10 h-12 text-[15px]"
                placeholder="例如：出帳帳單、身分證遮罩、補助上限…"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清除搜尋內容"
                  className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-secondary hover:bg-background-lite hover:text-primary"
                >
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
          )}
        </Field>

        {/* 熱門快搜標籤 */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-medium text-muted">熱門搜尋：</span>
          {POPULAR_SEARCHES.map((term) => {
            const isSelected = query.trim() === term
            return (
              <button
                key={term}
                type="button"
                onClick={() => setQuery(isSelected ? '' : term)}
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs transition-colors',
                  isSelected
                    ? 'bg-accent text-on-accent font-medium'
                    : 'bg-background-lite text-primary hover:bg-border/60',
                )}
              >
                {term}
              </button>
            )
          })}
        </div>
      </div>

      {/* 3. 三大核心自助服務捷徑卡片 */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Link
          to="/status"
          className="group relative flex flex-col justify-between rounded-2xl border border-border bg-canvas p-4.5 transition-all hover:border-accent/40 hover:shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-bg text-accent">
              <ListChecks size={20} aria-hidden />
            </div>
            <h2 className="text-[15px] font-semibold text-primary group-hover:text-accent">
              查詢案件進度
            </h2>
            <p className="text-xs leading-relaxed text-muted">
              輸入案號與手機末四碼，隨時查看審核狀態與補件要求。
            </p>
          </div>
          <span className="mt-3 inline-flex items-center text-xs font-medium text-accent">
            立即查詢 →
          </span>
        </Link>

        <Link
          to="/sop"
          className="group relative flex flex-col justify-between rounded-2xl border border-border bg-canvas p-4.5 transition-all hover:border-accent/40 hover:shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-bg text-accent">
              <BookOpen size={20} aria-hidden />
            </div>
            <h2 className="text-[15px] font-semibold text-primary group-hover:text-accent">
              扣款證明圖文教學
            </h2>
            <p className="text-xs leading-relaxed text-muted">
              各大銀行 App、信用卡、Apple 與 Google 帳單截圖示範。
            </p>
          </div>
          <span className="mt-3 inline-flex items-center text-xs font-medium text-accent">
            查看教學 SOP →
          </span>
        </Link>

        <button
          type="button"
          onClick={() => {
            setActiveCategory('PRIVACY')
            const el = document.getElementById('faq-list')
            el?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="group relative flex flex-col justify-between rounded-2xl border border-border bg-canvas p-4.5 text-left transition-all hover:border-accent/40 hover:shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-bg text-accent">
              <ShieldCheck size={20} aria-hidden />
            </div>
            <h2 className="text-[15px] font-semibold text-primary group-hover:text-accent">
              隱私離線自動遮罩
            </h2>
            <p className="text-xs leading-relaxed text-muted">
              手機端離線自動遮蔽非必要個資，保護隱私不外流。
            </p>
          </div>
          <span className="mt-3 inline-flex items-center text-xs font-medium text-accent">
            了解安全機制 →
          </span>
        </button>
      </div>

      {/* 4. 主題分類切換標籤列 */}
      <div id="faq-list" className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-primary">常見疑問解答</h2>
          <span className="text-xs text-muted">
            共 {displayedFaqs.length} 則解答
          </span>
        </div>

        <nav aria-label="常見問題分類" className="flex flex-wrap gap-2">
          {availableCategories.map((catKey) => {
            const count = categoryCounts[catKey] ?? 0
            const isActive = activeCategory === catKey
            return (
              <button
                key={catKey}
                type="button"
                onClick={() => setActiveCategory(catKey)}
                className={cx(
                  'flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'bg-primary text-elevated font-semibold'
                    : 'border border-border bg-canvas text-muted hover:border-secondary hover:text-primary',
                )}
              >
                <span>{CATEGORY_LABELS[catKey] ?? catKey}</span>
                <span
                  className={cx(
                    'rounded-full px-1.5 py-0.2 text-[11px]',
                    isActive ? 'bg-white/20 text-elevated' : 'bg-background-lite text-secondary',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* 5. 問答卡片列表與互動 */}
      {faqsQuery.isLoading ? (
        <Spinner label="載入常見問題…" />
      ) : displayedFaqs.length === 0 ? (
        <EmptyState
          icon={<HelpCircle size={24} />}
          title="沒有符合的問題"
          hint={
            query
              ? `找不到與「${query}」相符的解答，請嘗試更簡短的關鍵字或切換分類。`
              : '此分類目前尚無問答項目。'
          }
        >
          {(query || activeCategory !== 'ALL') && (
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setActiveCategory('ALL')
                }}
              >
                重設搜尋與分類
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="常見問題列表">
          {displayedFaqs.map((faq) => {
            const categoryName = CATEGORY_LABELS[faq.category] ?? faq.category
            const vote = feedback[faq.id]
            const isCopied = copiedId === faq.id

            return (
              <li key={faq.id}>
                <Card className="p-0 transition-all hover:border-secondary/60">
                  <details className="group">
                    <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 px-4.5 py-3.5 text-[15px] font-medium leading-6 text-primary select-none marker:hidden">
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        {faq.category && (
                          <span className="rounded-md bg-background-lite px-2 py-0.5 text-[11px] font-medium text-muted">
                            {categoryName}
                          </span>
                        )}
                        <span>{faq.question}</span>
                      </div>
                      <ChevronDown
                        size={18}
                        aria-hidden
                        className="shrink-0 text-secondary transition-transform duration-200 group-open:rotate-180"
                      />
                    </summary>

                    <div className="border-t border-border/60 px-4.5 pt-3 pb-4">
                      {/* 解答正文 */}
                      <p className="whitespace-pre-line text-[14px] leading-relaxed text-muted">
                        {faq.answer}
                      </p>

                      {/* 卡片底端工具列：滿意度反饋與複製問題 */}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3 text-xs text-muted">
                        {/* 解答滿意度評分 */}
                        <div className="flex items-center gap-2">
                          {vote ? (
                            <span className="inline-flex items-center gap-1 font-medium text-good">
                              <Check size={14} aria-hidden />
                              感謝你的回饋！
                            </span>
                          ) : (
                            <>
                              <span>這則說明有幫助嗎？</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleVote(faq.id, 'yes')}
                                  aria-label="這則回答有幫助"
                                  className="flex size-7 items-center justify-center rounded-lg border border-border text-muted hover:border-accent hover:bg-accent-bg hover:text-accent"
                                >
                                  <ThumbsUp size={13} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleVote(faq.id, 'no')}
                                  aria-label="這則回答沒有幫助"
                                  className="flex size-7 items-center justify-center rounded-lg border border-border text-muted hover:border-danger hover:bg-danger-bg hover:text-danger"
                                >
                                  <ThumbsDown size={13} aria-hidden />
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        {/* 複製問題與解答 */}
                        <button
                          type="button"
                          onClick={() => void handleCopyQuestion(faq)}
                          className="flex items-center gap-1 text-secondary hover:text-primary"
                          title="複製問題與解答"
                        >
                          {isCopied ? (
                            <>
                              <Check size={13} className="text-good" aria-hidden />
                              <span className="text-good">已複製</span>
                            </>
                          ) : (
                            <>
                              <Copy size={13} aria-hidden />
                              <span>複製解答</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </details>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {/* 6. 專人客服支援管道（Still Need Help Section） */}
      <footer className="rounded-2xl border border-border bg-background-lite/60 p-5 space-y-4 sm:p-6">
        <div className="space-y-1">
          <h2 className="text-[16px] font-semibold text-primary">
            找不到解決方法嗎？專人隨時為你提供協助
          </h2>
          <p className="text-xs leading-relaxed text-muted">
            若常見問題未能解答你的狀況，可直接透過官方頻道或承辦科室洽詢：
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* LINE 智慧客服 */}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-canvas p-3.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <MessageSquare size={18} aria-hidden />
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-semibold text-primary">LINE 官方線上客服</span>
              <p className="text-muted">提供 24 小時智慧問答與申辦最新通知。</p>
              <a
                href="https://line.me"
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-medium text-accent underline"
              >
                加入 LINE 好友
              </a>
            </div>
          </div>

          {/* 電話諮詢 */}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-canvas p-3.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
              <Phone size={18} aria-hidden />
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-semibold text-primary">專線 (03) 533-3115</span>
              <p className="text-muted">青年事務發展窗口（週一至週五 08:30–17:30）。</p>
              <span className="text-[11px] text-secondary">市民服務專線亦可直撥 1999</span>
            </div>
          </div>

          {/* 信箱諮詢 */}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-canvas p-3.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Mail size={18} aria-hidden />
            </div>
            <div className="space-y-0.5 text-xs">
              <span className="font-semibold text-primary">客服諮詢信箱</span>
              <p className="text-muted">來信請附上案件編號以利快速排查。</p>
              <a
                href="mailto:support@youth.hccg.gov.tw"
                className="mt-1 inline-block font-medium text-accent underline"
              >
                support@youth.hccg.gov.tw
              </a>
            </div>
          </div>
        </div>
      </footer>
    </section>
  )
}
