/**
 * The floating top chrome. Left: the platform / flow switcher — two names,
 * each a menu, so changing context is one click and the tree never has to be
 * on screen. Right: 發布, and once published the version with its menu.
 *
 * 發布 runs the DAG + asset validation first; when the flow is not
 * publishable a small popover lists what is missing, with every unfinished
 * step name clickable so the canvas jumps to it.
 */

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { get } from '../lib/api'
import { CHANNEL_LABEL, type Validation } from '../lib/types'
import { confirm, useToast } from '../components/ui'
import { selSteps, useEditor } from './context'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { THEME_LABEL } from './status'

const anchor = (e: React.MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect()
  return { clientX: r.left, clientY: r.bottom + 6 }
}

export function TopBar() {
  const ed = useEditor()
  const { data, flow, platform, editable, isAdmin, canReview, actions, publish, publishing: busy, publishFailed: failed } = ed
  const qc = useQueryClient()
  const menu = useContextMenu()
  const toast = useToast()

  // Lazy validation of the open flow — only a hint on the button; 發布 always re-checks.
  const validation = useQuery({
    queryKey: ['validate', flow?.id ?? ''],
    queryFn: () => get<Validation>(`/api/flows/${flow?.id}/validate`),
    enabled: !!flow,
  })
  const seen = useRef(ed.data)
  useEffect(() => {
    if (seen.current === ed.data) return
    seen.current = ed.data
    void qc.invalidateQueries({ queryKey: ['validate'] })
  }, [ed.data, qc])

  /* ---- menus */
  const platforms = [...data.platforms].sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-Hant'))
  const flowsOf = (pid: string) => data.flows.filter((f) => f.platform_id === pid).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))

  const platformMenu = (e: React.MouseEvent<HTMLElement>) => {
    const items: MenuItem[] = platforms.map((p) => ({
      label: p.display_name,
      shortcut: CHANNEL_LABEL[p.channel],
      checked: p.id === platform?.id,
      onSelect: () => {
        if (p.id === platform?.id) return
        const first = flowsOf(p.id)[0]
        if (first) ed.openFlow(first.id)
        else ed.openDialog({ kind: 'new-flow', platformId: p.id })
      },
    }))
    if (editable) {
      items.push('separator', { label: '新增平台…', onSelect: () => ed.openDialog({ kind: 'new-platform' }) })
      if (platform) items.push({ label: `${platform.display_name} 的設定…`, onSelect: () => ed.openDialog({ kind: 'platform', id: platform.id }) })
    }
    menu.open(anchor(e), items)
  }

  const flowMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (!platform) return
    const items: MenuItem[] = flowsOf(platform.id).map((f) => ({
      label: f.name,
      shortcut: f.status === 'published' ? `v${f.current_version ?? ''}` : undefined,
      checked: f.id === flow?.id,
      onSelect: () => ed.openFlow(f.id),
    }))
    if (editable) {
      items.push('separator', { label: '新增流程…', onSelect: () => ed.openDialog({ kind: 'new-flow', platformId: platform.id }) })
      if (flow) {
        items.push({ label: '流程設定…', onSelect: () => ed.openDialog({ kind: 'flow', id: flow.id }) })
        items.push({ label: '重新產生全部教學圖', onSelect: () => void renderAll(flow.id) })
      }
    }
    if (isAdmin) items.push('separator', { label: '目標文件…', onSelect: () => ed.openDialog({ kind: 'goals' }) })
    menu.open(anchor(e), items)
  }

  const renderAll = async (flowId: string) => {
    if (!await confirm({ title: '重新產生這個流程的全部教學圖？', body: '已通過審核的每一步都會用目前的版型重新排版；各步自己的版面調整保留。', action: '重新產生' })) return
    const r = await actions.renderFlowCards(flowId)
    if (r) toast(r.queued ? `已排入 ${r.queued} 張教學圖` : '沒有可重新產生的步驟')
  }

  const publishedMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!flow || !canReview) return
    menu.open(anchor(e), [
      { label: '重新發布', onSelect: publish },
      { label: '版本紀錄…', onSelect: () => ed.openDialog({ kind: 'flow', id: flow.id }) },
      'separator',
      { label: '取消發布', danger: true, onSelect: () => void actions.unpublishFlow(flow.id) },
    ])
  }

  const pill = 'pointer-events-auto flex h-9 items-center rounded-full border border-border bg-canvas/90 backdrop-blur-xl'
  const seg = 'flex h-9 items-center gap-1 px-3 text-[13px] transition-colors hover:bg-background-lite first:rounded-l-full last:rounded-r-full'

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
      {/* switcher */}
      <div className={pill} style={{ boxShadow: 'var(--shadow-float)' }}>
        <button type="button" onClick={platformMenu} className={clsx(seg, 'text-muted')} title="切換平台">
          <span className="max-w-[180px] truncate">{platform?.display_name ?? '選擇平台'}</span>
          <ChevronDown size={13} className="text-secondary" />
        </button>
        {platform && (
          <>
            <span className="h-4 w-px bg-border" />
            <button type="button" onClick={flowMenu} className={clsx(seg, 'font-medium text-primary')} title="切換流程">
              <span className="max-w-[240px] truncate">{flow?.name ?? '選擇流程'}</span>
              <ChevronDown size={13} className="text-secondary" />
            </button>
          </>
        )}
        {platform && (editable || isAdmin) && (
          <>
            <span className="h-4 w-px bg-border" />
            <button type="button" onClick={() => ed.openDialog({ kind: 'platform', id: platform.id })} className="flex h-9 w-9 items-center justify-center rounded-r-full text-muted transition-colors hover:bg-background-lite hover:text-primary" title="平台設定">
              <Settings2 size={14} />
            </button>
          </>
        )}
      </div>

      {/* publish */}
      {flow && (
        <div className="pointer-events-auto relative flex shrink-0 items-center">
          {flow.status === 'published' ? (
            <button
              onClick={publishedMenu}
              disabled={!canReview}
              title={canReview ? undefined : '需要審核者權限'}
              className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-canvas/90 px-3.5 text-[13px] text-muted backdrop-blur-xl hover:bg-background-lite disabled:opacity-60"
              style={{ boxShadow: 'var(--shadow-float)' }}
            >
              <Check size={13} className="text-good" /> 已發布 v{flow.current_version ?? '—'}
              {canReview && <ChevronDown size={12} />}
            </button>
          ) : (
            <button
              onClick={publish}
              disabled={!canReview || busy}
              title={!canReview ? '需要審核者權限' : validation.data && !validation.data.publishable ? '還有未完成的步驟，按下可查看' : undefined}
              className={clsx('h-9 rounded-full px-4 text-[13px] font-medium text-on-accent transition-opacity',
                canReview && !busy ? 'bg-accent hover:opacity-90' : 'bg-accent opacity-50 cursor-not-allowed')}
              style={{ boxShadow: 'var(--shadow-float)' }}
            >
              發布
            </button>
          )}
          {failed && failed.flowId === flow.id && <ErrorPopover validation={failed.validation} onClose={ed.dismissPublishFailed} />}
        </div>
      )}

      {menu.menu && <ContextMenu menu={menu.menu} onClose={menu.close} />}
    </div>
  )
}

/**
 * Why the flow cannot be published: the structural problems as sentences, and
 * each unfinished screenshot as a step name that jumps to its card.
 */
function ErrorPopover({ validation, onClose }: { validation: Validation; onClose: () => void }) {
  const ed = useEditor()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const unfinished = validation.unfinished.flatMap((u) => {
    const node = ed.scene.byId.get(u.step_id)
    return node ? [{ ...u, node }] : []
  })
  const sentences = validation.errors.length || unfinished.length ? validation.errors : validation.publish_errors
  const goTo = (node: (typeof unfinished)[number]['node']) => {
    ed.setSelection(selSteps([node.id]))
    ed.focusBox(node.box)
    onClose()
  }

  return (
    <div className="pg-dropin absolute right-0 top-11 z-40 w-80 rounded-xl border border-border bg-canvas p-4 text-[13px]" style={{ boxShadow: 'var(--shadow-popover)' }}>
      <div className="mb-1 font-medium">還差一點就能發布</div>
      <p className="mb-2 text-[12px] text-secondary">每個步驟都要有完成的教學圖，起點到終點也要連得起來。</p>
      <ul className="space-y-1.5 text-muted">
        {sentences.map((e, i) => <li key={i} className="leading-5">{e}</li>)}
        {unfinished.map((u) => (
          <li key={`${u.step_id}-${u.theme}`} className="leading-5">
            <button onClick={() => goTo(u.node)} className="text-accent underline-offset-2 hover:underline">{u.node.step.title || '未命名步驟'}</button>
            <span className="text-secondary">　{THEME_LABEL[u.theme]}截圖尚未完成</span>
          </li>
        ))}
        {!sentences.length && !unfinished.length && <li className="leading-5">這條流程還不能發布</li>}
      </ul>
      <button onClick={onClose} className="mt-3 text-[12px] font-medium text-accent">知道了</button>
    </div>
  )
}
