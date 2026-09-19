/** 送件流程的狀態與每一步的過關條件（SPEC §8.1）。 */

import { describe, expect, it } from 'vitest'
import { expandSlots } from './docGroups'
import { toolGroups } from './toolGroups'
import {
  canLeave,
  channelErrors,
  clearDraft,
  identityErrors,
  initialState,
  loadDraft,
  missingDocuments,
  reducer,
  saveDraft,
  toolErrors,
  type ApplyState,
  type UploadedDoc,
} from './state'
import { SCHEME } from '../mocks/data'

function doc(code: string): UploadedDoc {
  return {
    document_type_code: code,
    blob: new Blob(['x']),
    previewUrl: 'blob:x',
    mime: 'image/jpeg',
    page_count: 1,
    masked: false,
    ocr: null,
    originalFormat: 'JPEG',
    qualityNote: null,
    fileName: `${code}.jpg`,
  }
}

function filled(): ApplyState {
  return {
    ...initialState('HCAI115'),
    tool: { name: 'Claude Pro', tool_id: 'tool-claude' },
    identity: {
      applicant_name: '測試用小明',
      phone: '0912345678',
      id_number: 'A123456789',
      email: 'test@example.com',
      tier_code: 'GENERAL',
    },
    channel: {
      payment_channel_code: 'CREDIT_CARD',
      paid_by_proxy: false,
      purchase_date: '2026-08-01',
      purchase_amount: '6000',
      billing_cycle: 'MONTHLY',
      billing_periods: 1,
      original_currency: 'USD',
      original_amount: '20',
    },
  }
}

describe('reducer', () => {
  it('下一步不會走出最後一步', () => {
    let state = { ...initialState('HCAI115'), stepIndex: 5 }
    state = reducer(state, { type: 'next' })
    expect(state.stepIndex).toBe(5)
  })

  it('上一步不會走到負的', () => {
    const state = reducer(initialState('HCAI115'), { type: 'back' })
    expect(state.stepIndex).toBe(0)
  })

  it('換繳費管道會清掉上一次的 precheck 結果', () => {
    let state = reducer(filled(), { type: 'precheck', verdict: 'FAIL', findings: [] })
    expect(state.precheck).not.toBeNull()
    state = reducer(state, { type: 'channel', patch: { payment_channel_code: 'TELECOM' } })
    expect(state.precheck).toBeNull()
  })

  it('只改金額不會清掉 precheck 以外的資料', () => {
    const state = reducer(filled(), { type: 'channel', patch: { purchase_amount: '7000' } })
    expect(state.channel.payment_channel_code).toBe('CREDIT_CARD')
    expect(state.channel.purchase_amount).toBe('7000')
  })

  it('上傳文件會收進 docs，移除會拿掉', () => {
    let state = reducer(initialState('HCAI115'), { type: 'doc', code: 'AFFIDAVIT', doc: doc('AFFIDAVIT') })
    expect(state.docs.AFFIDAVIT).toBeDefined()
    state = reducer(state, { type: 'dropDoc', code: 'AFFIDAVIT' })
    expect(state.docs.AFFIDAVIT).toBeUndefined()
  })

  it('restore 不會覆蓋已經上傳的文件', () => {
    const withDoc = reducer(initialState('HCAI115'), { type: 'doc', code: 'AFFIDAVIT', doc: doc('AFFIDAVIT') })
    const state = reducer(withDoc, { type: 'restore', draft: { stepIndex: 2 } })
    expect(state.stepIndex).toBe(2)
    expect(state.docs.AFFIDAVIT).toBeDefined()
  })
})

describe('草稿', () => {
  it('存取一輪之後欄位還在，但不含任何影像', () => {
    const state = reducer(filled(), { type: 'doc', code: 'AFFIDAVIT', doc: doc('AFFIDAVIT') })
    saveDraft('HCAI115', state)
    const raw = sessionStorage.getItem('maydru_apply_draft:HCAI115') ?? ''
    expect(raw).toContain('0912345678')
    expect(raw).not.toContain('blob:')
    expect(raw).not.toContain('AFFIDAVIT')
  })

  it('回來時退回「準備指引」之前，因為文件沒有被保存', () => {
    saveDraft('HCAI115', { ...filled(), stepIndex: 5 })
    expect(loadDraft('HCAI115')?.stepIndex).toBe(3)
  })

  it('清掉之後就讀不到了', () => {
    saveDraft('HCAI115', filled())
    clearDraft('HCAI115')
    expect(loadDraft('HCAI115')).toBeNull()
  })
})

describe('第 1 步 工具', () => {
  it('沒選工具不能過', () => {
    expect(toolErrors(initialState('HCAI115'), SCHEME).tool).toBeTruthy()
  })

  it('選到不予補助的工具會被擋，而且說得出原因', () => {
    const state = { ...initialState('HCAI115'), tool: { name: 'DeepSeek', tool_id: 'tool-deepseek' } }
    expect(toolErrors(state, SCHEME).tool).toContain('不予補助')
  })

  it('自行填寫的工具可以過（交給人工認定）', () => {
    const state = { ...initialState('HCAI115'), tool: { name: 'Perplexity Pro', tool_id: null } }
    expect(toolErrors(state, SCHEME)).toEqual({})
  })
})

describe('第 2 步 身分', () => {
  it('手機格式不對時說「怎麼填」而不是「錯了」', () => {
    const errors = identityErrors({ ...filled().identity, phone: '0912' })
    expect(errors.phone).toContain('0912345678')
  })

  it('基本資料五個欄位都填齊才過得去', () => {
    expect(identityErrors(filled().identity)).toEqual({})
    // 每一欄留空都要各自擋下來（D36 之後身分證與 email 也是必填）。
    expect(identityErrors({ ...filled().identity, applicant_name: '' }).applicant_name).toBeTruthy()
    expect(identityErrors({ ...filled().identity, id_number: '' }).id_number).toBeTruthy()
    expect(identityErrors({ ...filled().identity, email: '' }).email).toBeTruthy()
  })

  it('身分證字號要 1 個英文字母加 9 個數字', () => {
    expect(identityErrors({ ...filled().identity, id_number: 'A12345' }).id_number).toBeTruthy()
    expect(identityErrors({ ...filled().identity, id_number: '1234567890' }).id_number).toBeTruthy()
    // 小寫照樣收——送出前會轉大寫，不該因為大小寫擋人。
    expect(identityErrors({ ...filled().identity, id_number: 'a123456789' }).id_number).toBeFalsy()
  })

  it('沒選身分別不能過', () => {
    expect(identityErrors({ ...filled().identity, tier_code: '' }).tier_code).toBeTruthy()
  })
})

describe('第 3 步 購買明細', () => {
  it('管道、日期、兩個金額都必填', () => {
    const errors = channelErrors({
      payment_channel_code: '',
      paid_by_proxy: false,
      purchase_date: '',
      purchase_amount: '',
      billing_cycle: 'MONTHLY',
      billing_periods: 1,
      original_currency: 'USD',
      original_amount: '',
    })
    expect(Object.keys(errors).sort()).toEqual([
      'original_amount',
      'payment_channel_code',
      'purchase_amount',
      'purchase_date',
    ])
  })

  it('原始幣別是臺幣時不必再填一次原始金額', () => {
    const errors = channelErrors({ ...filled().channel, original_currency: 'TWD', original_amount: '' })
    expect(errors.original_amount).toBeFalsy()
  })

  it('金額不是正數會被擋', () => {
    expect(channelErrors({ ...filled().channel, purchase_amount: '0' }).purchase_amount).toBeTruthy()
    expect(channelErrors({ ...filled().channel, original_amount: '0' }).original_amount).toBeTruthy()
  })
})

describe('第 5 步 上傳', () => {
  const required = ['ID_CARD_FRONT', 'AFFIDAVIT']

  it('列出還缺的必備文件', () => {
    expect(missingDocuments(required, { ID_CARD_FRONT: doc('ID_CARD_FRONT') })).toEqual(['AFFIDAVIT'])
  })

  it('缺件時 canLeave 為 false', () => {
    expect(canLeave('docs', filled(), SCHEME, required)).toBe(false)
  })

  it('補齊之後就能進確認步驟', () => {
    const state = { ...filled(), docs: { ID_CARD_FRONT: doc('ID_CARD_FRONT'), AFFIDAVIT: doc('AFFIDAVIT') } }
    expect(canLeave('docs', state, SCHEME, required)).toBe(true)
  })

  it('準備指引那一步永遠可以往前', () => {
    expect(canLeave('guide', initialState('HCAI115'), SCHEME, required)).toBe(true)
  })
})

describe('工具選單的分組', () => {
  /** 伺服器的 `eligible_tools.id` 是隨機的（`new_id`），不是 `tool-chatgpt`。 */
  const withRandomIds = SCHEME.eligible_tools.map((tool, index) => ({ ...tool, id: `x9f2a${index}` }))

  it('id 換成伺服器那種隨機值時，分組仍然有東西——不能靠 id 比對', () => {
    const groups = toolGroups(withRandomIds)
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.flatMap((group) => group.tools).length).toBeGreaterThan(0)
  })

  it('不予補助的工具不列在選單上', () => {
    const names = toolGroups(withRandomIds).flatMap((group) => group.tools.map((tool) => tool.name))
    expect(names.join('|')).not.toContain('DeepSeek')
    expect(names.join('|')).not.toContain('Poe.com')
  })

  it('關鍵字表沒收錄的可補助工具落到「其他」，不會安靜消失', () => {
    const extra = [...withRandomIds, { ...withRandomIds[0], id: 'zz1', name: '某個新收錄的工具', status: 'APPROVED' as const }]
    const names = toolGroups(extra).flatMap((group) => group.tools.map((tool) => tool.name))
    expect(names).toContain('某個新收錄的工具')
  })
})

describe('多期申請的上傳欄位', () => {
  const types = SCHEME.document_types.filter((type) =>
    ['ID_CARD_FRONT', 'OFFICIAL_RECEIPT', 'BILLING_STATEMENT', 'BANKBOOK_COVER'].includes(type.code),
  )

  it('單期時欄位就是文件類型本身', () => {
    expect(expandSlots(types, 1).map((slot) => slot.key)).toEqual(types.map((type) => type.code))
  })

  it('多期時收據與繳款憑證每期各一份，其餘仍是一份', () => {
    const keys = expandSlots(types, 3).map((slot) => slot.key)
    // 身分證與存摺與期數無關。
    expect(keys.filter((key) => key.startsWith('ID_CARD_FRONT'))).toEqual(['ID_CARD_FRONT'])
    expect(keys.filter((key) => key.startsWith('BANKBOOK_COVER'))).toEqual(['BANKBOOK_COVER'])
    // 收據與帳單各展開成三份。
    expect(keys.filter((key) => key.startsWith('OFFICIAL_RECEIPT'))).toEqual([
      'OFFICIAL_RECEIPT_1',
      'OFFICIAL_RECEIPT_2',
      'OFFICIAL_RECEIPT_3',
    ])
    expect(keys.filter((key) => key.startsWith('BILLING_STATEMENT'))).toHaveLength(3)
  })

  it('展開後的欄位名稱帶上期數，才分得出是哪一期', () => {
    const receipts = expandSlots(types, 2).filter((slot) => slot.code === 'OFFICIAL_RECEIPT')
    expect(receipts.map((slot) => slot.label)).toEqual(['官方收據（第 1 期）', '官方收據（第 2 期）'])
  })
})
