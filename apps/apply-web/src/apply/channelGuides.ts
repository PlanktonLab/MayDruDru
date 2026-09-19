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
    title: '信用卡繳費：要準備兩份憑證',
    steps: [
      {
        text: '這一類要附兩份，兩份證明的是不同的事',
        tip: '①信用卡圖片證明「這張卡是你的」　②帳單扣款紀錄證明「這張卡付了這筆錢」。缺一不可。',
      },
      { text: '第一份：拍你的信用卡', tip: '需看得到持卡本人姓名、簽名，以及卡號末四碼。' },
      {
        text: '卡號前 12 碼可以遮起來',
        tip: '簡章明載：信用卡背面其他卡號因涉及個資，可以隱藏或馬賽克。系統會幫你自動遮。',
      },
      { text: '第二份：登入網路銀行或銀行 APP →「信用卡」→「帳單查詢」' },
      { text: '選擇這筆訂閱扣款的那個月份，下載或截圖該筆交易' },
      {
        text: '⚠️ 帳單須看得到四項：刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額',
        tip: '只有外幣金額不算。這是最常被退件的一項。',
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
    title: '電信繳費：怎麼拿到電信帳單',
    steps: [
      {
        text: '確認這筆費用真的在電信帳單上',
        tip: '電信代收常見於 Google Play 或部分 App 內購買。若是信用卡直接扣款，請改選「信用卡繳費」。',
      },
      { text: '登入你的電信業者網站或 APP（中華電信、台灣大哥大、遠傳等）' },
      { text: '找到「帳單查詢」或「電子帳單」' },
      { text: '選擇這筆費用出現的那個月份' },
      { text: '下載帳單 PDF，或截圖含該筆代收項目的明細頁' },
      {
        text: '⚠️ 帳單須看得到四項：繳款人、電話末三碼、購買品項名稱、臺幣金額',
        tip: '電信帳單本來就是臺幣，不需另外換算。',
      },
    ],
    mustShow: ['繳款人', '電話末三碼', '購買品項名稱', '臺幣金額'],
    sampleImage: '/samples/billing-telecom.svg',
    sampleCaption: '合格範例：電信帳單的四個必要欄位',
  },
  {
    channel: 'E_PAYMENT',
    title: '電子支付繳費：需要兩份文件',
    steps: [
      { text: '這一類要附兩份，不是擇一', tip: '①支付帳戶為你本人的證明　②交易明細。兩份都要。' },
      {
        text: '第一份：打開你的支付 APP，找到「我的帳戶」或「個人資料」',
        tip: 'LINE Pay、街口支付、PayPal、悠遊付等皆可',
      },
      { text: '截圖能看到你姓名的那一頁', tip: '重點是證明這個帳戶是你本人的。帳戶餘額可以遮起來。' },
      { text: '第二份：回到「交易紀錄」或「付款記錄」，找到這筆 AI 工具的付款' },
      { text: '點進該筆交易的明細頁，截圖' },
      {
        text: '⚠️ 明細須看得到三項：付款日期、付款金額、購買品項名稱',
        tip: 'PayPal 若以外幣付款，明細頁會顯示匯率與換算後金額——請確認臺幣金額看得到。',
      },
    ],
    mustShow: ['支付帳戶持有人姓名', '付款日期', '付款金額', '購買品項名稱'],
    sampleImage: '/samples/billing-epayment.svg',
    sampleCaption: '合格範例：交易明細的三個必要欄位',
  },
  {
    channel: 'OTHER',
    title: '其他繳費：需要兩份文件',
    steps: [
      { text: '這一類要附兩份，不是擇一', tip: '①可證明該支付帳戶為你本人的資料　②付款明細。兩份都要。' },
      {
        text: '第一份：證明付款帳戶是你本人的',
        tip: '例如網銀顯示戶名的頁面、金融卡正面（卡號可遮）、帳戶開戶資料等',
      },
      { text: '第二份：找到這筆付款的明細' },
      { text: '轉帳的話是轉帳紀錄或匯款單；其他方式則是對應的付款證明' },
      {
        text: '⚠️ 明細須看得到三項：付款日期、付款金額、購買品項名稱',
        tip: '若付款明細上沒有品項名稱，可另外附官方收據或訂單確認信補足。',
      },
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
