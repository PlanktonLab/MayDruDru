import { NavLink, Route, Routes } from 'react-router-dom'
import { FileText, HelpCircle, ListChecks, Map } from 'lucide-react'
import SchemesPage from './pages/SchemesPage'
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

export default function App() {
  return (
    <div className="mx-auto flex min-h-full max-w-screen-sm flex-col">
      <main className="flex-1 px-4 pb-24 pt-6">
        <Routes>
          <Route path="/" element={<SchemesPage />} />
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

      <nav
        aria-label="主要導覽"
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-screen-sm border-t border-border bg-elevated/95 backdrop-blur"
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
    </div>
  )
}
