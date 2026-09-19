import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { get, post, setToken, getToken } from './api'
import { ROLE_CAPS, type Capability, type User } from './types'

/**
 * 授權一律問 `can(capability)`，不問角色排名（決策 D14）。
 *
 * 排名授權的問題在 P1 已經踩過：案件覆核者的排名比 SOP 編輯者高，於是他「順便」
 * 拿到了 SOP 編輯權。改成 capability 之後，能不能按某個按鈕只取決於那個能力。
 */
interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  can: (capability: Capability) => boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return }
    try { setUser(await get<User>('/api/auth/me')) } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const onLogout = () => setUser(null)
    window.addEventListener('sop:logout', onLogout)
    return () => window.removeEventListener('sop:logout', onLogout)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const t = await post<{ access_token: string }>('/api/auth/login', { email, password })
    setToken(t.access_token)
    await refresh()
  }, [refresh])
  const logout = useCallback(() => { setToken(null); setUser(null) }, [])
  // 後端若回了前端還不認得的角色，一律視為沒有任何能力——寧可少給，不可多給。
  const can = useCallback((capability: Capability) => !!user && (ROLE_CAPS[user.role] ?? []).includes(capability), [user])

  return <Ctx.Provider value={{ user, loading, login, logout, can, refresh }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="p-8 text-muted">載入中…</div>
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return <>{children}</>
}

/** 沒有這個能力就導回首頁；用在整頁都需要某個 capability 的路由上。 */
export function RequireCap({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can, loading } = useAuth()
  if (loading) return <div className="p-8 text-muted">載入中…</div>
  if (!can(capability)) return <Navigate to="/canvas" replace />
  return <>{children}</>
}
