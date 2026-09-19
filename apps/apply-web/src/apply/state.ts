/** 送件流程的狀態（SPEC §8.1 的 6 步）。
 *
 * 一個 reducer 管全部，草稿鏡到 `sessionStorage`——手機上切出去接個電話再回來，
 * 填過的欄位還在。**影像永遠不寫進 storage**：原圖不離開記憶體是硬規則（SPEC §11），
 * 而且一張 2400px 的 JPEG 也塞不進 5 MB 的配額。
 */

import type { OcrResult } from '@maydru/ocr'
import type { Finding, SchemePublic, Verdict } from '../lib/types'
import { matchTool } from './toolVerdict'

export const STEP_KEYS = ['tool', 'identity', 'channel', 'guide', 'docs', 'confirm'] as const
export type StepKey = (typeof STEP_KEYS)[number]

export const STEPS = [
  { key: 'tool', label: '工具' },
  { key: 'identity', label: '身分' },
  { key: 'channel', label: '繳費' },
  { key: 'guide', label: '準備' },
  { key: 'docs', label: '上傳' },
  { key: 'confirm', label: '確認' },
] as const

export const STEP_TITLE: Record<StepKey, string> = {
  tool: '確認申請工具',
  identity: '填寫申請人資料',
  channel: '你怎麼付這筆錢？',
  guide: '要準備哪些文件',
  docs: '上傳文件',
  confirm: '確認並送出',
}

export const STEP_LEAD: Record<StepKey, string> = {
  tool: '先確認工具是否符合補助資格，免得文件都準備好了才發現不能申請。',
  identity: '這些資料只用於本次申請與通知。手機與身分證只保留末四碼，不存完整號碼。',
  channel: '付款方式決定你要準備哪幾份憑證，選錯會被退件。',
  guide: '下面這幾份是這次要準備的文件。不確定去哪裡找的，點「教我怎麼取得」。',
  docs: '照片會在你的手機上處理完才上傳，原圖不會離開這支手機。',
  confirm: '確認資料無誤後送出。送出後會拿到一組案件編號，請截圖保存。',
}

/** 一份已經處理完、可以送出的文件。`blob` 是遮罩後的 JPEG／PDF 頁面合併圖。 */
export interface UploadedDoc {
  document_type_code: string
  /** 真正會離開瀏覽器的那份影像（遮罩已燒進去）。 */
  blob: Blob
  /** `URL.createObjectURL(blob)`，離開畫面時要 revoke。 */
  previewUrl: string
  mime: string
  page_count: number
  masked: boolean
  ocr: OcrResult | null
  /** 原始檔案格式，例如 `HEIC`；顯示「已轉 JPEG」用。 */
  originalFormat: string
  /** 品質警告（模糊／過暗）；不擋送出，但要讓市民看見。 */
  qualityNote: string | null
  fileName: string
}

export interface Identity {
  applicant_name: string
  phone: string
  id_last4: string
  email: string
  tier_code: string
}

export interface ChannelInfo {
  payment_channel_code: string
  paid_by_proxy: boolean
  purchase_date: string
  purchase_amount: string
}

export interface ToolChoice {
  /** 工具名稱；選「其他」時是市民自己填的字。 */
  name: string
  /** 收錄在 `eligible_tools` 時的 id，否則 null（由承辦人工認定）。 */
  tool_id: string | null
}

export interface ApplyState {
  scheme_code: string
  stepIndex: number
  tool: ToolChoice
  identity: Identity
  channel: ChannelInfo
  docs: Record<string, UploadedDoc>
  /** 「請人工協助」逃生門：precheck FAIL 時仍可送出，由承辦人工檢視。 */
  manualAssist: boolean
  /** 上一次 precheck 的結果，`confirm` 步驟顯示用。 */
  precheck: { verdict: Verdict; findings: Finding[] } | null
}

export function initialState(schemeCode: string): ApplyState {
  return {
    scheme_code: schemeCode,
    stepIndex: 0,
    tool: { name: '', tool_id: null },
    identity: { applicant_name: '', phone: '', id_last4: '', email: '', tier_code: '' },
    channel: { payment_channel_code: '', paid_by_proxy: false, purchase_date: '', purchase_amount: '' },
    docs: {},
    manualAssist: false,
    precheck: null,
  }
}

export type ApplyAction =
  | { type: 'goto'; index: number }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'tool'; tool: ToolChoice }
  | { type: 'identity'; patch: Partial<Identity> }
  | { type: 'channel'; patch: Partial<ChannelInfo> }
  | { type: 'doc'; code: string; doc: UploadedDoc }
  | { type: 'dropDoc'; code: string }
  | { type: 'manualAssist'; value: boolean }
  | { type: 'precheck'; verdict: Verdict; findings: Finding[] }
  | { type: 'restore'; draft: Partial<ApplyState> }
  | { type: 'reset'; scheme_code: string }

function clampStep(index: number): number {
  return Math.min(Math.max(index, 0), STEPS.length - 1)
}

export function reducer(state: ApplyState, action: ApplyAction): ApplyState {
  switch (action.type) {
    case 'goto':
      return { ...state, stepIndex: clampStep(action.index) }
    case 'next':
      return { ...state, stepIndex: clampStep(state.stepIndex + 1) }
    case 'back':
      return { ...state, stepIndex: clampStep(state.stepIndex - 1) }
    case 'tool':
      return { ...state, tool: action.tool }
    case 'identity':
      return { ...state, identity: { ...state.identity, ...action.patch } }
    case 'channel': {
      const channel = { ...state.channel, ...action.patch }
      // 換繳費管道等於換一整組憑證：舊的那幾份留著只會讓人以為已經傳好了。
      const changedChannel =
        action.patch.payment_channel_code !== undefined &&
        action.patch.payment_channel_code !== state.channel.payment_channel_code
      return changedChannel ? { ...state, channel, precheck: null } : { ...state, channel }
    }
    case 'doc':
      return { ...state, docs: { ...state.docs, [action.code]: action.doc }, precheck: null }
    case 'dropDoc': {
      const docs = { ...state.docs }
      delete docs[action.code]
      return { ...state, docs, precheck: null }
    }
    case 'manualAssist':
      return { ...state, manualAssist: action.value }
    case 'precheck':
      return { ...state, precheck: { verdict: action.verdict, findings: action.findings } }
    case 'restore':
      return { ...state, ...action.draft, docs: state.docs }
    case 'reset':
      return initialState(action.scheme_code)
    default:
      return state
  }
}

/* ───────────────────────── 草稿的存與取 ───────────────────────── */

const DRAFT_PREFIX = 'maydru_apply_draft:'

/** 只有純文字欄位進得了 storage；`docs` 與 precheck 結果一律不存。 */
export interface ApplyDraft {
  stepIndex: number
  tool: ToolChoice
  identity: Identity
  channel: ChannelInfo
  manualAssist: boolean
}

export function toDraft(state: ApplyState): ApplyDraft {
  return {
    stepIndex: state.stepIndex,
    tool: state.tool,
    identity: state.identity,
    channel: state.channel,
    manualAssist: state.manualAssist,
  }
}

export function saveDraft(schemeCode: string, state: ApplyState): void {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + schemeCode, JSON.stringify(toDraft(state)))
  } catch {
    /* 無痕模式或配額滿了就不存草稿，流程本身照常。 */
  }
}

export function loadDraft(schemeCode: string): Partial<ApplyState> | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + schemeCode)
    if (!raw) return null
    const draft = JSON.parse(raw) as ApplyDraft
    // 草稿裡沒有文件，所以回到上傳或確認步驟只會看到空的欄位——直接退回「準備指引」。
    const stepIndex = Math.min(draft.stepIndex ?? 0, 3)
    return { ...draft, stepIndex: clampStep(stepIndex) }
  } catch {
    return null
  }
}

export function clearDraft(schemeCode: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + schemeCode)
  } catch {
    /* 同上 */
  }
}

/* ───────────────────────── 每一步的過關條件 ───────────────────────── */

const PHONE_RE = /^09\d{8}$/
const LAST4_RE = /^\d{4}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 一句「怎麼修」；通過則是 null（SPEC §15.5）。 */
export type FieldErrors = Record<string, string>

export function identityErrors(identity: Identity): FieldErrors {
  const errors: FieldErrors = {}
  if (!identity.applicant_name.trim()) errors.applicant_name = '請填寫與身分證相同的姓名。'
  if (!PHONE_RE.test(identity.phone.trim())) errors.phone = '請填寫 10 碼聯絡電話，例如 0912345678。'
  if (identity.id_last4 && !LAST4_RE.test(identity.id_last4.trim()))
    errors.id_last4 = '請填身分證字號的最後 4 位數字，或留空。'
  if (identity.email && !EMAIL_RE.test(identity.email.trim()))
    errors.email = '請填寫完整的電子信箱，例如 name@example.com，或留空。'
  if (!identity.tier_code) errors.tier_code = '請選擇一個申請身分。'
  return errors
}

export function channelErrors(channel: ChannelInfo): FieldErrors {
  const errors: FieldErrors = {}
  if (!channel.payment_channel_code) errors.payment_channel_code = '請選擇你實際付款的方式。'
  if (!channel.purchase_date) errors.purchase_date = '請填寫帳單上的購買（扣款）日期。'
  const amount = Number(channel.purchase_amount)
  if (!channel.purchase_amount.trim()) errors.purchase_amount = '請填寫帳單上實際扣款的臺幣金額。'
  else if (!Number.isFinite(amount) || amount <= 0) errors.purchase_amount = '金額請只填數字，例如 6000。'
  return errors
}

export function toolErrors(state: ApplyState, scheme: SchemePublic | undefined): FieldErrors {
  if (!state.tool.name.trim()) return { tool: '請選擇或輸入你購買的工具名稱。' }
  // 從選單選的：直接看那個工具的判定。
  const picked = scheme?.eligible_tools.find((tool) => tool.id === state.tool.tool_id)
  if (picked?.status === 'REJECTED')
    return { tool: '這個工具依計畫規定不予補助，換一個符合資格的工具才能繼續。' }
  // 自行填寫的：比對名稱，比對到不予補助的一樣要擋——不然畫面已經說了不能申請，
  // 卻還放人走下去準備文件，等於白工。查無收錄則不擋（由承辦人工認定）。
  if (!state.tool.tool_id && scheme) {
    const guessed = matchTool(state.tool.name, scheme.eligible_tools)
    if (guessed?.status === 'REJECTED')
      return { tool: '這個工具依計畫規定不予補助，換一個符合資格的工具才能繼續。' }
  }
  return {}
}

/** 上傳步驟：必備文件都要有。 */
export function missingDocuments(required: string[], docs: Record<string, UploadedDoc>): string[] {
  return required.filter((code) => !docs[code])
}

export function canLeave(
  step: StepKey,
  state: ApplyState,
  scheme: SchemePublic | undefined,
  required: string[],
): boolean {
  switch (step) {
    case 'tool':
      return Object.keys(toolErrors(state, scheme)).length === 0
    case 'identity':
      return Object.keys(identityErrors(state.identity)).length === 0
    case 'channel':
      return Object.keys(channelErrors(state.channel)).length === 0
    case 'guide':
      return true
    case 'docs':
      return missingDocuments(required, state.docs).length === 0
    case 'confirm':
      return true
    default:
      return false
  }
}
