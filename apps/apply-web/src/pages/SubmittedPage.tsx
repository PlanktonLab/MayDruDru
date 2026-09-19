/** `/apply/:scheme/done?case=HC-…` — 送件成功頁（SPEC §8.1「匿名」那條）。
 *
 * 匿名送件唯一的憑據就是這組編號，所以它要大、要能長按複製、要叫人截圖。
 * LINE 綁定的 deep link 帶著 case_no 過去，綁定與手機驗證在 LINE 裡完成（P2）。
 */

import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button, Card, EmptyState } from '@maydru/ui'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** `.env` 的 `VITE_LINE_OA_ID`，例如 `@maydru`；沒設定時不顯示綁定區塊。 */
const LINE_OA_ID = import.meta.env.VITE_LINE_OA_ID as string | undefined

export function lineDeepLink(caseNo: string, oaId: string | undefined): string | null {
  if (!oaId) return null
  return `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?case=${encodeURIComponent(caseNo)}`
}

function LineQr({ value }: { value: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    void QRCode.toDataURL(value, { width: 224, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (live) setSrc(url) })
    return () => { live = false }
  }, [value])
  return src
    ? <img src={src} width={112} height={112} alt="用 LINE 掃描追蹤案件的 QR code" className="size-28 rounded-xl" />
    : <span aria-label="正在產生 LINE QR code" className="size-28 animate-pulse rounded-xl bg-background-lite" />
}

export default function SubmittedPage() {
  const { scheme = '' } = useParams()
  const [params] = useSearchParams()
  const caseNo = params.get('case') ?? ''
  const deepLink = lineDeepLink(caseNo, LINE_OA_ID)

  if (!caseNo)
    return (
      <EmptyState
        title="找不到案件編號"
        hint="這個頁面需要從送出流程進來。如果你已經送出過，請用案件編號到查詢頁確認。"
        action={
          <Link to="/status">
            <Button variant="primary">前往查詢</Button>
          </Link>
        }
      />
    )

  return (
    <section className="md-risein space-y-5">
      <header className="text-center">
        <span
          aria-hidden
          className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-good-bg text-good"
        >
          <Check size={28} strokeWidth={3} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">已收到你的申請</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          接下來由承辦人員依送件順序審核。請先把這組編號記下來。
        </p>
      </header>

      <Card>
        <p className="text-[13px] text-muted">案件編號</p>
        <p className="mt-1 select-all break-all font-mono text-3xl font-semibold tracking-tight tabular-nums text-primary">
          {caseNo}
        </p>
        <p className="mt-3 rounded-xl bg-warn-bg px-3 py-2.5 text-[14px] leading-6 text-warn">
          請截圖保存。查詢進度、補件、撤回都需要這組編號加上你填的手機末四碼。
        </p>
      </Card>

      {deepLink && (
        <Card title="用 LINE 追蹤這件案子" subtitle="綁定後狀態一有變動就會主動通知你，不用自己回來查。">
          <div className="flex items-center gap-4">
            <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white">
              <LineQr value={deepLink} />
            </span>
            <div className="min-w-0 space-y-2">
              <p className="text-[13px] leading-5 text-muted">
                用手機的 LINE 掃描左邊的 QR code，或直接點下面的按鈕開啟官方帳號。
              </p>
              <a href={deepLink} className="block">
                <Button block>在 LINE 開啟</Button>
              </a>
            </div>
          </div>
        </Card>
      )}

      <Link to={`/status/${encodeURIComponent(caseNo)}`} className="block">
        <Button variant="primary" size="lg" block>
          查看案件進度
        </Button>
      </Link>
      <Link to={`/apply/${encodeURIComponent(scheme)}`} className="block">
        <Button variant="ghost" size="md" block>
          再申請一件
        </Button>
      </Link>
    </section>
  )
}
