/** 每個文件類型的合格範例圖（`public/samples/`）。
 *
 * 民眾是在對照，不是在閱讀：一張標好必要欄位的圖，比「需看得到持卡本人姓名、
 * 簽名與卡號末四碼」這句話有效得多。上傳前可以點開看，傳完就收起來——
 * 已經傳好的人不需要再看範例。
 *
 * 身分證的兩張是內政部公告的證件樣本（印有「樣本」浮水印、姓名與號碼皆為範例），
 * 其餘是虛構資料製作的示意圖，都沒有真實個資（CLAUDE.md 規則 9）。
 */

const SAMPLES: Record<string, string> = {
  ID_CARD_FRONT: '/samples/id-front.jpg',
  ID_CARD_BACK: '/samples/id-back.jpg',
  OFFICIAL_RECEIPT: '/samples/receipt.svg',
  CARD_LAST4_PHOTO: '/samples/card-last4.svg',
  BILLING_STATEMENT: '/samples/billing-credit-card.svg',
  TELECOM_BILL: '/samples/billing-telecom.svg',
  PAYER_ACCOUNT_PROOF: '/samples/billing-epayment.svg',
  TRANSACTION_DETAIL: '/samples/billing-epayment.svg',
  BANKBOOK_COVER: '/samples/bankbook.svg',
  AFFIDAVIT: '/samples/affidavit.svg',
  PROXY_AFFIDAVIT: '/samples/affidavit.svg',
  SPECIAL_STATUS_PROOF: '/samples/low-income-proof.svg',
}

/** 沒有範例圖的類型回 null——沒有就不顯示那顆按鈕，不要給一個點了沒東西的連結。 */
export function sampleFor(code: string): string | null {
  return SAMPLES[code] ?? null
}
