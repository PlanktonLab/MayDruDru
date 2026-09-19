/** 應用外殼：手機是底部選單的單欄，桌面是頁首導覽 + 寬版內容（SPEC §15）。
 *
 * 兩種排版共用同一組路由與頁面元件，差別只在外框：
 * 手機保留原本的四個底部分頁；桌面（lg 起）改成白色頁首 + 置中內容 + 頁尾，
 * 底部選單則收起來，因為滑鼠使用者不需要把導覽放在拇指範圍內。
 */

import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { ArrowUpRight, FileText, HelpCircle, ListChecks, Map } from 'lucide-react'
import ApplyPage from './pages/ApplyPage'
import SubmittedPage from './pages/SubmittedPage'
import StatusPage from './pages/StatusPage'
import CasePage from './pages/CasePage'
import SopPage from './pages/SopPage'
import HelpPage from './pages/HelpPage'

const TABS = [
  { to: '/', label: '申辦', Icon: FileText },
  { to: '/status', label: '進度', Icon: ListChecks },
  { to: '/sop', label: '教學', Icon: Map },
  { to: '/help', label: '說明', Icon: HelpCircle },
] as const

/** 桌面頁首的次要導覽；「我的案件」是右邊那顆獨立的膠囊按鈕，不列在這裡。 */
const DESKTOP_LINKS = [
  { to: '/', label: '線上申辦', end: true },
  { to: '/sop', label: '文件教學', end: false },
  { to: '/help', label: '常見問題', end: false },
] as const

function DesktopHeader() {
  return (
    <header className="apply-header">
      <div className="apply-gutter flex items-center justify-between gap-4 py-4">
        <Link to="/" className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent"
          >
            <FileText size={20} />
          </span>
          <span className="leading-tight">
            <span className="block text-[19px] font-semibold tracking-tight text-primary">數位申辦平台</span>
            <span className="mt-0.5 block text-[11px] tracking-[0.16em] text-muted">MAYDRU ONLINE SERVICE</span>
          </span>
        </Link>

        <nav aria-label="主要導覽" className="flex shrink-0 items-center gap-5 text-[13px]">
          {DESKTOP_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? 'font-medium text-primary' : 'text-muted hover:text-primary'
              }
            >
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/status"
            className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-primary hover:bg-background-lite"
          >
            我的案件
            <ArrowUpRight size={14} aria-hidden />
          </NavLink>
        </nav>
      </div>
    </header>
  )
}

/** 手機底部選單：原樣保留，桌面（lg 起）隱藏。 */
function MobileTabs() {
  return (
    <nav
      aria-label="主要導覽"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-screen-sm border-t border-border bg-elevated/95 backdrop-blur lg:hidden"
    >
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-xs ${
              isActive ? 'text-accent' : 'text-muted'
            }`
          }
        >
          <Icon size={20} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <div className="apply-shell">
      <DesktopHeader />

      {/* 手機維持 max-w-screen-sm 的單欄與底部選單的留白；桌面交給 apply-gutter。 */}
      <main className="apply-gutter mx-auto w-full max-w-screen-sm flex-1 pt-6 pb-24 lg:max-w-none lg:pt-8 lg:pb-10">
        <Routes>
          {/* 目前只有一個補助計畫，進站就是它的申請流程（不再先選方案）。
              `/apply/:scheme` 保留，未來多開方案時直接可用。 */}
          <Route path="/" element={<ApplyPage />} />
          <Route path="/apply/:scheme" element={<ApplyPage />} />
          <Route path="/apply/:scheme/done" element={<SubmittedPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/status/:case_no" element={<CasePage />} />
          <Route path="/sop" element={<SopPage />} />
          <Route path="/sop/:flow" element={<SopPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="*" element={<HelpPage />} />
        </Routes>
      </main>

      <div className="apply-gutter">
        <footer className="apply-footer">
          <span>MayDru 政府申辦流程協助平台</span>
          <span>線上申辦 · 免註冊 · 送出後以案件編號查詢</span>
        </footer>
      </div>

      <MobileTabs />
    </div>
  )
}
