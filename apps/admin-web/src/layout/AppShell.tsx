import { NavLink, Outlet } from 'react-router-dom'
import { clsx } from 'clsx'
import { BarChart3, Bell, BookOpen, ClipboardCheck, FileClock, FileSearch, FlaskConical, FolderCog, HelpCircle, KeyRound, LayoutGrid, Link2, ListChecks, LogOut, MessageSquare, MessageSquareText, Moon, PanelLeftClose, PanelLeftOpen, SearchX, Sun, Users, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL, type Capability } from '../lib/types'

const LS_NAV_COLLAPSED = 'sop_nav_collapsed'

/** `cap` 是進得去這一頁所需的能力；沒填代表登入就看得到（決策 D14）。 */
const GROUPS: { label: string; items: { to: string; label: string; icon: typeof Workflow; cap?: Capability }[] }[] = [
  { label: '申請審查', items: [
    { to: '/cases', label: '申請名單', icon: FileSearch, cap: 'case_review' },
    { to: '/review-settings', label: '資料重點設定', icon: ListChecks },
    { to: '/help-chat', label: '申請端機器人', icon: BookOpen },
    { to: '/tool-knowledge', label: 'AI 工具知識庫', icon: BookOpen },
    { to: '/dashboard', label: '審查概況', icon: BarChart3 },
    { to: '/schemes', label: '申請方案設定', icon: FolderCog },
  ] },
  { label: '扣款記錄 SOP', items: [
    { to: '/canvas', label: '教學流程', icon: Workflow },
    { to: '/review', label: 'SOP 審核', icon: ClipboardCheck },
    { to: '/sop/document-types', label: '文件類型對照', icon: Link2, cap: 'admin' },
    { to: '/playground', label: '測試對話', icon: MessageSquare },
    { to: '/evals', label: '評測', icon: FlaskConical },
  ] },
  { label: 'LINE 帳號', items: [
    { to: '/line/contents', label: '罐頭訊息', icon: MessageSquareText },
    { to: '/line/faqs', label: '常見問題', icon: HelpCircle },
    { to: '/line/knowledge', label: '知識文件', icon: BookOpen },
    { to: '/line/richmenu', label: '圖文選單', icon: LayoutGrid },
    { to: '/line/notifications', label: '推播紀錄', icon: Bell },
    { to: '/line/unmatched', label: '未命中訊息', icon: SearchX },
  ] },
  { label: '系統管理', items: [
    { to: '/members', label: '成員', icon: Users, cap: 'admin' },
    { to: '/api-keys', label: 'API Key', icon: KeyRound, cap: 'admin' },
    { to: '/audit-logs', label: '稽核日誌', icon: FileClock, cap: 'admin' },
  ] },
]

const navLinkClass = (collapsed: boolean) => ({ isActive }: { isActive: boolean }) =>
  clsx('flex items-center gap-2 rounded-lg py-1.5 text-sm', collapsed ? 'justify-center px-0' : 'px-2.5',
    isActive ? 'bg-accent-bg text-accent font-medium' : 'text-muted hover:bg-background-lite hover:text-primary')

export default function AppShell() {
  const { user, logout, can } = useAuth()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_NAV_COLLAPSED) === '1')
  useEffect(() => { localStorage.setItem(LS_NAV_COLLAPSED, collapsed ? '1' : '0') }, [collapsed])
  const iconBtn = 'rounded-md border border-border p-1.5 text-muted hover:text-primary'
  return (
    <div className="flex h-full">
      <aside className={clsx('flex shrink-0 flex-col overflow-hidden border-r border-border bg-canvas transition-[width] duration-200', collapsed ? 'w-14' : 'w-52')}>
        <div className={clsx('flex items-center py-4', collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-2')}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-base font-bold tracking-tight">MayDru 後台</div>
              <div className="text-[11px] text-muted">承辦人作業區</div>
            </div>
          )}
          <button onClick={() => setCollapsed((c) => !c)} className="rounded-md p-1.5 text-muted hover:bg-background-lite hover:text-primary" title={collapsed ? '展開選單' : '收合選單'} aria-label={collapsed ? '展開選單' : '收合選單'} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav aria-label="後台功能" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.cap || can(item.cap))
            if (!items.length) return null
            return <section key={group.label} aria-label={group.label} className="mb-3 space-y-0.5 border-t border-border pt-3">
              {!collapsed && <h2 className="px-2.5 pb-2 text-[11px] font-semibold tracking-wide text-secondary">{group.label}</h2>}
              {items.map((n) => <NavLink key={n.to} to={n.to} title={collapsed ? n.label : undefined} aria-label={n.label} className={navLinkClass(collapsed)}>
                <n.icon size={15} className="shrink-0" />{!collapsed && <span className="truncate">{n.label}</span>}
              </NavLink>)}
            </section>
          })}
        </nav>
        <div className="border-t border-border p-3 text-xs">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <button onClick={() => setDark((d) => !d)} className={iconBtn} title="切換主題">{dark ? <Sun size={13} /> : <Moon size={13} />}</button>
              <button onClick={logout} className={iconBtn} title="登出" aria-label="登出"><LogOut size={13} /></button>
            </div>
          ) : (
            <>
              <div className="truncate font-medium">{user?.name || user?.email}</div>
              <div className="mb-2 text-muted">{user && ROLE_LABEL[user.role]}</div>
              <div className="flex gap-1">
                <button onClick={() => setDark((d) => !d)} className={iconBtn} title="切換主題">{dark ? <Sun size={13} /> : <Moon size={13} />}</button>
                <button onClick={logout} className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-muted hover:text-primary"><LogOut size={13} /> 登出</button>
              </div>
            </>
          )}
        </div>
      </aside>
      <main className="relative min-w-0 flex-1 overflow-auto"><Outlet /></main>
    </div>
  )
}
