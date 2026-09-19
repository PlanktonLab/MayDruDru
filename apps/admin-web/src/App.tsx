import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './lib/auth'
import { ToastProvider } from './components/ui'
import AppShell from './layout/AppShell'
import LoginPage from './pages/LoginPage'
import CanvasPage from './pages/CanvasPage'
import ReviewQueuePage from './pages/ReviewQueuePage'
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
