export interface HelpChatMessage {
  role: 'user' | 'assistant'
  text: string
}
export const helpChatEnabled = import.meta.env.VITE_HELP_CHAT !== '0'

export async function sendHelpChat(text: string, schemeCode = ''): Promise<HelpChatMessage> {
  const response = await fetch('/api/apply/help-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, scheme_code: schemeCode }),
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.detail?.message ?? '目前無法查詢，請稍後再試。')
  return { role: 'assistant', text: body.text }
}
