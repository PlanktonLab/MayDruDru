/** `/` — 開放中的補助方案（SPEC §8.1）。
 *
 * 一張卡一個方案，一個方案只有一個主要動作：開始申請（SPEC §15.1）。
 * 查詢進度、SOP 教學、常見問題放在下面當次要入口。
 */

import { Link } from 'react-router-dom'
import { ArrowRight, FileSearch, HelpCircle, Inbox, Map } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Spinner } from '@maydru/ui'
import { period } from '../lib/format'
import { useSchemes } from '../lib/queries'

const SHORTCUTS = [
  { to: '/status', label: '查詢我的案件進度', hint: '用案件編號與末四碼查詢、補件或撤回。', Icon: FileSearch },
  { to: '/sop', label: '教我怎麼取得文件', hint: '一步一步教你從帳單或 App 裡找到需要的憑證。', Icon: Map },
  { to: '/help', label: '常見問題', hint: '退件原因、保存期限、可補助的工具。', Icon: HelpCircle },
] as const

export default function SchemesPage() {
  const query = useSchemes()
  const schemes = query.data ?? []

  return (
    <section className="md-risein space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">線上申辦</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          不需要註冊或登入。備妥證明文件照片，依畫面一步一步完成，送出後會拿到一組案件編號。
        </p>
      </header>

      {query.isLoading ? (
        <Spinner label="載入開放中的方案…" />
      ) : query.error ? (
        <p role="alert" className="text-[14px] text-danger">
          方案清單載入失敗。請確認網路後重新整理頁面。
        </p>
      ) : schemes.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="目前沒有開放中的方案"
          hint="新的補助公告後會出現在這裡。你仍然可以查詢先前送出的案件。"
          action={
            <Link to="/status">
              <Button>查詢案件進度</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {schemes.map((scheme) => (
            <li key={scheme.code}>
              <Card
                title={scheme.name}
                subtitle={scheme.description}
                footer={
                  <Link to={`/apply/${encodeURIComponent(scheme.code)}`} className="block">
                    <Button variant="primary" size="lg" block icon={<ArrowRight size={16} />}>
                      開始申請
                    </Button>
                  </Link>
                }
              >
                <dl className="space-y-1.5 text-[14px] leading-6">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted">申請期間</dt>
                    <dd className="text-primary">{period(scheme.application_start, scheme.application_end)}</dd>
                  </div>
                  {scheme.amount_note && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">補助金額</dt>
                      <dd className="text-primary">{scheme.amount_note}</dd>
                    </div>
                  )}
                </dl>
                {scheme.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scheme.tags.slice(0, 6).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="其他功能" className="space-y-2 pt-2">
        {SHORTCUTS.map(({ to, label, hint, Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-11 items-center gap-3 rounded-2xl border border-border bg-canvas p-4 hover:bg-background-lite"
          >
            <Icon size={20} aria-hidden className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-primary">{label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>
            </span>
            <ArrowRight size={16} aria-hidden className="shrink-0 text-tertiary" />
          </Link>
        ))}
      </nav>
    </section>
  )
}
