/** `/status` — 輸入案件編號 + 末四碼（SPEC §8.1）。 */

import { useNavigate } from 'react-router-dom'
import { VerifyForm } from '../status/VerifyForm'

export default function StatusPage() {
  const navigate = useNavigate()
  return (
    <section className="md-risein space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">查詢進度</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          不需要登入。需要補件或想撤回申請時，也從這裡進去。
        </p>
      </header>
      <VerifyForm onVerified={(caseNo) => navigate(`/status/${encodeURIComponent(caseNo)}`)} />
      <p className="text-[13px] leading-5 text-muted">
        忘記案件編號了嗎？如果你已經在 LINE 綁定過這件案子，在官方帳號輸入「我的案件」就能查到。
      </p>
    </section>
  )
}
