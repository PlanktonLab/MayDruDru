/** 取件小幫手的前端契約。
 *
 * 後端目前**還沒有**市民能用的對話端點：`/api/playground/*` 每一支都掛
 * `Depends(current_user)`，也就是要 admin 登入，而申請端是匿名的（SPEC §8.1）。
 * 要接上去得先做三件事：
 *
 *   1. 新增公開端點（仿 `routers/sop.py`：匿名 + `rate_limit` guard），
 *      ChatEngine 本身可以直接重用；
 *   2. 先改 SPEC §8.1 與 §10 的端點清單，並在 §18 記一個決策
 *      （把 LLM 對話開給匿名流量的理由與限制）——工作規則 1；
 *   3. 想清楚 rate limit 與每則對話的成本。
 *
 * 所以這支預設是關的：`VITE_HELP_CHAT=1` 才會在畫面上出現。
 */

export interface HelpChatMessage {
  role: 'user' | 'assistant'
  text: string
}

/** `.env` 的 `VITE_HELP_CHAT=1`；沒開時整個泡泡不掛上去。 */
export const helpChatEnabled = import.meta.env.VITE_HELP_CHAT === '1'

/** 端點還沒有，所以這裡只有形狀。接上之後改成打真的 API。 */
export async function sendHelpChat(_text: string): Promise<HelpChatMessage> {
  throw new Error('help chat endpoint not implemented')
}
