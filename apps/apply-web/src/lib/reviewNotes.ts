/** `Finding.note` 的文案。
 *
 * 伺服器回的 `note` 是**文案 key**（`review.note.*`），不是句子——給市民看的字統一由
 * `contents` 提供（CLAUDE.md 規則 4）。contents 端點還沒上線之前，畫面用這張備援表渲染；
 * 不認得的值原樣顯示（`packages/review-rules` 的 TS 版直接產句子，會走這條路）。
 *
 * 唯一不能做的是把 `review.note.no_document` 這種 key 直接印在畫面上。
 */

export const REVIEW_NOTE_FALLBACK: Record<string, string> = {
  'review.note.no_document': '這條規則要看的那份文件還沒有上傳。',
  'review.note.no_text': '這份文件沒有辨識到任何文字，可能是空白頁或影像太模糊。',
  'review.note.field_not_found': '在這份文件上找不到這條規則要的欄位。',
  'review.note.normalize_failed': '讀到了值，但轉不成標準格式，需要人工確認。',
  'review.note.bad_regex': '這條規則的 regex 無法編譯，請到方案管理修正這條規則。',
  'review.note.amount_source_missing': '還沒有從憑證上讀到金額，沒辦法比對。',
  'review.note.amount_unreadable': '憑證上讀到的字看不出是多少錢，需要人工確認。',
  'review.note.amount_pending': '申請人還沒有填寫申報金額，填好之後才會比對。',
  'review.note.amount_mismatch': '憑證上的金額與申報金額差距超出容許範圍。',
  'review.note.missing_documents': '還有必要文件沒有收到。',
  'review.note.unknown_rule_type': '這條規則的類型系統還看不懂，需要人工確認。',
}

export type ContentOverlay = Record<string, string>

/** contents 的 key 一律以 `review.note.` 開頭；其餘字串視為已經是句子。 */
export function isNoteKey(value: string): boolean {
  return value.startsWith('review.note.')
}

export function renderNote(note: string | null | undefined, overlay: ContentOverlay = {}): string | null {
  if (!note) return null
  if (!isNoteKey(note)) return note
  return overlay[note] ?? REVIEW_NOTE_FALLBACK[note] ?? '這一項需要人工確認。'
}

/** 一次要齊所有 note 文案，`GET /api/contents?keys=` 用。 */
export function reviewNoteKeys(): string[] {
  return Object.keys(REVIEW_NOTE_FALLBACK)
}
