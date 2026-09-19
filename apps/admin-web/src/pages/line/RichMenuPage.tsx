/**
 * 圖文選單（SPEC §8.4）——LINE 聊天室下方那六格。
 *
 * 上半部把六格按畫布比例畫出來：承辦人拿設計稿對照時，看得到哪一格對到哪一個
 * 動作，不必去翻 JSON。狀態徽章講的是「LINE 上那一份」和「這裡這一份」的關係；
 * 後端只回代碼，中文在 `labels.ts` 長出來（同一個代碼在三個地方各翻一次，遲早
 * 會講不一樣的話）。
 *
 * 同步刻意是「先建新的、成功才刪舊的」（後端做的），所以中途失敗時民眾手機上
 * 還是原本那個選單。失敗回 502 並附圖檔診斷，這裡把診斷也翻成中文。
 */

import { useQuery } from '@tanstack/react-query'
import { ImageIcon, RefreshCw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import type { RichMenuSyncFailure, RichMenuTile } from '../../lib/types'
import { Badge, Button, Card, Empty, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th, fmtDate } from '../../components/admin/shared'
import {
  RICH_MENU_IMAGE_RULE,
  RICH_MENU_STATE_LABEL,
  RICH_MENU_STATE_TONE,
  describeDifference,
  describeImageProblem,
  imageProblemCodes,
} from './labels'
import { fetchRichMenu, fetchSyncLogs, syncRichMenu } from './queries'
import { RICH_MENU_CANVAS, defaultGridBounds, tileRect } from './tiles'

/** 六格的動作代碼 → 中文，和 `services/line/flex.MAIN_MENU` 同一組。 */
const TILE_ACTION_LABEL: Record<string, string> = {
  case_status: '查詢案件進度',
  my_cases: '我的案件',
  scheme_info: '補助資訊',
  sop_start: '資格檢查',
  faq: '常見問題',
  contact: '聯絡我們',
}

export default function LineRichMenuPage() {
  const { can } = useAuth()
  const admin = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const filePicker = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)

  const menu = useQuery({ queryKey: ['line-richmenu'], queryFn: fetchRichMenu })
  const logs = useQuery({ queryKey: ['line-sync-logs'], queryFn: () => fetchSyncLogs(20) })
  const state = menu.data?.state ?? 'unknown'
  const tiles = menu.data?.tiles ?? []

  const sync = async () => {
    setSyncing(true)
    setProblems([])
    try {
      await syncRichMenu(image)
      await invalidate('line-richmenu', 'line-sync-logs')
      setImage(null)
      if (filePicker.current) filePicker.current.value = ''
      toast('已同步到 LINE')
    } catch (e) {
      // 502 的 body 帶著圖檔診斷；那些也是代碼，一樣在這裡翻成中文。
      const detail = e instanceof ApiError ? (e.detail as RichMenuSyncFailure | null) : null
      const codes = imageProblemCodes(detail?.image?.problems, detail?.error)
      setProblems(codes)
      toast(codes.length ? '圖檔不符合 LINE 的規定' : errMsg(e), 'err')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="圖文選單"
        description={<>民眾在聊天室下方看到的六格。每一格都是固定的動作，改圖不會改動作；圖檔必須是 {RICH_MENU_IMAGE_RULE}。</>}
        actions={<Badge tone={RICH_MENU_STATE_TONE[state]}>{RICH_MENU_STATE_LABEL[state]}</Badge>}
      />

      {menu.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 讀取 LINE 上的狀態…</div>}
      {menu.error && <Notice tone="warn">{errMsg(menu.error)}</Notice>}
      {state === 'not_configured' && <Notice tone="muted">還沒設定 LINE 憑證，所以只能看版面、不能同步。請先在環境變數裡填好 channel access token。</Notice>}
      {state === 'unknown' && menu.data?.error && <Notice tone="warn">問不到 LINE 現在的狀態（{menu.data.error}）。這不代表選單壞了，稍後再看一次即可。</Notice>}
      {state === 'missing' && <Notice tone="warn">LINE 上目前沒有圖文選單，民眾的聊天室下方是空的。按「同步到 LINE」就會建立。</Notice>}
      {state === 'different' && !!menu.data?.differences.length && (
        <Notice tone="warn">
          <div className="font-medium">LINE 上那一份和這裡不一樣：</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {menu.data.differences.map((code) => <li key={code}>{describeDifference(code)}</li>)}
          </ul>
        </Notice>
      )}

      <Card title="版面" actions={<span className="text-[11px] text-muted">畫布 {RICH_MENU_CANVAS.width} × {RICH_MENU_CANVAS.height}</span>}>
        <TileLayout tiles={tiles} />
      </Card>

      <Card title="同步到 LINE">
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted">不選圖就沿用目前那一張（或系統內建的美術稿）。同步會先建立新的選單，成功之後才刪掉舊的，所以中途失敗時民眾手機上還是原本那個。</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={filePicker}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="選單圖檔"
              disabled={!admin}
              onChange={(e) => { setImage(e.target.files?.[0] ?? null); setProblems([]) }}
              className="max-w-xs text-xs text-muted file:mr-2 file:min-h-9 file:rounded-lg file:border file:border-border file:bg-canvas file:px-3 file:text-sm file:text-primary"
            />
            <Button variant="primary" onClick={() => void sync()} loading={syncing} disabled={!admin || state === 'not_configured'}>
              {image ? <Upload size={13} /> : <RefreshCw size={13} />} 同步到 LINE
            </Button>
            {menu.data?.last_sync && <span className="text-[11px] text-muted">上次同步 {fmtDate(menu.data.last_sync)}</span>}
          </div>
          {!admin && <Notice tone="muted">只有管理員能同步——這個動作會改變每一位民眾手機上的選單。</Notice>}
          {!!problems.length && (
            <Notice tone="warn">
              <div className="font-medium">這張圖 LINE 不收：</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {problems.map((code) => <li key={code}>{describeImageProblem(code)}</li>)}
              </ul>
            </Notice>
          )}
        </div>
      </Card>

      <Card title="同步紀錄">
        {logs.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
        {logs.data && !logs.data.items.length && <Empty>還沒有同步過</Empty>}
        {!!logs.data?.items.length && (
          <Table>
            <thead><tr><Th>動作</Th><Th className="w-24">結果</Th><Th>LINE 上的 ID</Th><Th>錯誤</Th><Th className="w-32">時間</Th></tr></thead>
            <tbody>
              {logs.data.items.map((row) => (
                <tr key={row.id} className="hover:bg-background-lite">
                  <Td className="whitespace-nowrap font-mono text-xs">{row.operation}</Td>
                  <Td><Badge tone={row.status === 'success' ? 'good' : row.status === 'failed' ? 'danger' : 'muted'}>{row.status === 'success' ? '成功' : row.status === 'failed' ? '失敗' : row.status}</Badge></Td>
                  <Td className="font-mono text-[11px] text-muted">{row.remote_id || '—'}</Td>
                  <Td className="max-w-sm text-xs text-danger"><span className="block truncate" title={row.error ?? undefined}>{row.error || '—'}</span></Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(row.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/**
 * 六格按畫布比例排出來。外框用 `aspect-ratio`，格子用百分比絕對定位——
 * 縮放時比例自己對，不必為了不同寬度再算一次。
 */
function TileLayout({ tiles }: { tiles: RichMenuTile[] }) {
  const cells = tiles.length
    ? tiles
    : defaultGridBounds().map((bounds, i) => ({ action: '', label_key: '', label: `第 ${i + 1} 格`, bounds, data: '' }))
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border bg-background-lite" style={{ aspectRatio: `${RICH_MENU_CANVAS.width} / ${RICH_MENU_CANVAS.height}` }}>
      {cells.map((tile, index) => {
        const rect = tileRect(tile.bounds)
        return (
          <div
            key={`${tile.action || 'empty'}-${index}`}
            className="absolute flex flex-col items-center justify-center gap-1 border border-border bg-canvas p-2 text-center"
            style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
          >
            <span className="flex items-center gap-1 text-[13px] font-medium text-primary"><ImageIcon size={12} aria-hidden className="text-secondary" />{tile.label || '（沒有標籤）'}</span>
            {tile.action && <span className="font-mono text-[10px] text-secondary">{TILE_ACTION_LABEL[tile.action] ?? tile.action}</span>}
          </div>
        )
      })}
    </div>
  )
}
