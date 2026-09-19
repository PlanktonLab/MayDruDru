import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { get, post, setToken, getToken } from './api'
import type { Role, User } from './types'

const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, editor: 2, admin: 3, owner: 4 }

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  atLeast: (role: Role) => boolean
  can: (action: 'edit' | 'review' | 'admin') => boolean
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
  const atLeast = useCallback((role: Role) => !!user && RANK[user.role] >= RANK[role], [user])
  const can = useCallback((a: 'edit' | 'review' | 'admin') => {
    if (!user) return false
    if (a === 'admin') return RANK[user.role] >= RANK.admin
    if (a === 'edit') return RANK[user.role] >= RANK.editor
    return user.role === 'reviewer' || RANK[user.role] >= RANK.admin
  }, [user])

  return <Ctx.Provider value={{ user, loading, login, logout, atLeast, can, refresh }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="p-8 text-muted">載入中…</div>
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return <>{children}</>
}
