import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, get, post, setToken } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Field, Input, errMsg } from '../components/ui'

export default function LoginPage() {
  const { login, refresh, user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', tenant_name: '', tenant_slug: '', owner_name: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => { get<{ needs_bootstrap: boolean }>('/api/auth/bootstrap-status').then((r) => setNeedsBootstrap(r.needs_bootstrap)).catch(() => {}) }, [])
  useEffect(() => { if (user) nav((loc.state as { from?: string })?.from || '/canvas', { replace: true }) }, [user, nav, loc.state])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      if (needsBootstrap) {
        const t = await post<{ access_token: string }>('/api/auth/bootstrap', { tenant_name: form.tenant_name, tenant_slug: form.tenant_slug || 'default', owner_email: form.email, owner_password: form.password, owner_name: form.owner_name || 'Owner' })
        setToken(t.access_token)
        await refresh()
      } else await login(form.email, form.password)
    } catch (e2) { setErr(loginError(e2)) } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-canvas p-6" style={{ boxShadow: 'var(--shadow-float)' }}>
        <div>
          <div className="text-lg font-bold">MayDru 後台</div>
          <div className="text-xs text-muted">{needsBootstrap ? '第一次啟動：建立第一個管理者帳號' : '登入後台'}</div>
        </div>
        {needsBootstrap && (<>
          {/* 灌過 seed 的機器機關已經在了，後端會把管理者掛上去，這兩欄就不會被用到（決策 D26）。 */}
          <Field label="機關名稱（tenant）" hint="機關已經建立過的話，這一欄不會生效"><Input value={form.tenant_name} onChange={set('tenant_name')} required placeholder="新竹市政府" /></Field>
          <Field label="代號（slug）"><Input value={form.tenant_slug} onChange={set('tenant_slug')} placeholder="hsinchu" /></Field>
          <Field label="Owner 姓名"><Input value={form.owner_name} onChange={set('owner_name')} /></Field>
        </>)}
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} required autoFocus /></Field>
        <Field label="密碼" hint={needsBootstrap ? '至少 12 個字元' : undefined}>
          <Input type="password" value={form.password} onChange={set('password')} required minLength={needsBootstrap ? 12 : undefined} autoComplete={needsBootstrap ? 'new-password' : 'current-password'} />
        </Field>
        {err && <div className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{err}</div>}
        <Button type="submit" variant="primary" loading={busy} className="w-full justify-center">{needsBootstrap ? '建立並登入' : '登入'}</Button>
      </form>
    </div>
  )
}

/**
 * The backend's own message is shown verbatim (wrong password, 429 rate limit
 * with its retry hint …); only a bare status without a body gets a fallback.
 */
function loginError(e: unknown): string {
  if (e instanceof ApiError && e.message === `HTTP ${e.status}`) {
    return e.status === 429 ? '嘗試次數過多，請稍後再試' : errMsg(e)
  }
  return errMsg(e)
}
