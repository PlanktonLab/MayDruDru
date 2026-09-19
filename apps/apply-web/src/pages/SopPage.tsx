/** `/sop` 與 `/sop/:flow` — 取得文件的教學（SPEC §8.1、§16 P4）。
 *
 * P3 只把路由與版面立起來：送件流程與退件說明都已經連到這裡並帶著 `?document_type=`，
 * P4 接上 SOP 服務之後，同一個網址就會變成逐步的 step card，連結不會失效。
 */

import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Map } from 'lucide-react'
import { Button, Card, EmptyState } from '@maydru/ui'

/** 只有標籤，沒有教學內容——標籤讓這一頁至少能回答「你現在在找哪一份」。 */
const DOCUMENT_LABEL: Record<string, string> = {
  ID_CARD_FRONT: '身分證正面',
  ID_CARD_BACK: '身分證反面',
  OFFICIAL_RECEIPT: '官方收據',
  BILLING_STATEMENT: '信用卡帳單扣款紀錄',
  CARD_LAST4_PHOTO: '信用卡圖片',
  TELECOM_BILL: '電信帳單',
  PAYER_ACCOUNT_PROOF: '支付帳戶為本人之證明',
  TRANSACTION_DETAIL: '交易明細',
  BANKBOOK_COVER: '存摺封面影本',
  AFFIDAVIT: '切結書',
  PROXY_AFFIDAVIT: '代為支付切結書',
  SPECIAL_STATUS_PROOF: '特定對象證明',
}

export default function SopPage() {
  const [params] = useSearchParams()
  const { flow } = useParams()
  const documentType = params.get('document_type') ?? ''
  const label = DOCUMENT_LABEL[documentType]

  return (
    <section className="md-risein space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {label ? `怎麼取得「${label}」` : '取得文件的教學'}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          {label
            ? '逐步教學會帶你從手機或網站上找到這一份文件。'
            : '選一份你不知道去哪裡拿的文件，這裡會一步一步帶你操作。'}
        </p>
      </header>

      <EmptyState
        icon={<Map size={20} />}
        title="逐步教學正在製作中"
        hint="這一段會在下一個階段上線（SPEC §16 P4）。在那之前，你可以先看常見問題，或直接洽承辦單位。"
        action={
          <Link to="/help">
            <Button variant="primary">看常見問題</Button>
          </Link>
        }
      />

      {(documentType || flow) && (
        <Card title="你正在找的" subtitle="這組資訊會直接帶到即將上線的教學頁。">
          <dl className="space-y-1.5 text-[14px]">
            {documentType && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted">文件類型</dt>
                <dd className="font-mono text-primary">{documentType}</dd>
              </div>
            )}
            {flow && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted">教學流程</dt>
                <dd className="font-mono text-primary">{flow}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <Link to="/" className="inline-flex">
        <Button variant="ghost" icon={<ArrowLeft size={16} />}>
          回首頁
        </Button>
      </Link>
    </section>
  )
}
