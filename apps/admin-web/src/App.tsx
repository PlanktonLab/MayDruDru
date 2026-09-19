import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequireCap } from './lib/auth'
import { ToastProvider } from './components/ui'
import AppShell from './layout/AppShell'
import LoginPage from './pages/LoginPage'
import CanvasPage from './pages/CanvasPage'
import ReviewQueuePage from './pages/ReviewQueuePage'
import CasesQueuePage from './pages/CasesQueuePage'
import CaseReviewPage from './pages/CaseReviewPage'
import PlaygroundPage from './pages/PlaygroundPage'
import EvalsPage from './pages/EvalsPage'
import DashboardPage from './pages/DashboardPage'
import MembersPage from './pages/MembersPage'
import ApiKeysPage from './pages/ApiKeysPage'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Navigate to="/canvas" replace />} />
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/review" element={<ReviewQueuePage />} />
          {/* 案件審核區（SPEC §8.2）：整區都需要 case_review 能力（決策 D14）。 */}
          <Route path="/cases" element={<RequireCap capability="case_review"><CasesQueuePage /></RequireCap>} />
          <Route path="/cases/:case_no" element={<RequireCap capability="case_review"><CaseReviewPage /></RequireCap>} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/evals" element={<EvalsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* 平台 and Goal moved into Canvas; old links and bookmarks land there. */}
          <Route path="/platforms" element={<Navigate to="/canvas" replace />} />
          <Route path="/goals" element={<Navigate to="/canvas" replace />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/api-keys" element={<ApiKeysPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/canvas" replace />} />
      </Routes>
    </ToastProvider>
  )
}
