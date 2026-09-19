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
        text: '本類須附兩份憑證，證明的事項不同',
        tip: '信用卡圖片證明持卡人身分，帳單扣款紀錄證明該筆訂閱確實由這張卡扣款，兩者缺一不可。',
      },
      {
        text: '第一份為信用卡圖片，須清楚顯示持卡人姓名、簽名與卡號末四碼',
        tip: '卡號前 12 碼可遮蔽。簡章明載其他卡號涉及個資，可隱藏或馬賽克，系統亦會自動遮罩。',
      },
      {
        text: '第二份為帳單上的該筆扣款紀錄',
        tip: '於網路銀行或銀行 APP 的「信用卡 → 帳單查詢」，選擇該筆訂閱扣款的月份，下載或截圖該筆交易。',
      },
      {
        text: '⚠️ 帳單須同時顯示四項：刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額',
        tip: '僅有外幣金額不符規定，須為換算後的臺幣金額。此為最常見的退件原因。',
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
    title: '電信繳費：要準備電信帳單',
    steps: [
      {
        text: '請先確認該筆費用確實列於電信帳單',
        tip: '電信代收常見於 Google Play 或部分 App 內購買。若實際為信用卡直接扣款，請回上一步改選「信用卡繳費」，應附憑證不同。',
      },
      {
        text: '帳單可於電信業者網站或 APP 取得',
        tip: '中華電信、台灣大哥大、遠傳等皆同：登入後進入「帳單查詢」或「電子帳單」，選擇該筆費用所屬月份，下載 PDF 或截圖含該筆代收項目的明細頁。',
      },
      {
        text: '⚠️ 帳單須同時顯示四項：繳款人、電話末三碼、購買品項名稱、臺幣金額',
        tip: '電信帳單原即為臺幣計價，無須另行換算。',
      },
    ],
    mustShow: ['繳款人', '電話末三碼', '購買品項名稱', '臺幣金額'],
    sampleImage: '/samples/billing-telecom.svg',
    sampleCaption: '合格範例：電信帳單的四個必要欄位',
  },
  {
    channel: 'E_PAYMENT',
    title: '電子支付繳費：要準備兩份文件',
    steps: [
      {
        text: '本類須附兩份文件，證明的事項不同',
        tip: '支付帳戶須為申請人本人，故帳戶持有人證明與交易明細兩者皆須檢附，不得擇一。',
      },
      {
        text: '第一份為支付帳戶的持有人資料',
        tip: 'LINE Pay、街口支付、PayPal、悠遊付等皆同：於 APP 的「我的帳戶」或「個人資料」截圖顯示姓名的頁面，帳戶餘額可遮蔽。',
      },
      {
        text: '第二份為該筆付款的交易明細',
        tip: '於「交易紀錄」或「付款記錄」找到該筆 AI 工具付款，點入明細頁後截圖；列表頁所載資訊通常不足。',
      },
      {
        text: '⚠️ 明細須同時顯示三項：付款日期、付款金額、購買品項名稱',
        tip: 'PayPal 以外幣付款時，明細頁會顯示匯率與換算後金額，請確認臺幣金額清楚可見。',
      },
    ],
    mustShow: ['支付帳戶持有人姓名', '付款日期', '付款金額', '購買品項名稱'],
    sampleImage: '/samples/billing-epayment.svg',
    sampleCaption: '合格範例：交易明細的三個必要欄位',
  },
  {
    channel: 'OTHER',
    title: '其他繳費：要準備兩份文件',
    steps: [
      {
        text: '本類須附兩份文件，證明的事項不同',
        tip: '付款帳戶須為申請人本人，故帳戶持有人證明與付款明細兩者皆須檢附，不得擇一。',
      },
      {
        text: '第一份為可辨識戶名的資料',
        tip: '例如網路銀行顯示戶名的頁面、金融卡正面（卡號可遮蔽），或帳戶開戶資料。',
      },
      {
        text: '第二份為該筆付款的明細',
        tip: '轉帳者為轉帳紀錄或匯款單，其他方式則檢附對應的付款證明。',
      },
      {
        text: '⚠️ 明細須同時顯示三項：付款日期、付款金額、購買品項名稱',
        tip: '付款明細未載品項名稱者，可另附官方收據或訂單確認信補足。',
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
