/** What the assistant did in one turn — tool calls, the screenshot read, model rounds, usage. Hidden until asked for. */
import type { ChatLocateDebug, ChatTurnDebug } from '../../lib/types'

export interface TurnRecord { id: string; index: number; userText: string; debug: ChatTurnDebug | null }

const num = (n: number | undefined, digits = 0) => (n == null ? '—' : n.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits }))
const Json = ({ value }: { value: unknown }) => <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2.5 font-mono text-[11px] leading-5">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>

const OUTCOME_LABEL: Record<ChatLocateDebug['outcome'], string> = {
  located: '已定位', ambiguous: '不確定', off_flow: '不在流程內', unknown_platform: '平台不明',
  not_app_screen: '非 App 畫面', not_a_screenshot: '非螢幕截圖', unreadable: '無法辨識',
}

/** One labelled line; renders nothing when there is nothing to say. */
const Line = ({ label, children }: { label: string; children?: React.ReactNode }) =>
  children ? <div className="flex gap-2 leading-5"><span className="w-16 shrink-0 text-muted">{label}</span><span className="min-w-0 flex-1 break-words">{children}</span></div> : null

/** 截圖判讀 — what the retrieval ladder made of the citizen's picture, and what it decided to do. */
function LocateSection({ l }: { l: ChatLocateDebug }) {
  const g = l.guidance
  const texts = l.screen?.structural_texts ?? []
  const candidates = l.candidates ?? []
  const kind = [l.kind, l.photographed ? '翻拍' : ''].filter(Boolean).join('・')
  return (
    <section className="space-y-2">
      <div className="text-xs font-semibold text-muted">截圖判讀</div>
      <div className="space-y-1 text-[12px]">
        <Line label="結果">{OUTCOME_LABEL[l.outcome] ?? l.outcome}　<span className="text-muted">信心 {Math.round((l.confidence ?? 0) * 100)}%</span></Line>
        <Line label="畫面類型">{kind}</Line>
        <Line label="平台猜測">{l.platform_guess}</Line>
        <Line label="關係">{l.relation}</Line>
        <Line label="差異">{l.difference}</Line>
        <Line label="理由">{l.reason}</Line>
        <Line label="建議">{g?.advice}</Line>
      </div>
      {candidates.length > 0 && (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-[11px]">
            <thead className="bg-background text-left text-muted">
              <tr><th className="px-2 py-1 font-medium">流程／步驟</th><th className="px-2 py-1 text-right font-medium">score</th><th className="px-2 py-1 text-right font-medium">lexical</th><th className="px-2 py-1 text-right font-medium">distance</th></tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr key={c.variant_id ?? i} className="border-t border-border">
                  <td className="px-2 py-1"><span className="text-muted">{c.flow_name}</span>　{c.step_title}</td>
                  <td className="px-2 py-1 text-right">{num(c.score ?? undefined, 3)}</td>
                  <td className="px-2 py-1 text-right">{num(c.lexical ?? undefined, 3)}</td>
                  <td className="px-2 py-1 text-right">{num(c.distance ?? undefined, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {texts.length > 0 && <div className="text-[11px] leading-5 text-muted">畫面文字：{texts.join('、')}</div>}
    </section>
  )
}

export default function TurnInspector({ turn }: { turn: TurnRecord | null }) {
  if (!turn) return <div className="p-6 text-center text-sm text-muted">送出一則訊息後，這裡會顯示客服在那一回合做了什麼。點任一則客服訊息可切換回合。</div>
  const d = turn.debug
  const usage = d?.usage ?? []
  const cost = usage.reduce((a, u) => a + (u.cost_usd ?? 0), 0)
  const tokens = usage.reduce((a, u) => a + (u.input_tokens ?? 0) + (u.output_tokens ?? 0), 0)
  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <div className="text-[11px] text-muted">回合 {turn.index}</div>
        <div className="mt-0.5 truncate font-medium" title={turn.userText}>{turn.userText || '（截圖）'}</div>
        {d && <div className="mt-1 text-xs text-muted">{num(d.elapsed_ms)} ms · 模型 {d.rounds ?? 0} 輪 · 工具 {d.tool_calls?.length ?? 0} 次 · {num(tokens)} tokens · ${cost.toFixed(4)}</div>}
      </div>

      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted">工具呼叫</div>
        {!d?.tool_calls?.length ? <div className="text-xs text-muted">這一回合客服沒有呼叫工具。</div> : d.tool_calls.map((c, i) => (
          <details key={i} className="rounded-lg border border-border" open={i === 0}>
            <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs">
              <code className="font-mono font-medium">{c.name}</code>
              <span className="ml-auto text-muted">{num(c.ms)} ms</span>
            </summary>
            <div className="space-y-1.5 border-t border-border p-2">
              <div className="text-[11px] text-muted">參數</div>
              <Json value={c.args} />
              <div className="text-[11px] text-muted">結果</div>
              <Json value={c.result} />
            </div>
          </details>
        ))}
      </section>

      {d?.locate && <LocateSection l={d.locate} />}

      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted">模型呼叫</div>
        {usage.length === 0 ? <div className="text-xs text-muted">無</div> : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-[11px]">
              <thead className="bg-background text-left text-muted">
                <tr><th className="px-2 py-1 font-medium">任務</th><th className="px-2 py-1 font-medium">模型</th><th className="px-2 py-1 text-right font-medium">輸入</th><th className="px-2 py-1 text-right font-medium">輸出</th><th className="px-2 py-1 text-right font-medium">ms</th></tr>
              </thead>
              <tbody>
                {usage.map((u, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{u.task}</td><td className="truncate px-2 py-1">{u.model ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{num(u.input_tokens)}</td><td className="px-2 py-1 text-right">{num(u.output_tokens)}</td><td className="px-2 py-1 text-right">{num(u.latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d?.state && (
        <section className="space-y-2">
          <div className="text-xs font-semibold text-muted">對話狀態</div>
          <Json value={d.state} />
        </section>
      )}
    </div>
  )
}
