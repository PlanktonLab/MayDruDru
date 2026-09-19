/** "如何使用" panel for the API Key page — mirrors SPEC §8 and backend/app/routers/public_api.py. */
import { Card } from '../ui'
import { Notice } from './shared'

const ENDPOINTS: [string, string, string][] = [
  ['POST', '/v1/sessions', '建立 session：{ external_user_id, hint?, known_context?, theme? }'],
  ['POST', '/v1/sessions/{id}/messages', '送民眾文字：{ text }'],
  ['POST', '/v1/sessions/{id}/screenshots', '送民眾截圖：multipart 欄位 file'],
  ['POST', '/v1/sessions/{id}/actions', '送動作：{ action: next | prev | choose_branch | choose_option | restart, edge_id?, option_id? }'],
  ['GET', '/v1/sessions/{id}', '查詢 session 目前狀態'],
  ['GET', '/v1/catalog/platforms · /goals · /flows', '無狀態清單：平台、goal、已發布 flow'],
  ['GET', '/v1/catalog/flows/{id}/cards', '某 flow 的全部 Step Card'],
]

const TYPES: [string, string][] = [
  ['step', '一張 Step Card 與其文字、進度、可用動作（下一步、上一步、分岔、重新開始）'],
  ['clarification', '需要民眾選擇的問題與選項（平台、通道、goal、分岔、候選畫面），選項可附圖'],
  ['escalation', '系統無法處理，附錯誤碼與原因；由呼叫方決定如何回應民眾'],
  ['completed', 'flow 走完，附同平台其他 goal 的建議'],
]

const SNIPPET = `curl -X POST https://<your-host>/v1/sessions \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"external_user_id": "line:U123", "hint": "我要轉帳"}'`

export function ApiUsageGuide() {
  return (
    <Card title="如何使用">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">驗證與路徑</div>
            <p className="text-sm leading-6">
              每個請求帶 header <code className="rounded bg-background px-1 font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>，base path 為 <code className="rounded bg-background px-1 font-mono text-xs">/v1</code>。
              key 綁定 tenant，回應只會包含本 tenant 已發布的內容。
            </p>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-background-lite p-3 font-mono text-[11px] leading-5">{SNIPPET}</pre>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">端點</div>
            <ul className="divide-y divide-border rounded-lg border border-border text-xs">
              {ENDPOINTS.map(([m, p, d]) => (
                <li key={p} className="grid grid-cols-[44px_1fr] gap-2 px-3 py-1.5">
                  <span className={m === 'GET' ? 'font-mono font-semibold text-good' : 'font-mono font-semibold text-accent'}>{m}</span>
                  <span><code className="font-mono">{p}</code><div className="text-muted">{d}</div></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">回應型別（以 <code className="font-mono">type</code> 區分）</div>
            <p className="mb-2 text-xs text-muted">所有 session 端點回傳同一種聯合型別，呼叫方只要實作一個「把四種型別畫成訊息」的 renderer。</p>
            <ul className="divide-y divide-border rounded-lg border border-border text-xs">
              {TYPES.map(([t, d]) => (
                <li key={t} className="grid grid-cols-[100px_1fr] gap-2 px-3 py-1.5">
                  <code className="font-mono font-semibold">{t}</code><span className="text-muted">{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <Notice tone="accent">
            <strong>隱私：</strong>民眾上傳的截圖只在記憶體中處理，MayDru 不落地、不寫 log、不進入評測集或追蹤資料。呼叫方應直接轉傳圖片內容，不需先存檔。
            external_user_id 由呼叫方提供，只以雜湊保存。
          </Notice>
          <Notice>Step Card 圖片以公開、不可猜、含內容雜湊的 URL 提供（同時給原圖與預覽圖），可長期快取，適合 LINE 圖片訊息。</Notice>
        </div>
      </div>
    </Card>
  )
}
