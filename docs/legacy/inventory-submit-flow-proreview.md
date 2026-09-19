Survey complete. Full inventory below.

---

# A) submit-flow — `/Users/sam/Documents/MyProject/mixProject/submit-flow`

Next.js 16.3.4 app lives in `app/` subfolder (so app root = `/Users/sam/Documents/MyProject/mixProject/submit-flow/app`). Package name `hsinchu-ai-subsidy`. All paths below are absolute unless a repeated prefix is stated.

## A0. Top-level layout

```
submit-flow/
  CLAUDE.md                 project rules (docs are the deliverable; 02 is the single source of truth)
  skills-lock.json
  creditcard.jpg            loose test image
  docs/                     8 .md + 1 .pdf
  app/                      the Next.js application
    eng.traineddata         tesseract English model checked into app root
    scripts/gen-samples.mjs generates public/samples/*.svg
    public/samples/*.svg|jpg 25 demo evidence images
    src/app, src/components, src/lib
```

## A1. Directory layout

### `app/src/app/` (App Router)
| Path | Role |
|---|---|
| `/app/src/app/layout.tsx` | root layout, zh-Hant, viewport maximumScale 5 (NF4: 200% zoom) |
| `/app/src/app/page.tsx` | home = renders `ApplyLayout` + `ApplyFlow` |
| `/app/src/app/globals.css` (154 L) | tailwind v4 theme tokens (`--accent`, `--ink`, `--line`, `--panel`, `--panel-2`, `--muted`) |
| `/app/src/app/apply/layout.tsx` | citizen shell: header (「數位申辦平台」), nav to `/apply/status`, footer link to `/staff`; imports `apply.css` |
| `/app/src/app/apply/apply.css` (61 L) | `.apply-shell/.apply-window/.apply-grid/.apply-form/.apply-summary/.apply-steps` |
| `/app/src/app/apply/page.tsx` | `<ApplyFlow/>` |
| `/app/src/app/apply/status/page.tsx` | case list (demo: lists all apps), `?new=1&case=` success banner |
| `/app/src/app/apply/status/[case]/page.tsx` (235 L) | case detail: 5-step public progress `FLOW = [SUBMITTED, UNDER_REVIEW, APPROVED, DISBURSING, DISBURSED]`, `describeWait()` copy, `RevisionPanel` when `NEEDS_REVISION`, two-column only when `flowIndex>=0 \|\| isTerminal` |
| `/app/src/app/apply/card-mask-test/page.tsx` | dev page → `CardMaskPlayground` |
| `/app/src/app/staff/layout.tsx` | `StaffShell` + `staff.css` |
| `/app/src/app/staff/staff.css` (707 L) | all staff class names (`staff-shell/side/main/scroll/stats/table/pill/tag/doclist/docitem/stage/aside/compare/timeline/log`) |
| `/app/src/app/staff/page.tsx` | queue page; builds `QueueRow[]`, sorts by `queueOrder`, runs `precheck` per case, `manualNotifyTodos()` |
| `/app/src/app/staff/[case]/page.tsx` (298 L) | single-page review (DocViewer + ComparePanel + CaseActions + rejection history + audit log + notifications) |
| `/app/src/app/staff/knowledge/page.tsx` | knowledge board (pending queue, tools, faqs, waitingCounts) |
| `/app/src/app/api/applications/route.ts` | POST = submit (T1) + server-side re-verification (SPEC-B E2) |
| `/app/src/app/api/applications/[id]/route.ts` | POST `{action:"resubmit"\|"withdraw"}` |
| `/app/src/app/api/staff/route.ts` | POST `{action:"transition"\|"resolveTool"\|"upsertFaq"\|"usePreset"}` |
| `/app/src/app/api/tools/route.ts` | GET `?q=` → `{kind,needsConfirm,tool,alternatives,candidates}`; records pending tool when `kind==="NONE" && q.length>=2` |

`src/components/apply/`: ApplyFlow, DocField, MaskEditor, CardCameraModal, CardMaskPlayground, PrecheckPanel, RevisionPanel, GuideCard, ToolSelect, OtherToolCheck, FlatSelect, statusTone.ts
`src/components/staff/`: CaseQueue, DocViewer, ComparePanel, CaseActions, RejectionForm, KnowledgeBoard, StaffShell, staffLabel.ts
`src/components/ui.tsx` (310 L): `cx, Button(variant primary|secondary|ghost|danger, size sm|md|lg), Badge(Tone), Card, Spinner, Field, Input, Textarea, Select, Modal, EmptyState, PageHeader, FilterPill, SourceNote, api<T>(url,{json})`
`src/lib/`: types.ts (780), rules.ts (398), seed.ts (1642), db.ts (476), image.ts (193), creditCardOcr.ts (227), guides.ts (205), toolSearch.ts (128), ids.ts (44), session.ts (28)

### `docs/` — one line each
- **`01-需求釐清與使用者旅程.md`** (734 L) — Interview record + requirements N1–N10 from three phone interviews with the Hsinchu Youth Center (2026-09-14/16/18); ch.7 holds the 2nd/3rd interview findings (4 defects of the existing digital platform, the three most time-consuming staff tasks, ~80% revision rate, existing 8 statuses, credit-card evidence practice); appendix has verbatim transcripts. Every fact is tagged `【訪談】/【推論】/【待確認】`.
- **`02-設計決策紀錄.md`** (520 L) — The upstream single source of truth: decisions **D1–D37** (all ✅ except **D32 🔶 paper applications**) grouped as scope (D1–D4), privacy/security (D5–D10), applicant UX (D11–D14), verification & review (D15–D18), case flow (D19–D22), LINE (D23–D26), knowledge base (D27–D28), 2nd-interview additions (D29–D32), 3rd-interview additions (D33–D37); plus open items **O-2 backend architecture**, **O-3 permission tiers**, and O-1/O-4…O-13 pending city confirmation.
- **`03-問題論證與落地推廣.md`** (362 L) — Judge-facing argument ("we made one phone call and rewrote the proposal"): review is not the bottleneck, rejection is; 100 cases × 80% need revision × 90% stuck on the same document ≈ 72; three core designs, three self-imposed limits, staged rollout.
- **`PRD-1-民眾申請端.md`** (457 L) — Citizen LIFF product requirements: F1 card onboarding from "what did you buy", F2 contextual retrieval tutorials, F3 one-field-per-document, F4 live image-quality check, F5 client-side masking, F6 pre-submit precheck (+F6.3 mandatory human escape hatch), F7 progress, F8 revision guidance; NF1–NF5; acceptance list.
- **`PRD-2-審核端後台.md`** (472 L) — Staff console requirements for exactly 3 users/100 cases per day: F1 queue, F2 single-page viewer (the most important feature), F3 revision version separation, F4 assisted comparison without conclusions, F5 structured rejection, F6 knowledge management, F7 case actions, F8 🔶 paper entry; red lines: never add staff steps, never give a verdict/confidence score.
- **`SPEC-A-領域模型與案件狀態機.md`** (499 L) — Shared truth for the state machine: §2.1 statuses, §2.2 diagram, §2.3 transition rule table, §2.4 two inviolable rules (the system never self-triggers a transition), §3 data model (Application/Document/RejectionReason/ToolVerdictSnapshot/StatusEvent/Notification), §4 notification matrix (+§4.1 channel NONE must create a to-do), §5 queue ordering by `firstSubmittedAt` and progress disclosure, §6 roles (pending O-3).
- **`SPEC-B-憑證檢驗規則.md`** (423 L) — Single definition of evidence checking executed in three places (front-end precheck, back-end re-verify, staff highlighting): §2 billing statement check with elements A (payment detail) / B (card last-4), three verdicts, §2.4 mandatory manual exit, §3 field rules + tolerance + merchant-name rule, §4 masking rules, §5 format normalization + §5.1b live quality check, §6 tutorial data structure, §7 model interface (🔶 O-2), §8 staff presentation rules.
- **`SPEC-C-知識庫.md`** (368 L) — Knowledge base: two separate stores (ToolVerdict / FaqEntry), Chinese-capital field, system never auto-judges Chinese capital, security-note fields, lifecycle DRAFT→PENDING_APPROVAL→ACTIVE→SUPERSEDED (only ACTIVE is queryable), §4.1 name matching exact→fuzzy→semantic, §4.2 D28 "not found never blocks", §5 AI-agent constraints (never guess), §6 growth loop.
- `docs/01-…pdf` is a rendered copy of doc 01.

## A2. The 6-step application flow

Single component: **`/app/src/components/apply/ApplyFlow.tsx`** (976 L, `"use client"`). One `useState<Step>`; no router between steps; `go(step)` also `window.scrollTo({top:0,behavior:"smooth"})`.

```ts
type Step = "tool" | "identity" | "channel" | "guide" | "docs" | "review";
const STEPS = [{tool,"工具"},{identity,"身分"},{channel,"購買明細"},{guide,"準備"},{docs,"上傳"},{review,"送出"}];
titleOf: tool 確認申請工具 / identity 申請人資料 / channel 購買明細 / guide 準備申請文件 / docs 上傳文件 / review 確認並送出申請
```
Header shows `apply-steps` ol with `01…06` numerals (check icon when complete) and counter `NN / 06`. A right-hand `aside.apply-summary` is always visible: tool, applicant name, tier label, billing cycle (`年費` or `月費（N 期）`), channel label, purchaseDate, `uploaded/total 份`, and estimated subsidy `subsidyAmount(tier,totalClaimed)`.

| # | Step | UI | Fields / state | Validation (gate to next) | Files |
|---|---|---|---|---|---|
| 1 | `tool` | `ToolSelect` combobox over `TOOL_GROUPS` (5 groups: 通用型AI [ChatGPT, Google AI的訂閱方案, Grok, Claude, Perplexity], 影像類AI [Canva AI, Adobe Firefly, 其他Adobe AI創作工具, Midjourney, Figma AI], 辦公類AI [Microsoft Copilot, copy.ai, Notion AI, Jasper], 學習類AI [Grammarly, Speak, Elicit], 其他類AI [Cursor]) + `其他（自行填寫）`; static "不予補助範圍提醒" card with 3 bullets (中港澳軟體 / 代購與集合平台 Poe.com、GoingBus / 儲值·點數·API) | `selectedTool`, `otherTool`, `otherCheck:{name,allowed}` | `canLeaveTool = selectedTool==="OTHER" ? !!otherCheck?.allowed : !!selectedTool` | `ToolSelect.tsx`, `OtherToolCheck.tsx` (calls `GET /api/tools?q=`, shows candidate buttons when `needsConfirm`, then `verdictPresentation`) |
| 2 | `identity` | Card「基本資料」(2-col grid) + Card「申請身分」(2 tier buttons from `TIER_META`) | `applicant{name,phone,nationalId(uppercased),birthDate(date),email,household,mailingAddress}`, `sameAsHousehold` checkbox mirrors household→mailing and disables the field; `tier` | `Object.values(applicant).some(v=>!v.trim())` disables next — i.e. **all 7 fields required**, no format validation at all | `ApplyFlow.tsx`, `ui.tsx` Field/Input |
| 3 | `channel` | Card「繳費方式」(4 radio-cards from `CHANNEL_META` w/ hint + examples) · Card「付款人」(本人支付 / 父母、配偶或法定代理人代為支付 → note about 代為支付切結書) · Card「訂閱與費用明細」 | `channel`, `paidByProxy`, `billingCycle: MONTHLY\|ANNUAL`, `billingPeriods` (FlatSelect 1–12 「N 個月（N 期）」, only when MONTHLY), `purchaseDate` (date), `originalCurrency` (USD/TWD/EUR/JPY/GBP/OTHER with symbols $, NT$, €, ¥, £), `originalAmount` (number, symbol prefix pl-8/pl-12), `claimedAmount` (digits only `replace(/\D/g,"")`; auto-mirrored from originalAmount when currency is TWD) | `!channel \|\| !claimedAmount \|\| !purchaseDate \|\| !originalAmount` | `FlatSelect.tsx` |
| 4 | `guide` | `GuideCard guide={findGuide(channel)} wide`; extra note when `channel==="OTHER"` ("由承辦人員人工檢視") | — | none; next label 「我準備好了，開始上傳」 | `GuideCard.tsx`, `lib/guides.ts` |
| 5 | `docs` | 3 sub-steps bar (`DOC_SUBSTEPS`: identity 身分證明 / payment 購買與付款憑證 / disbursement 撥款帳戶與切結) with per-group `uploaded/total 份`; 2-col grid of `DocField`; info banner when MONTHLY & periods>1 | `docs: Record<slotKey, UploadedDoc>`, `docSubStep 0..2` | each sub-step: `currentGroupSlots.some(s=>!docs[s.key])`; last sub-step: `requiredSlots.some(s=>!docs[s.key])` | `DocField.tsx` |
| 6 | `review` | `PrecheckPanel`; error box; ghost 「回去改文件」 | `manualAssist`, `submitting`, `submitError` | `PrecheckPanel` blocks the submit button when `verdict==="FAIL" && !manualAssist` | `PrecheckPanel.tsx` |

**Dynamic slot generation** (`requiredSlots` useMemo, deps `[effectivePeriods, paidByProxy, tier, channel]`), `effectivePeriods = billingCycle==="MONTHLY" ? billingPeriods : 1`, `totalClaimed = claimedAmount * effectivePeriods`:
1. `ID_CARD_FRONT`, `ID_CARD_BACK` (group identity), `+ SPECIAL_STATUS_PROOF` when `tier==="LOW_INCOME"`.
2. `OFFICIAL_RECEIPT` — if `effectivePeriods>1`, one slot per period keyed `OFFICIAL_RECEIPT_${p}` labelled 「官方收據（第 N 期）」; else single slot with `periodIndex:1`.
3. `CHANNEL_DOCS[channel].all` — for `BILLING_STATEMENT | TELECOM_BILL | TRANSACTION_DETAIL` expanded per period (`${t}_${p}`, label `${docLabelFor(t,channel)}（第 N 期）`); others single.
4. `PROXY_AFFIDAVIT` when `paidByProxy`.
5. `BANKBOOK_COVER`, `AFFIDAVIT` (group disbursement).

`SAMPLES` map (DocumentType → `/samples/*.svg|jpg`) is passed to DocField for the 「看合格範例」 thumbnail.

**Submit** (`submit(billingExtracted)`): `POST /api/applications` with `{applicant, toolInput, tier, channel, claimedAmount: totalClaimed, paidByProxy, billingCycle, billingPeriods: effectivePeriods, purchaseDate, originalCurrency, originalAmount: Number(originalAmount)*effectivePeriods, manualAssistRequested, docs: [...UploadedDoc, extracted only on BILLING_STATEMENT]}` → `router.push('/apply/status?case=…&new=1')`.

**DocField** (`/app/src/components/apply/DocField.tsx`, 235 L) exports `interface UploadedDoc {type, dataUrl, isMasked, originalFormat, qualityNote?, extracted?, periodIndex?}`. Props `{type, value, sample, onChange, required, customLabel}`. `pick(file)` → `loadImage(file)`; if `DOC_META[type].mustMask` → opens `MaskEditor`, else `onChange({dataUrl: toJpegDataUrl(img.canvas), isMasked:false})`. File input `accept="image/*,.heic,.heif,application/pdf"`. Buttons 拍照 (`CardCameraModal`) / 選擇檔案; when filled shows preview (`max-h-56 object-contain`), badges 「已遮罩」 and 「HEIC 已轉 JPEG」, and 重拍 / 換一張 / ✕.

**CardCameraModal** (281 L): `getUserMedia({facingMode:{ideal:"environment"|"user"}})`, front/back switch when multiple cameras, crop-frame capture into an offscreen canvas → `canvas.toBlob` → `new File([blob],'capture-<ts>.jpg',{type:"image/jpeg"})`, fallback button to file picker.

## A3. MaskEditor

**File:** `/app/src/components/apply/MaskEditor.tsx` (269 L, client).

```ts
props: {
  source: HTMLCanvasElement;
  docType: DocumentType;
  onConfirm: (maskedDataUrl: string) => void;
  onCancel: () => void;
  showDetectedCardNumber?: boolean;   // default false
}
```
Only `CardMaskPlayground.tsx` passes `showDetectedCardNumber`; `DocField` does not.

State: `masks: MaskRect[]`, `mode: "add"|"remove"`, `drawing`, `ocrState: "idle"|"scanning"|"ready"|"manual"|"verifying"|"rejected"`, `ocrProgress`, `ocrResult: CardOcrResult|null`, `ocrDetail`, `detectedCardNumber/CardholderName/ExpiryDate`, `confirmed`. `isCard = docType === "CARD_LAST4_PHOTO"`.

**Auto-detect (tesseract + Luhn) — yes, only for `CARD_LAST4_PHOTO`.** On mount (effect deps `[isCard, source]`): `createCardOcrWorker(onProgress)` → `detectCardMasks(worker, source)`. Success → `setMasks(result.masks)`, cache result, state `ready` (banner 「已自動遮蔽，只保留末四碼 {last4}」). `CardOcrDetectionError` → copies `detectedNumbers[0]`, cardholderName, expiryDate into state, `ocrDetail = error.message`, state `manual` (amber banner asking the user to mask CVV/expiry/other digits manually). Cleanup terminates the worker (`cancelled` flag).

**Manual masking:** pointer events on a wrapper div whose aspect ratio is `source.width/source.height`; coordinates normalized to 0–1 via `getBoundingClientRect`. `add` mode drags a rect, committed on pointer-up only when `w > 0.015 && h > 0.01`, pushed as `{x,y,w,h,source:"MANUAL"}`. `remove` mode hit-tests the topmost mask (`[...masks].reverse().find(...)`) and deletes it. Any mask change sets `confirmed=false`. Toolbar: 新增遮罩 / 移除遮罩 / 清除全部 (trash, shown when `masks.length>0`). Pointer events are ignored while `ocrState` is `scanning` or `verifying`.

**Confirm checkbox logic:** the checkbox (「我確認僅保留持卡人姓名與卡號末四碼，其他數字均已遮蔽。」) renders **only when `isCard`**. `confirm()` returns early if `isCard && !confirmed`. Submit button `disabled = ocrState==="scanning" || ocrState==="verifying" || (isCard && !confirmed)`. In `confirm()`: `applyMasks(source, masks)` → if `isCard && ocrResult && workerRef.current`, set state `verifying` and run `verifyCardMask`; if `!verification.safe` → dispose masked canvas, state `rejected`, `ocrDetail = 仍辨識到 N 個其他數字；末四碼{可辨識|未完整辨識}`, `confirmed=false`, abort. Verification throw → state `manual`, abort. Otherwise `toJpegDataUrl(masked)` → dispose masked + source → `onConfirm(dataUrl)`. `cancel()` disposes source then `onCancel()`.

Right rail also shows `DOC_META[docType].keep` as 「請保留清楚可見」, and (when `showDetectedCardNumber`) the detected card number formatted `replace(/(.{4})/g,"$1 ")`, name and expiry.

## A4. `lib/image.ts` (193 L)

Constants: `MAX_LONG_EDGE = 2400`, `JPEG_QUALITY = 0.85`.

- `detectFormat(file): string` — ext-or-MIME → `"HEIC"` (ext HEIC/HEIF or `image/heic|heif`), `"PDF"` (`application/pdf` or .pdf), `"PNG"`, `"JPEG"` (JPG/JPEG), else uppercased ext or `"UNKNOWN"`.
- `loadImage(file): Promise<LoadedImage {canvas,width,height,originalFormat,probe,qualityNote}>` — `createImageBitmap(file)` inside try/catch. **HEIC handling:** no heic2any; it relies on the browser's `createImageBitmap` (works on Safari/iOS), and on failure throws a user-facing message — HEIC: 「這支瀏覽器無法讀取 HEIC 照片。請改用「拍照」直接上傳，或在手機設定中把相機格式改為「最相容」。」, otherwise 「無法讀取這個檔案，請換一張照片或改用 JPG／PNG。」 **PDF is detected by `detectFormat` but never decoded** — `createImageBitmap` on a PDF throws, so PDFs land in the generic error branch. (The file input still accepts `application/pdf`; servers always store `servedFormat:"JPEG"`.)
- **Resize:** `scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height))`, `w/h = Math.round(dim*scale)`, drawn into a `2d` context created with `{willReadFrequently:true}`, then `bitmap.close?.()`.
- **Quality probing** `probeQuality(ctx,w,h,originalLongEdge)` — samples a **centred 640×640 max** region via `getImageData`; grayscale `0.299R+0.587G+0.114B / 255`; `brightness = mean gray`; Laplacian `|4c − left − right − up − down|` on a **stride-2 grid**, variance = `E[x²]−E[x]²`, `sharpness = Math.min(1, Math.sqrt(variance)*12)`. Returns `{longEdge: originalLongEdge, sharpness, brightness}`. `qualityNote = qualityIssue(probe)`.
  Thresholds live in `rules.ts`: `QUALITY_THRESHOLDS = {minLongEdge:1000, minSharpness:0.35, minBrightness:0.2, maxBrightness:0.9}` — **but `qualityIssue()` currently `return null` unconditionally** (check disabled to avoid false positives on screenshots), so `qualityNote` is always null in practice.
- Masking: `interface MaskRect {x,y,w,h, source:"AUTO"|"MANUAL", label?}` (relative 0–1, same coordinate semantics as SPEC-B highlights). `suggestMasks(_docType)` **returns `[]`** (deliberately no hardcoded boxes). `applyMasks(src, masks)` copies to a new canvas and fills `#0f172a` rects rounded to pixels. `toJpegDataUrl(canvas, quality=0.85)`. `disposeCanvas(canvas)` sets width/height to 0.

## A5. `lib/creditCardOcr.ts` (227 L)

Uses `tesseract.js` v7 (`createWorker`, `PSM`, `Worker`).

- `createCardOcrWorker(onProgress?)` — `createWorker("eng")`, logger forwards `message.progress` when `status==="recognizing text"`; `setParameters({tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces:"1"})`.
- `digitsOfWord(word)` — skips words containing no digit at all (so names can't become card data); per character `O→0`, `[Il|]→1`; keeps only `/^\d$/`; synthesises a per-character bbox by splitting the word bbox evenly: `x0 = bbox.x0 + width*i/len`, `x1 = bbox.x0 + width*(i+1)/len`.
- `passesLuhn(value)` — standard Luhn **and** `13 <= length <= 19`.
- `debugFieldsOf(lines)` — expiry from text regex `/(?:^|\s)(0?[1-9]|1[0-2])\s*[\/.\-]\s*(\d{2}|\d{4})(?:\s|$)/`, fallback a 4-digit run whose first two digits are 1–12 → `MM/YY`; cardholder name = longest line with no digits, not matching `\b(valid|thru|mastercard|visa|amex|american express|jcb|unionpay|biometric|debit|credit|expires?|month|year)\b/i`, and with ≥4 letters.
- `detectCardMasks(worker, canvas): Promise<CardOcrResult|null>`
  1. `worker.recognize(canvas, {rotateAuto:false}, {blocks:true})` — rotateAuto off so OCR boxes stay in canvas coordinates.
  2. candidates = per-line digit strings passing Luhn. If `candidates.length !== 1`, retry on an **inverted copy** (`invertedCanvas`, 255-x per RGB channel) and merge debug fields.
  3. A third pass with `PSM.SPARSE_TEXT` (restored to `PSM.AUTO` in `finally`) for small detached expiry/CVV text — used for extra masks and metadata only.
  4. If still `!== 1` candidate → throw `CardOcrDetectionError(summary, detectedNumbers[13..19 digits], cardholderName, expiryDate)` where summary is e.g. `"16 碼／Luhn 通過、4 碼／Luhn 未通過"` or `"未辨識到數字"`.
  5. Success: `pan = candidates[0]`; `keep = new Set(pan.slice(-4))`, `keepRegions = last-4 bboxes`; mask **every other digit** found in both AUTO and SPARSE passes, filtered by `!keep.has(d) && !keepRegions.some(r=>centerIn(d.bbox,r))`; each becomes `paddedBox` = pad `max(3, charHeight*0.2)` in x and `max(3, charHeight*0.15)` in y, clamped to canvas, normalized to 0–1, `source:"AUTO"`, `label:"自動遮蔽數字"`.
  6. Returns `{masks, cardNumber, cardholderName, expiryDate, last4, allowedRegions}`.
- `verifyCardMask(worker, maskedCanvas, result)` — re-OCRs the flattened masked canvas; `outside` = digits whose centre is not inside any `allowedRegions`; returns `{safe: outside.length===0, extraDigits, last4Visible: retained === result.last4}`. If unsafe, retries inverted and accepts the inverted read when it is safe (or when only it sees the last-4). `last4Visible` is informational only.

## A6. State machine

All in **`/app/src/lib/types.ts`** (definitions) + **`/app/src/lib/rules.ts`** (helpers) + **`/app/src/lib/db.ts`** (execution).

**Status set (11)** — `DRAFT, SUBMITTED, UNDER_REVIEW, NEEDS_REVISION, REVISION_SUBMITTED, APPROVED, DISBURSING, DISBURSED, REJECTED, WITHDRAWN, CANCELLED_BY_STAFF`.
`TERMINAL_STATUSES = ["DISBURSED","REJECTED","WITHDRAWN","CANCELLED_BY_STAFF"]`.
Two label maps verbatim: `STATUS_PUBLIC_LABEL` = 填寫中 / 已收件，等待審核 / 審核中 / 需要補件 / 已收到補件，等待再次審核 / 已核定，準備撥款 / 撥款作業中 / 已撥款完成 / 未通過 / 已撤回 / 已註銷. `STATUS_STAFF_LABEL` = 草稿 / 已送件 / 審核中 / 待補件 / 補正待審核 / 已核定 / 撥款中 / 已撥款 / 不通過 / 已撤回（自行註銷）/ 已註銷.

**`TRANSITIONS: Record<Transition, {code, from[], to, role, label, needsReason?}>`**

| key | code | from | to | role | label | needsReason |
|---|---|---|---|---|---|---|
| `submit` | T1 | DRAFT | SUBMITTED | APPLICANT | 送出申請 | – |
| `startReview` | T2 | SUBMITTED | UNDER_REVIEW | REVIEWER | 開始審核 | – |
| `requestRevision` | T3 | UNDER_REVIEW | NEEDS_REVISION | REVIEWER | 要求補件 | **true** |
| `resubmit` | T4 | NEEDS_REVISION | REVISION_SUBMITTED | APPLICANT | 送出補件 | – |
| `startRevisionReview` | T4b | REVISION_SUBMITTED | UNDER_REVIEW | REVIEWER | 開始複審 | – |
| `approve` | T5 | UNDER_REVIEW | APPROVED | SUPERVISOR | 核定 | – (needs `approvedAmount`) |
| `reject` | T6 | UNDER_REVIEW | REJECTED | SUPERVISOR | 不通過 | **true** |
| `startDisbursement` | T7 | APPROVED | DISBURSING | REVIEWER | 開始撥款作業 | – |
| `confirmDisbursed` | T8 | DISBURSING | DISBURSED | REVIEWER | 確認撥款完成 | – |
| `withdraw` | T9 | DRAFT, SUBMITTED, NEEDS_REVISION | WITHDRAWN | APPLICANT | 自行註銷 | – |
| `cancelByStaff` | T10 | SUBMITTED, UNDER_REVIEW, NEEDS_REVISION, REVISION_SUBMITTED | CANCELLED_BY_STAFF | REVIEWER | 註銷案件 | **true** |

`ActorRole = "APPLICANT"|"REVIEWER"|"SUPERVISOR"|"SYSTEM"`.
`NOTIFY_ON`: true for submit, requestRevision, resubmit, approve, reject, startDisbursement, confirmDisbursed, cancelByStaff; **false** for startReview, startRevisionReview, withdraw.

Helpers in `rules.ts`: `isTerminal`, `allowedTransitions(status)`, `canTransition(from,transition)`, `queueOrder(a,b)` = compare `firstSubmittedAt ?? createdAt` ascending.

**Event log shape** (`types.ts`):
```ts
interface StatusEvent { id; applicationId; fromStatus: Status|null; toStatus: Status;
  transition: Transition; actorId; actorName; actorRole: ActorRole;
  occurredAt: string; metadata?: Record<string, unknown>; }
```
`db.applyTransition({applicationId, transition, actorId, reasons?, note?, approvedAmount?})` (`db.ts` L117-235) enforces: transition exists → `canTransition` → `requestRevision` needs ≥1 reason → other `needsReason` transitions need non-empty `note` → `approve` needs `approvedAmount`. Side effects: `submit` writes `firstSubmittedAt` **only if unset** + `lastSubmittedAt`; `resubmit` writes only `lastSubmittedAt` (D20); `startReview`/`startRevisionReview` set `assignedReviewerId`; `approve` sets `approvedAmount`; `confirmDisbursed` sets `documentsPurgeAt = now + 180 days`. `requestRevision` inserts one `RejectionReason` per code with `round = max(existing rounds)+1`. Always pushes a `StatusEvent` with `metadata:{note?, approvedAmount?, reasonCodes?}`. When `NOTIFY_ON[t]`, pushes a `Notification {channel: LINE if lineUserId else EMAIL if email else NONE, triggeredBy, title: titleFor(t), body: bodyFor(t,app,note), deliveryStatus: SENT | PENDING_MANUAL}`. `manualNotifyTodos()` surfaces `PENDING_MANUAL` ones to the queue page.
`averageDurations()` derives per-status mean days from consecutive `StatusEvent`s; `describeWait(status)` (rules.ts) returns the public copy strings (SUBMITTED「多數案件在 2 個工作天內開始審核」, UNDER_REVIEW「多數案件的審核在 3–5 個工作天內完成」, REVISION_SUBMITTED「補件案件多數在 2–3 個工作天內完成複審」, APPROVED「核定後多數案件於 2 週內開始撥款作業」, DISBURSING「撥款作業多數在 5 個工作天內完成」).

## A7. Enums and configuration (verbatim, `lib/types.ts`)

**`DocumentType` (12)** with `DOC_META[t] = {label, hint, requirement, mustMask?, keep?}`:

| value | label | hint | requirement | mustMask | keep |
|---|---|---|---|---|---|
| ID_CARD_FRONT | 身分證正面 | 姓名、出生年月日、身分證字號需清楚可辨識。 | REQUIRED | – | 姓名、出生年月日、身分證字號 |
| ID_CARD_BACK | 身分證反面 | 須可辨識設籍新竹市的住址。 | REQUIRED | – | 設籍新竹市住址 |
| OFFICIAL_RECEIPT | 官方收據 | 軟體公司或平台開立的收據、發票或訂單確認信。 | REQUIRED | – | – |
| BILLING_STATEMENT | 信用卡帳單扣款紀錄 | 需看得到刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額。 | CONDITIONAL | **true** | 刷卡本人姓名、卡號末四碼、購買品項名稱、臺幣金額 |
| CARD_LAST4_PHOTO | 信用卡圖片 | 需看得到持卡本人姓名、簽名與卡號末四碼。照片或截圖都可以。 | CONDITIONAL | **true** | 持卡本人姓名、簽名、卡號末四碼 |
| TELECOM_BILL | 電信帳單 | 需看得到繳款人、電話末三碼、購買品項名稱、臺幣金額。 | CONDITIONAL | **true** | 繳款人、電話末三碼、購買品項名稱、臺幣金額 |
| PAYER_ACCOUNT_PROOF | 支付帳戶為本人之證明 | 可證明該支付帳戶為你本人的資料，例如帳戶頁面顯示你的姓名。 | CONDITIONAL | **true** | 帳戶持有人姓名 |
| TRANSACTION_DETAIL | 交易明細 | 需看得到付款日期、付款金額、購買品項名稱。 | CONDITIONAL | **true** | 付款日期、付款金額、購買品項名稱 |
| BANKBOOK_COVER | 存摺封面影本 | 撥款用。需看得到戶名、帳號、分行。 | REQUIRED | – | 戶名、帳號、分行 |
| AFFIDAVIT | 切結書 | 需親筆簽名後拍照或掃描上傳。 | REQUIRED | – | – |
| PROXY_AFFIDAVIT | 代為支付切結書 | 由父母、配偶或法定代理人代為付款時才需要。 | CONDITIONAL | – | – |
| SPECIAL_STATUS_PROOF | 特定對象證明 | 低收入戶或中低收入戶證明。 | CONDITIONAL | – | – |

`SERVED_FORMATS = ["JPEG","PNG","PDF"]`. `docLabelFor(type, channel)` overrides two labels when `channel==="OTHER"`: `TRANSACTION_DETAIL → "付款明細"`, `PAYER_ACCOUNT_PROOF → "可證明該支付帳戶為本人之資料"`.

**`RejectionCode` (12)** with `REJECTION_META[c] = {staffLabel, publicTitle, publicHow, docType?, guideChannel?}`:

| code | staffLabel | publicTitle | publicHow | docType |
|---|---|---|---|---|
| BILLING_NO_TWD | 出帳帳單缺臺幣換算金額 | 出帳帳單上看不到換算後的臺幣金額 | 請重新取得一份含臺幣金額的帳單。下方是你的付款方式的取得步驟。 | BILLING_STATEMENT (guideChannel) |
| BILLING_NO_CARD_DIGITS | 出帳帳單無法辨識卡號末四碼 | 出帳帳單上看不到卡號末四碼 | 請提供含卡號末四碼的帳單頁面，或改用網銀的交易明細截圖。 | BILLING_STATEMENT (guideChannel) |
| BILLING_UNREADABLE | 出帳帳單影像模糊或不完整 | 出帳帳單的照片看不清楚 | 請在光線充足處重拍，確認四個角都在畫面內、文字沒有晃到。 | BILLING_STATEMENT |
| BILLING_AMOUNT_MISMATCH | 帳單金額與申請金額不符 | 帳單上的金額與你填寫的金額不一致 | 請以帳單上實際扣款的臺幣金額為準，回到申請資料修正填報金額。 | BILLING_STATEMENT |
| CARD_DIGITS_MISMATCH | 卡號末四碼與信用卡照片不一致 | 帳單與信用卡照片的末四碼不是同一張卡 | 帳單與卡片佐證必須是同一張卡。請確認後重新上傳其中一份。 | CARD_LAST4_PHOTO |
| ID_ADDRESS_UNCLEAR | 身分證住址無法辨識 | 身分證背面的住址看不清楚 | 請重拍身分證背面，確認住址那一行沒有反光或模糊。 | ID_CARD_BACK |
| ID_NOT_HSINCHU | 設籍地非新竹市 | 身分證上的設籍地不在新竹市 | 本計畫限設籍新竹市的青年申請。若你已遷入，請提供最新的身分證背面。 | ID_CARD_BACK |
| OVER_MASKED | 遮罩蓋住必要資訊 | 遮罩把需要保留的資訊也蓋住了 | 請重新上傳並確認保留必要欄位——系統會標示哪些位置不可以遮。 | – |
| AFFIDAVIT_NO_SIGNATURE | 切結書缺親筆簽名 | 切結書上沒有親筆簽名 | 請列印後親筆簽名，再拍照上傳。 | AFFIDAVIT |
| DOC_MISSING | 缺少必要文件 | 有一份必要文件沒有收到 | 請補上承辦標示的那一份文件。 | – |
| TOOL_NOT_ELIGIBLE | 該工具不符補助資格 | 你申請的工具不符合補助資格 | 請參考判定理由與替代工具建議。 | – |
| OTHER | 其他（請填說明） | 其他需要修正的事項 | 請參考承辦的補充說明。 | – |

**PaymentChannel + CHANNEL_DOCS** (`PaymentChannel = "CREDIT_CARD"|"TELECOM"|"E_PAYMENT"|"OTHER"`):
```ts
CHANNEL_DOCS = {
  CREDIT_CARD: { all: ["CARD_LAST4_PHOTO","BILLING_STATEMENT"], note: "信用卡圖片與信用卡帳單扣款紀錄，兩份都要。" },
  TELECOM:     { all: ["TELECOM_BILL"],                          note: "電信帳單須含繳款人、電話末三碼、購買品項名稱、臺幣金額。" },
  E_PAYMENT:   { all: ["PAYER_ACCOUNT_PROOF","TRANSACTION_DETAIL"], note: "支付帳戶須為申請人本人，並附交易明細。兩份都要。" },
  OTHER:       { all: ["PAYER_ACCOUNT_PROOF","TRANSACTION_DETAIL"], note: "須可證明支付帳戶為申請人本人，並附付款明細。兩份都要。" },
};
CHANNEL_LABEL = { CREDIT_CARD:"信用卡繳費", TELECOM:"電信繳費", E_PAYMENT:"電子支付工具繳費", OTHER:"其他繳費" };
CHANNEL_META[c] = {label, hint, examples}  // hints/examples quoted in §A2 step 3
LEGACY_CHANNEL = { PAYPAL:"E_PAYMENT", APPLE:"OTHER", GOOGLE_PLAY:"OTHER" };  // resolveChannel() / channelLabel()
```
Note the inconsistency worth porting carefully: `rules.requiredDocs()` maps legacy `APPLE|GOOGLE_PLAY|PAYPAL` → `CREDIT_CARD`, whereas `types.resolveChannel()` maps them to `OTHER`/`E_PAYMENT`.

**Tier config:**
```ts
export type SubsidyTier = "GENERAL" | "LOW_INCOME";
export const TIER_META = {
  GENERAL:    { label: "一般青年",                 rate: 0.5, cap: 3000 },
  LOW_INCOME: { label: "特定對象及文化語言保存者", rate: 0.9, cap: 6000 },
};
export function subsidyAmount(tier, claimedAmount) {
  const { rate, cap } = TIER_META[tier];
  return Math.min(Math.floor(claimedAmount * rate), cap);
}
```
Other small enums: `IntakeChannel = "DIGITAL"|"PAPER"`; `ChineseCapitalStatus = NONE|CONFIRMED|SUSPECTED|UNKNOWN` with `CAPITAL_LABEL` 查無中資背景 / 已確認有中資背景 / 有疑慮但未確認 / 尚未查核; `FaqCategory = ELIGIBILITY|REGULATION|DOCUMENTS|PROCESS|PRIVACY|TOOLS` with `FAQ_CATEGORY_LABEL` 資格條件 / 簡章規範 / 文件準備 / 流程與進度 / 個資與隱私 / 工具相關.

## A8. The rule engine: `precheck()` and `judgeBilling()` (`/app/src/lib/rules.ts`)

**`requiredDocs({tier,paidByProxy,channel})`** → all `DOC_META` entries with `requirement==="REQUIRED"` (ID front/back, OFFICIAL_RECEIPT, BANKBOOK_COVER, AFFIDAVIT) + `CHANNEL_DOCS[channelKey].all` + `PROXY_AFFIDAVIT` if proxy + `SPECIAL_STATUS_PROOF` if LOW_INCOME.
`currentDocs(docs)` = `d.isCurrent && !d.purgedAt`. `missingDocs(app,docs)` = requiredDocs minus present types.

**`precheck(app, docs): {verdict, issues, canSubmit}`** — issue shape `{code: RejectionCode|"FORMAT_NOT_SERVABLE"|"NOT_MASKED"|"QUALITY", docType?, message, how, blocking}`:
1. For every missing required doc: `DOC_MISSING`, message `還沒有上傳「${docLabelFor(t, app.paymentChannel)}」`, how = `DOC_META[t].hint`, **blocking**.
2. Per current doc, if `!SERVED_FORMATS.includes(d.servedFormat)`: `FORMAT_NOT_SERVABLE`, message `「X」的檔案格式承辦端可能無法開啟`, how 「系統會自動轉為 JPEG。若轉換失敗，請改用相機拍照或另存為 JPG 後重新上傳。」, **blocking**.
3. If `DOC_META[d.type].mustMask && !d.isMasked`: `NOT_MASKED`, message `「X」還沒有完成遮罩確認`, how 「請回到該欄位，檢查遮罩範圍後按下確認。你的原圖不會離開這台裝置。」, **blocking**.
4. If `d.qualityNote`: `QUALITY`, message `「X」${qualityNote}`, how 「請在光線充足處重拍，確認文件四角都在畫面內。」, **non-blocking**.
5. If `d.checkResult`: one issue per `failures[]` (`code`, `message = f.detail`, `how = REJECTION_META[code].publicHow`, `blocking = checkResult.verdict === "FAIL"`); additionally when verdict is `INDETERMINATE`, an `OTHER` non-blocking issue 「「X」系統沒辦法完全看懂，會由承辦人員人工確認」 / 「這不會影響你送出，也不需要重做。」.

Verdict:
```ts
const blocking = issues.filter(i => i.blocking);
const manualExit = app.manualAssistRequested === true;
verdict = blocking.length ? (manualExit ? "INDETERMINATE" : "FAIL")
        : issues.length  ? "INDETERMINATE" : "PASS";
canSubmit = verdict !== "FAIL";
```

**`judgeBilling({extracted, claimedAmount, cardLast4FromCardDoc, expectedTool, highlights?, unreadable?}): CheckResult`**
- `unreadable` → immediate `{verdict:"INDETERMINATE", failures:[], highlights:[], manualReason:"影像無法判讀，需人工檢視"}`.
- `extracted.twdAmount == null` → FAIL `BILLING_NO_TWD` detail 「帳單上找不到換算後的臺幣金額」.
- else `!amountWithinTolerance(twdAmount, claimedAmount)` → FAIL `BILLING_AMOUNT_MISMATCH`, detail `帳單金額 NT$X 與申請填報 NT$Y 差異超出容許範圍`.
  **Tolerance:** `AMOUNT_TOLERANCE = {ratio: 0.05, absolute: 150}`; `amountWithinTolerance(twd, claimed) = claimed ? (diff/claimed <= 0.05 && diff <= 150) : false` (both conditions must hold; `claimed===0` → false).
- `!extracted.chargeDate` → FAIL `BILLING_UNREADABLE` detail 「帳單上找不到扣款日期」.
- Card last-4: if either `extracted.cardLast4` or `cardLast4FromCardDoc` is missing → `indeterminate = true` with hint 「帳單上沒有卡號末四碼（Apple 等管道的收據本就不顯示），請以另附的卡片佐證人工核對」 or 「卡片佐證的末四碼無法辨識，請人工核對」. If both present and unequal → FAIL `CARD_DIGITS_MISMATCH` detail `帳單末四碼 A 與信用卡照片 B 不一致`. **Never FAIL on a missing value.**
- Merchant check: if `extracted.merchantName` and `!merchantMatches(merchantName, expectedTool)` → `indeterminate = true`, hint `帳單商家名「M」與申請工具「T」不同，常見於透過第三方平台付款，請人工確認`.
  `merchantMatches`: normalize `s.toLowerCase().replace(/[^a-z0-9一-鿿]/g,"")`; empty → false; **platform names always fail the match** (`platforms = ["applecom","apple","googleplay","paypal","itunes"]`, matched by `m === p || m.startsWith(p)`); substring either direction → true; else vendor↔product alias table:
  ```ts
  { openai:["chatgpt"], anthropic:["claude"], midjourney:["midjourney"], notionlabs:["notionai"],
    github:["githubcopilot"], microsoft:["copilot","microsoft365copilot"], bytedance:["豆包","doubao"] }
  ```
- Final: `verdict = failures.length ? "FAIL" : indeterminate ? "INDETERMINATE" : "PASS"`; `manualReason` (only when INDETERMINATE) = `[last4Hint, merchantHint].filter(Boolean).join("；") || "部分欄位無法確認，需人工檢視"`; `checkedAt = new Date().toISOString()`.

Where it runs: front end `PrecheckPanel` (extraction faked by `extractFor()`), back end `POST /api/applications` and `POST /api/applications/[id]` (E2 re-verification — never trusts the client's verdict; `unreadable: !extracted.twdAmount && !extracted.cardLast4`), and staff `ComparePanel` reads the stored `checkResult`.

## A9. Staff review pages

- **Queue** — page `/app/src/app/staff/page.tsx`, component `/app/src/components/staff/CaseQueue.tsx` (255 L). `QueueRow` interface quoted above. 4 stat tiles (待處理案件 / 形式齊備 / 需人工判讀 / 補件待審) computed over `OPEN = ["SUBMITTED","UNDER_REVIEW","REVISION_SUBMITTED","NEEDS_REVISION"]`. Manual-notify notice row. Toolbar: free-text search over `caseNumber + applicantName + toolName`, status select (`OPEN` / `ALL` / every `STATUS_STAFF_LABEL` with counts), precheck select (ALL / PASS 形式齊備 / INDETERMINATE 需人工判讀 / FAIL 有缺失), channel select. Table columns 案號(+紙本 tag) / 申請人(+tier subtitle) / 工具 / 預檢 / 狀態(+「補 N 份」 tag when REVISION_SUBMITTED) / 首次送件 / 承辦; row click → `/staff/{caseNumber}`. `PrecheckPill` shows 「民眾請求人工」 when `manualAssist`, else PASS→ok 形式齊備, INDETERMINATE→warn 需人工判讀 (title「AI 無法判讀，請人工檢視」), FAIL→bad 有缺失.
- **DocViewer** — `/app/src/components/staff/DocViewer.tsx` (298 L). Props `{docs, focusTypes?}`. Splits `isCurrent` vs history. Initial `activeId`: first doc whose type is in `focusTypes`, else the `BILLING_STATEMENT`, else first. Global keydown ↑/↓ moves through `current` (ignored while focus is in INPUT/TEXTAREA/SELECT) and resets zoom/rotation. Toolbar: 高亮 toggle (only when `checkResult.highlights.length`), 比對前版 (only when `active.supersedesId` resolves), zoom ±0.25 clamped [0.5, 3] with % label, rotate +90 mod 360, reset. Tags: 「第 N 版 · M/D 補件」, 「已遮罩」, 「HEIC → JPEG」 when `originalFormat !== servedFormat`. `DocImage` applies `transform: scale(z) rotate(r)` and overlays highlights positioned in **percent** (`h.x*100%` etc.), element `A` = accent ring / `rgba(20,84,155,0.10)`, element `B` = violet ring / `rgba(139,92,246,0.10)`, with a floating label chip. History list is collapsible.
- **ComparePanel** — `/app/src/components/staff/ComparePanel.tsx` (168 L). Props `{billing?, card?, claimedAmount, toolName}`. Rows: 臺幣金額 (帳單 vs 申請填報, match via `amountWithinTolerance`, mismatch label `差 NT$X`, note quoting `≤ 5% 且 ≤ NT$150`), 卡號末四碼 (帳單 vs 卡片佐證; 一致/不一致/無法比對), 持卡人姓名 (card only, note「以卡片拼音為準，不檢驗簽名」), 帳單商家名 vs 申請工具 (note「僅供參考」), 扣款日期. Lists `failures[].detail` under 「判讀出的缺失」. Shows the INDETERMINATE banner 「AI 無法判讀，請人工檢視」 + `manualReason`. Footer line: no recommendation, no confidence score (D17).
- **CaseActions** — `/app/src/components/staff/CaseActions.tsx` (243 L). Props `{applicationId,status,actorId,isSupervisor,presets,claimedAmount,tier}`. `STAFF_TRANSITIONS = [startReview, startRevisionReview, requestRevision, approve, reject, startDisbursement, confirmDisbursed, cancelByStaff]` filtered by `TRANSITIONS[t].from.includes(status)`. `IRREVERSIBLE = [approve, reject, cancelByStaff, confirmDisbursed]` → always open a modal; other transitions run immediately (no confirmation dialog, NF3). `approve`/`reject` disabled when `!isSupervisor` (tooltip references O-3). `run()` POSTs `/api/staff {action:"transition", actorId, applicationId, transition, ...extra}` then `router.refresh()`. Modals: requestRevision → `RejectionForm`; approve → amount input pre-filled with `subsidyAmount(tier, claimedAmount)`, digits-only; reject/cancelByStaff → required free-text reason with a danger button; confirmDisbursed → warning that it starts the D9 deletion countdown. Terminal states render 「此案件已進入終態，無可執行的動作」.
- **RejectionForm** — `/app/src/components/staff/RejectionForm.tsx` (161 L). Props `{presets, onSubmit(reasons, presetId?), busy}`. Preset chips (label + 「用過 N 次」) set the whole selection; 2-column checkbox grid over all 12 `REJECTION_META[c].staffLabel`; live generated public text:
  ```
  您的申請經審核，尚有下列項目需要補正：
  (blank)
  1. {publicTitle}（{DOC_META[docType].label}）
     {publicHow}
  …
  (blank)
  補件後不需重新排隊——您的順位仍依第一次送件的時間計算。
  ```
  plus an optional free-text supplement attached to the **first** reason only. Submit builds `selected.map((c,i)=>({code:c, documentType: REJECTION_META[c].docType, note: i===0 ? note||undefined : undefined}))`.
- Supporting: `StaffShell.tsx` (sidebar, nav 案件佇列 / 知識庫, actor switcher writing `document.cookie = "actor=…"` + `location.reload()`), `staffLabel.ts`, `KnowledgeBoard.tsx` (442 L: pending queue sorted by requestCount, `ToolCard`, `ResolveModal`, FAQ editing → `/api/staff`), `session.ts` (`getActor()` from cookie, `canApprove(actor) = role==="SUPERVISOR"`).

## A10. `lib/seed.ts` (1642 L)

- `export const STAFF = [{id:"s_lin",name:"林承辦",role:"REVIEWER"},{id:"s_wu",name:"吳承辦",role:"REVIEWER"},{id:"s_chang",name:"張科長",role:"SUPERVISOR"}]`.
- **`TOOLS: ToolVerdictEntry[]` — 18 entries (17 ACTIVE + 1 SUPERSEDED)**, each with aliases, vendor, reason, `chineseCapitalStatus`, `securityNotes{trainsOnUserData,dataResidency,hasEnterpriseTier,privacyPolicyUrl,notes}`, `evidenceLinks`, `createdBy/approvedBy`, `effectiveAt: 2026-04-01`:
  ELIGIBLE / NONE — `tv_chatgpt` ChatGPT Plus (OpenAI, OPT_OUT), `tv_claude` Claude Pro (Anthropic, NO), `tv_gemini` Gemini Advanced（Google One AI Premium）, `tv_copilot` Microsoft 365 Copilot, `tv_github_copilot` GitHub Copilot, `tv_midjourney` Midjourney, `tv_notion_ai` Notion AI.
  NOT_ELIGIBLE / CONFIRMED (Chinese capital) — `tv_doubao` 豆包（Doubao）, `tv_deepseek` DeepSeek, `tv_capcut` CapCut（剪映）, `tv_kling` Kling AI（快手可靈）, `tv_meitu` Meitu（美圖秀秀 / Wink / WHEE）, `tv_manus` Manus, `tv_senseavatar` SenseAvatar（商湯）.
  NOT_ELIGIBLE / NONE (resale & aggregator platforms) — `tv_poe` Poe.com, `tv_goingbus` GoingBus.
  CASE_BY_CASE — `tv_canva` Canva Pro (ACTIVE, v2) plus `tv_canva_v1` Canva Pro ELIGIBLE with `status:"SUPERSEDED"` (demonstrates D22 versioning).
- **`PENDING_TOOLS: PendingTool[]` — 6**, all `status:"PENDING"`, `relatedApplicationIds: []`: `pt_perplexity` "Perplexity Pro" ×23, `pt_cursor` "Cursor" ×17, `pt_suno` "Suno AI 音樂" ×11, `pt_elevenlabs` "ElevenLabs" ×6, `pt_kimi` "Kimi 月之暗面" ×4, `pt_grammarly` "Grammarly Premium" ×2.
- **`FAQS: FaqEntry[]` — 10** (`question / questionVariants[] / answer / category / viewCount / notHelpfulCount / isPinned?`): `faq_billing` 什麼是「出帳帳單」？(DOCUMENTS, pinned, 1842), `faq_privacy_mask` 為什麼要我上傳整份帳單？(PRIVACY, pinned, 967), `faq_purge` 我的證件照片會被保留多久？(PRIVACY, 412), `faq_revision_queue` 被退件補傳之後，是不是要重新排隊？(PROCESS, pinned, 1103), `faq_eligible_tool` 我買的 AI 工具可以申請嗎？(TOOLS, pinned, 2214), `faq_amount` 補助金額怎麼算？(ELIGIBILITY, 1567), `faq_qualification` 誰可以申請？(ELIGIBILITY, 1889), `faq_iphone` 我用 iPhone 拍的照片上傳後打不開？(DOCUMENTS, 328), `faq_card_photo` 一定要拍實體信用卡嗎？(DOCUMENTS, 702), `faq_regulation` 簡章去哪裡看？(REGULATION, pinned, 1345).
- **`PRESETS: RejectionPreset[]` — 5**: `rp_1` 帳單缺臺幣換算 `[BILLING_NO_TWD]` 214; `rp_2` 帳單缺臺幣換算 + 照片模糊 `[BILLING_NO_TWD, BILLING_UNREADABLE]` 96; `rp_3` 帳單看不到末四碼 `[BILLING_NO_CARD_DIGITS]` 73; `rp_4` 身分證住址不清 `[ID_ADDRESS_UNCLEAR]` 38; `rp_5` 遮罩蓋住必要資訊 `[OVER_MASKED]` 21.
- **Scheme/highlight config:** `BILL_HIGHLIGHTS` (6 relative-ratio boxes: chargeDate 扣款日期, merchantName 消費項目, foreignAmount 外幣金額, twdAmount 臺幣入帳金額 — element `A`; cardLast4 卡號末四碼, cardholderName 持卡人姓名 — element `B`), `CARD_HIGHLIGHTS` (2 boxes on the card image).
- **Demo cases: `CASES: CaseSpec[]` with `seq: 1…15` (15 cases).** `CaseSpec = {seq, applicant: Omit<Applicant,"id">, tier, toolId?, toolInput, channel, claimed, status, firstSubmittedAt, lastSubmittedAt?, reviewerId?, docs: DocSpec[], rejections?: [{round, code, docType?, note?, at}], history: [{transition, at, actorId, note?}], approvedAmount?, manualAssist?, paidByProxy?, intake?, demoNote?}`; `DocSpec = {type, preview, masked?, originalFormat?, revision?, isCurrent?, supersedesId?("prev" chains), uploadedAt?, qualityNote?, billing?: {twd|null, last4?, merchant?, date?, unreadable?}, cardLast4?}`. Coverage: 1 REVISION_SUBMITTED (twice-rejected, doc v1/v2/v3), 2 SUBMITTED (precheck PASS), 3 SUBMITTED, 4 SUBMITTED (uncatalogued tool + manual exit), 5 UNDER_REVIEW (last-4 7732 vs 4915 mismatch), 6 UNDER_REVIEW (LOW_INCOME), 7 NEEDS_REVISION (citizen revision guidance), 8 APPROVED, 9 DISBURSING, 10 DISBURSED (purge countdown), 11 REJECTED (NOT_ELIGIBLE Chinese capital), 12 SUBMITTED (PAPER intake, notification channel NONE), 13 SUBMITTED (proxy paid, CASE_BY_CASE tool), 14 CANCELLED_BY_STAFF (not Hsinchu), 15 WITHDRAWN.
- `buildSeed(): DBShape` (L1433+) expands every case into `applicants[] / applications[] / documents[] / rejectionReasons[] / statusEvents[] / notifications[]`; ids are deterministic (`ap_N`, `app_N`, `doc_N_i`), `caseNumber(seq, 2026)`; builds `supersedesId` chains per type; sets `documentsPurgeAt = last event + 180 days` for DISBURSED; runs `judgeBilling` on `DocSpec.billing`; helper snapshot builders `snapshotOf(toolId,…)` / `pendingSnapshot(userInput,…)`; local `notifyTitle`/`notifyBody`.

## A11. Core TS interfaces (verbatim, `/app/src/lib/types.ts`)

```ts
export interface Doc {
  id: string; applicationId: string; type: DocumentType; storageRef: string;
  isMasked: boolean; uploadedAt: string; checkResult?: CheckResult; purgedAt?: string;
  revision: number; supersedesId?: string; isCurrent: boolean;
  originalFormat: string; servedFormat: string;
  previewUrl?: string; qualityNote?: string; periodIndex?: number;
}

export interface Highlight {
  field: "merchantName"|"foreignAmount"|"twdAmount"|"chargeDate"|"cardLast4"|"cardholderName";
  label: string; x: number; y: number; w: number; h: number;  // relative 0–1
  element: "A" | "B";
}

export interface Extracted {
  merchantName?: string; foreignAmount?: number; currency?: string; twdAmount?: number;
  chargeDate?: string; cardLast4?: string; cardholderName?: string;
}

export interface CheckResult {
  verdict: Verdict; extracted: Extracted;
  failures: { code: RejectionCode; detail: string }[];
  highlights: Highlight[]; rawResponse?: string; checkedAt: string; manualReason?: string;
}

export interface ToolVerdictSnapshot {
  toolName: string; userInput: string;
  verdict: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_REVIEW";
  reason: string; securityNotes: string; verdictVersionId: string;
  effectiveAt: string; snapshotAt: string;
}

export interface Application {
  id: string; caseNumber: string; applicantId: string; status: Status;
  subsidyTier: SubsidyTier; toolVerdictSnapshot: ToolVerdictSnapshot;
  paymentChannel: PaymentChannel; claimedAmount: number; approvedAmount?: number;
  firstSubmittedAt?: string; lastSubmittedAt?: string; createdAt: string; updatedAt: string;
  assignedReviewerId?: string; documentsPurgeAt?: string;
  intakeChannel: IntakeChannel; enteredByStaffId?: string;
  manualAssistRequested?: boolean; paidByProxy?: boolean;
  billingCycle?: "MONTHLY" | "ANNUAL"; billingPeriods?: number;
  purchaseDate?: string; originalCurrency?: string; originalAmount?: number;
}

export interface Applicant {
  id: string; name: string; nationalId?: string; birthDate: string;
  household: string; mailingAddress?: string; phone: string; email: string; lineUserId?: string;
}

export interface RejectionReason {
  id: string; applicationId: string; round: number; code: RejectionCode;
  documentType?: DocumentType; note?: string; createdBy: string; createdAt: string;
}

export interface Notification {
  id: string; applicationId: string; channel: "LINE" | "EMAIL" | "NONE";
  triggeredBy: Transition; title: string; body: string; sentAt: string;
  deliveryStatus: "SENT" | "PENDING_MANUAL";
}

export interface ToolVerdictEntry {
  id: string; canonicalName: string; aliases: string[]; vendor: string;
  verdict: "ELIGIBLE" | "NOT_ELIGIBLE" | "CASE_BY_CASE";
  reason: string; chineseCapitalStatus: ChineseCapitalStatus; securityNotes?: SecurityNotes;
  alternatives: string[]; status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "SUPERSEDED";
  version: number; effectiveAt: string; supersedesId?: string;
  createdBy?: string; approvedBy?: string; evidenceLinks: string[];
}

export interface SecurityNotes {
  trainsOnUserData: "YES" | "NO" | "OPT_OUT" | "UNKNOWN";
  dataResidency: string; hasEnterpriseTier: boolean; privacyPolicyUrl?: string; notes?: string;
}

export interface PendingTool {
  id: string; userInput: string; requestCount: number;
  firstRequestedAt: string; lastRequestedAt: string; relatedApplicationIds: string[];
  status: "PENDING" | "RESOLVED" | "MERGED"; resolvedToolId?: string;
}

export interface FaqEntry {
  id: string; question: string; questionVariants: string[]; answer: string;
  category: FaqCategory; relatedLinks: string[]; isPinned?: boolean;
  viewCount: number; notHelpfulCount: number; updatedBy: string; updatedAt: string;
}

export interface Guide {
  channel: PaymentChannel; errorCode: RejectionCode | null; title: string;
  steps: { text: string; tip?: string }[];
  sampleImage: string; sampleCaption: string; mustShow: string[];
}

export interface RejectionPreset { id: string; label: string; codes: RejectionCode[]; useCount: number; }

export interface DBShape {
  applicants: Applicant[]; applications: Application[]; documents: Doc[];
  rejectionReasons: RejectionReason[]; statusEvents: StatusEvent[]; notifications: Notification[];
  tools: ToolVerdictEntry[]; pendingTools: PendingTool[]; faqs: FaqEntry[];
  presets: RejectionPreset[]; meta: { revision: number; seededAt?: string };
}

export interface Staff { id: string; name: string; role: ActorRole; }
```
Plus `PrecheckIssue` / `PrecheckResult` / `QualityProbe` in `rules.ts`, `MaskRect` / `LoadedImage` in `image.ts`, `CardOcrResult` in `creditCardOcr.ts`, `UploadedDoc` in `DocField.tsx`, `QueueRow` in `CaseQueue.tsx`, `ToolMatch`/`MatchKind` in `toolSearch.ts`.

## A12. `app/package.json`

```json
{ "name":"hsinchu-ai-subsidy", "version":"0.1.0", "private":true,
  "scripts": { "dev":"next dev", "build":"next build", "start":"next start", "lint":"eslint" },
  "dependencies": { "lucide-react":"^1.43.0", "nanoid":"^6.0.1", "next":"16.3.4",
                    "react":"19.2.8", "react-dom":"19.2.8", "tesseract.js":"^7.0.0" },
  "devDependencies": { "@tailwindcss/postcss":"^4", "@types/node":"^20", "@types/react":"^19",
                       "@types/react-dom":"^19", "eslint":"^9", "eslint-config-next":"16.3.4",
                       "tailwindcss":"^4", "typescript":"^5" } }
```
Porting notes to Vite/React: Next-specific surfaces are `next/navigation` (`useRouter().push/refresh`, `notFound`), `next/link`, `next/headers` `cookies()` in `session.ts`, `NextResponse` in the 4 route handlers, `export const dynamic = "force-dynamic"`, async `params`/`searchParams` promises in dynamic pages, `@/…` path alias (`tsconfig.json`), Tailwind v4 via `@tailwindcss/postcss`, and `db.ts`'s `node:fs` JSON store (`SUBSIDY_DATA_DIR` or `process.cwd()/data/db.json`, cached on `globalThis.__subsidydb`).

---

# B) proreview — `/Users/sam/Documents/MyProject/mixProject/proreview`

## B1. Layout, `ocr.js`, `server.js`, OCR output format

```
proreview/
  package.json      deps: tesseract.js ^6.0.1, @tesseract.js-data/chi_tra ^1.0.0, @tesseract.js-data/eng ^1.0.0
                    scripts: start = node server.js, test = node --test
  README.md         run instructions, flow, OCR/data notes, "PDF not supported"
  ocr.js            63 L
  server.js         143 L
  public/{index.html, app.js, app.css, layout.css, canvas.css, demo/*.png}
  scripts/make_demo.py
  test/ocr.test.js
  .gitignore        node_modules/ data/ ocr-data/ .DS_Store
```

**`/Users/sam/Documents/MyProject/mixProject/proreview/ocr.js`** — single shared tesseract worker, serialized through a promise `queue` so recognitions never overlap. `ensureLanguages()` copies `node_modules/@tesseract.js-data/{chi_tra,eng}/4.0.0_best_int/*.traineddata.gz` into `./ocr-data/` on first run (throws `Missing OCR language data: X. Run npm install.` if absent). `createWorker(['chi_tra','eng'], 1, {langPath: ocr-data, cachePath: ocr-data, gzip:true, cacheMethod:'none'})` — fully offline. `recognize(filePath)` calls `worker.recognize(filePath, {}, {blocks:true, text:true})`. `toLines(blocks)` walks `block.paragraphs[].lines[]`, drops empty text or missing bbox, sorts by `bbox.y0` then `bbox.x0`. Exports `{recognize, toLines, shutdown}`.

**Exact OCR output shape:**
```js
{
  text: data.text || '',                 // full page text
  confidence: Math.round(data.confidence || 0),
  lines: [                               // sorted by bbox.y0, then bbox.x0
    {
      text: line.text.trim(),
      confidence: Math.round(line.confidence || 0),
      bbox: line.bbox,                   // { x0, y0, x1, y1 } in source-image pixels
      words: [
        { text: word.text.trim(), bbox: word.bbox, confidence: Math.round(word.confidence || 0) }
      ]                                  // words with blank text filtered out
    }
  ]
}
```
Note the field order inside `words` differs from lines (`text, bbox, confidence`); empty-text lines and bbox-less lines are dropped entirely.

**`/Users/sam/Documents/MyProject/mixProject/proreview/server.js`** — raw `node:http`, bound to `127.0.0.1`, `PORT = process.env.PORT || 4173`. Storage: `data/store.json` (atomic write via `.tmp` + rename), uploads in `data/uploads/`. `MAX_IMAGE = 12MB`, request body cap 18MB. `DOC_TYPES = {receipt, payment, identity, bank, declaration, other}`, `RULE_TYPES = {any, ...DOC_TYPES}`. Seeds a starter store on first boot: one demo case (`id:"demo"`, 示範申請人, status 待審核, two demo documents `/demo/demo-receipt.png` + `/demo/demo-payment.png`) and **3 rules**:
```js
{ id:'product',   label:'品項',       documentType:'any', keywords:'品項,產品,商品,Product,Description,Plan,服務', pattern:'', required:true }
{ id:'price',     label:'價格',       documentType:'any', keywords:'價格,金額,扣款,總額,Total,Amount,TWD,NT$,USD,US$',
  pattern:'(?:NT\\$|TWD|NTD|USD|US\\$|\\$)\\s*[\\d,]+(?:\\.\\d{2})?|[\\d,]+(?:\\.\\d{2})?\\s*(?:TWD|NTD|USD)', required:true }
{ id:'cardLast4', label:'卡號末四碼', documentType:'any', keywords:'末四碼,卡號,Card,Ending',
  pattern:'(?:[•*xX-]\\s*){2,}\\d{4}|\\b\\d{4}\\b', required:true }
```
API (all JSON, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`):
| Method + path | Behavior |
|---|---|
| `GET /api/state` | whole store `{cases, rules, reviews}` |
| `POST /api/cases` | requires `name`; creates case status 待審核, `submittedAt` = today, unshifted to front |
| `PATCH /api/cases/:id` | edits name/phone/email/note/status; status whitelist `['待審核','審核中','待補件','已通過','需人工複核']`; **rejects 已通過 when any `required` rule's review status ≠ 符合** |
| `POST /api/cases/:id/documents` | body `{type, name, dataUrl}`; dataUrl must match `/^data:(image\/(?:png\|jpeg\|webp));base64,([A-Za-z0-9+/=]+)$/`, ≤12MB; writes `data/uploads/<uuid>.<ext>`, url `/uploads/<uuid>.<ext>` |
| `POST /api/cases/:id/documents/:docId/scan` | resolves `/demo/*` to `public/demo/`, else `data/uploads/`; `await recognize(path)`; re-reads the store before writing `document.ocr = result` (avoids clobbering concurrent edits) |
| `POST /api/rules` | validates `label` + `documentType ∈ RULE_TYPES` + compiles `pattern` with `new RegExp(pattern,'i')` |
| `DELETE /api/rules/:id` | removes rule |
| `PUT /api/cases/:id/reviews/:ruleId` | stores `reviews["<caseId>:<ruleId>"] = {value, status ∈ ['待確認','符合','不符','無法辨識'] (default 待確認), note, updatedAt}` |
Static serving: GET only, `/uploads/*` rebased to `data/uploads`, path-traversal guard `filePath.startsWith(base + sep)`, extension must be in the `MIME` map (html/css/js/svg/png/jpg/jpeg/webp). Exports `{server}`; listens only when `require.main === module`.

## B2. `public/` UI

Files: `index.html` (61 L), `app.js` (288 L), `app.css` (5 L), `layout.css` (57 L), `canvas.css` (58 L).

**Shell** (`index.html`): left icon rail (▣ 文件檢視 `#rail-viewer`, ☑ 查核資訊 `#rail-review`, ☷ 案件清單 `#rail-cases`, ⚙ 欄位設定 `#rail-rules`, plus a "LOCAL" badge) + `.workspace` = `section.document-canvas` (left) + `aside.inspector` (right). Four native `<dialog class="modal">`: `#cases-dialog`, `#case-dialog` (`#case-form`), `#rules-dialog` (`#rule-form`), `#review-dialog` (`#review-form`), plus `#toast`. The rail buttons toggle `document.body.classList.toggle('show-review')` for narrow screens.

**Canvas: pan/zoom + OCR highlight** — `app.js`:
- `renderCanvas()` paginates **2 documents per page** (`visibleDocuments()` = `slice(canvasPage*2, +2)`), emits a `.canvas-grid` (`.one` modifier for a single tile) of `.canvas-tile > .canvas-image-wrap > img + .highlight-layer`; caption shows `已辨識 N 行` or `待掃描`; empty state offers an upload button.
- `fitCanvasImages()` computes `fit = Math.min((tile.clientWidth-12)/naturalWidth, (tile.clientHeight-38)/naturalHeight, 1)` and sets the wrapper's px width/height so the image is letterboxed; re-run on `img.onload`, `requestAnimationFrame`, and `window.resize`.
- `applyCanvasTransform()` sets `grid.style.transform = translate(panX,panY) scale(zoom)` and clamps pan to `±max(stage.clientWidth*0.35, (grid.clientWidth*zoom - stage.clientWidth)/2 + 80)` (same for Y).
- `changeCanvasZoom(delta)` clamps zoom to **[0.7, 3]** rounded to 2 decimals; `resetCanvasView()` → zoom 1, pan 0,0.
- Drag: `pointerdown` (button 0, not on a `button`) records start + current pan and calls `setPointerCapture`, `pointermove` updates pan, `pointerup`/`pointercancel`/`lostpointercapture` end it; `dragstart` is prevented. Wheel zooms ±0.1 with `{passive:false}` + `preventDefault`.
- `renderHighlights()` — for each tile, finds which rules' `detected()` result belongs to that document, then converts the **line bbox in natural-image pixels** to percentages with a 5% pad: `padX=(x1-x0)*.05`, `padY=(y1-y0)*.05`, clamped to `[0, naturalWidth/Height]`, emitted as `<div class="highlight selected|all flash" style="left:%;top:%;width:%;height:%">` inside `.highlight-layer` (`position:absolute; inset:0; pointer-events:none`). So highlights are plain DOM boxes over the `<img>`, **not** a `<canvas>` overlay — they scale automatically with the CSS transform.
- `selectRule(ruleId)` ("定位圖片"): resets view, flips `canvasPage = Math.floor(index/2)` to the page holding the evidence, sets `flashRuleId` for 1400 ms, or toasts 「這個欄位尚未找到 OCR 證據」.

**Field rule cards (待確認/符合/不符/無法辨識 + manual override)**:
- `detected(rule)` is the matching engine: candidate documents = those with OCR lines whose `type` matches `rule.documentType` (or `any`). Keyword list is comma-split/lowercased. Keyword preference order: first Latin-containing keyword found in the lowercased line, else any keyword found, else a whitespace-stripped ("compact") match. A line is skipped if keywords exist and none match, or if a pattern exists and does not match. Extracted `value` = regex match, else the text after the keyword with leading `[\s:：#—–\-/]+` stripped, else the whole line. Scoring: `10 + (match ? 3 : 0) + confidence/100 + preference`, where preference = for `price`: `+6` if the doc is `payment` and `+6` if the line contains `NT$|TWD|NTD`; for `product` on `receipt`: `+2`; for `cardLast4` on `payment`: `+2`. Highest score wins.
- `renderGroups()` paginates rules **3 per page** (`review-pager` with 上一頁/下一頁) and shows progress `符合 count / total`.
- `renderRuleCard(rule)` status resolution: `review?.status || (found ? '待確認' : hasDocument ? '未找到' : '待上傳')`; value = `review?.value || found?.value || ''` (placeholder 「尚未辨識」). `statusClass`: 符合→`pass`, 不符→`fail`, 待確認→`found`, else none. Two buttons per card: 定位圖片 (`selectRule`) and 覆核 (`openReview`).
- **Manual override** = `#review-dialog` / `openReview(ruleId)` prefills `value` with the existing review value or `detected(rule)?.value`, `status` select (待確認 / 符合 / 不符 / 無法辨識) and free-text `note`; `saveReview()` `PUT`s to `/api/cases/:case/reviews/:rule` and re-renders.

**Field config dialog** — `#rules-dialog` + `renderRuleList()` + `#rule-form` submit → `POST /api/rules` with `{label, documentType, keywords, pattern, required}` (`required` read from the checkbox); each listed rule has a delete button guarded by `confirm()` → `DELETE /api/rules/:id`. Opened from `#manage-rules` or `#rail-rules`.

**Decision bar** — `.decision-bar` with three `[data-decision]` buttons: 要求補件 (`待補件`), 人工複核 (`需人工複核`), 完成審核 (`已通過`). The handler blocks 已通過 client-side when any required rule's review status ≠ 符合 (`尚有 N 個必填欄位未確認符合`) and the server re-checks the same rule; otherwise `PATCH /api/cases/:id {status}` + reload + toast.

Other `app.js` functions worth naming for a port: `$`, `escapeHTML`, `getCase`, `reviewKey(rule)` → `` `${activeCaseId}:${rule.id}` ``, `toast`, `request(path,options)` (throws `result.error`), `reload(preserve)`, `render`, `renderCaseList`, `uploadFile(file)` (client-side type/size guard then `FileReader.readAsDataURL`), `scanAllDocuments()` (sequential per-document scan with 辨識中 i/N button text), `openDialog/closeDialog`, `setupEvents()`. Module-level state: `state{cases,rules,reviews}, activeCaseId, selectedRuleId, flashRuleId, flashTimer, editorRuleId, reviewPage, canvasPage, canvasZoom, canvasPanX, canvasPanY, editCase, busy, toastTimer`.

## B3. `scripts/` and `test/`

- **`/Users/sam/Documents/MyProject/mixProject/proreview/scripts/make_demo.py`** (79 L) — Pillow script generating the two fictional demo PNGs into `public/demo/`: `demo-receipt.png` (1000×1260, "NORTHSTAR AI" header, 示範資料 / DEMO ONLY, receipt no. `DEMO-2026-0918-001`, rows 訂閱人/Email/產品 `Northstar AI Pro Plan`/公司/日期/期間/付款方式 `Visa ending 4826`) and `demo-payment.png`. Fonts are hardcoded Windows paths (`C:/Windows/Fonts/msjh.ttc`, `msjhbd.ttc`) with a `ImageFont.load_default()` fallback — will render poorly on macOS/Linux. Helpers `font(size,bold)`, `text(draw,xy,value,size,fill,bold)`, `line(draw,y,width)`.
- **`/Users/sam/Documents/MyProject/mixProject/proreview/test/ocr.test.js`** (14 L) — single `node:test` case "offline OCR reads payment evidence and returns image coordinates": recognizes `public/demo/demo-payment.png`, asserts `result.text` matches `/4826/` and `/648/`, `result.lines.length > 5`, and that some line containing `4826` has `bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0`; then `await shutdown()`. Run with `npm test` (`node --test`).