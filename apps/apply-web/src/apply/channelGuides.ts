/** 依繳費方式分流的取件教學（移植自原專案的 `lib/guides.ts`）。
 *
 * 訪談依據：「民眾提交的資料未必齊全或**找不到**訂閱相關憑證收據。」
 * 「找不到」定義了問題的性質——這是資訊落差，不是民眾不配合。所以第 4 步
 * 要在開相機之前就把「去哪裡找、找到之後要看得到什麼」講完。
 *
 * 這個檔案只有資料、沒有邏輯：新增一個繳費管道應該是加一筆資料而不是改程式。
 * 教學內容未來會移到 `contents`（承辦人可自行編修），現在先放前端當預設值。
 */

export interface GuideStepItem {
  text: string
  /** 補充說明，放在該步驟下面一行灰字。 */
  tip?: string
}

export interface ChannelGuide {
  /** 對應 `payment_channels[].code`。 */
  channel: string
  title: string
  steps: GuideStepItem[]
  /** 送出前要確認看得到的欄位；這是最常被退件的那幾項。 */
  mustShow: string[]
  /** 合格範例圖（`public/samples/`）。民眾是在對照，不是在閱讀——
   *  一張標好必要欄位的圖比整段文字有效得多。 */
  sampleImage: string
  sampleCaption: string
}

export const CHANNEL_GUIDES: ChannelGuide[] = [
  {
    channel: 'CREDIT_CARD',
    title: '信用卡繳費需附資訊',
    steps: [
      {
        text: '信用卡圖片',
        tip: '需能清楚辨識看得到持卡人姓名、簽名、卡號末四碼。前 12 碼可遮。',
      },
      {
        text: '信用卡帳單的該筆扣款紀錄',
        tip: '在網銀或銀行 APP 的「信用卡 → 帳單查詢」找扣款月份的明細。',
      },
    ],
    mustShow: [
      '（卡片）持卡本人姓名、簽名、卡號末四碼',
      '（帳單）刷卡本人姓名',
      '（帳單）卡號末四碼',
      '（帳單）購買品項名稱',
      '（帳單）臺幣金額',
    ],
    sampleImage: '/samples/billing-credit-card.svg',
    sampleCaption: '合格範例：帳單扣款紀錄的四個必要欄位',
  },
  {
    channel: 'TELECOM',
    title: '電信繳費需附資訊',
    steps: [
      {
        text: '電信帳單上該筆代收的明細',
        tip: '在電信業者網站或 APP 的「帳單查詢」找費用那個月，下載 PDF 或截圖明細頁。',
      },
    ],
    mustShow: ['繳款人', '電話末三碼', '購買品項名稱', '臺幣金額'],
    sampleImage: '/samples/billing-telecom.svg',
    sampleCaption: '合格範例：電信帳單的四個必要欄位',
  },
  {
    channel: 'E_PAYMENT',
    title: '電子支付繳費需附資訊',
    steps: [
      { text: '支付帳戶的持有人資料', tip: '在 APP 的「我的帳戶」截圖看得到姓名的那頁，餘額可遮。' },
      { text: '該筆付款的交易明細', tip: '在「交易紀錄」點進那筆付款的明細頁再截圖，列表頁資訊不夠。' },
    ],
    mustShow: ['支付帳戶持有人姓名', '付款日期', '付款金額', '購買品項名稱'],
    sampleImage: '/samples/billing-epayment.svg',
    sampleCaption: '合格範例：交易明細的三個必要欄位',
  },
  {
    channel: 'OTHER',
    title: '其他繳費需附資訊',
    steps: [
      { text: '可辨識戶名的資料', tip: '例如網銀顯示戶名的頁面，或金融卡正面（卡號可遮）。' },
      { text: '該筆付款的明細', tip: '轉帳就是轉帳紀錄或匯款單。沒有品項名稱時可另附官方收據。' },
    ],
    mustShow: ['付款帳戶持有人姓名', '付款日期', '付款金額', '購買品項名稱'],
    sampleImage: '/samples/manual-assist.svg',
    sampleCaption: '特殊格式一律走人工，不會被系統擋住',
  },
]

/** 查不到就回 null——沒有教學不該擋住流程，下面的文件清單照樣列得出來。 */
export function guideFor(channelCode: string): ChannelGuide | null {
  return CHANNEL_GUIDES.find((guide) => guide.channel === channelCode) ?? null
}
