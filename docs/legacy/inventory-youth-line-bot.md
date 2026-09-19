# youth-line-bot — Porting Inventory (TypeScript → Python)

Node ≥20, CommonJS/TS 5.6, Express 4.21, better-sqlite3 11, @line/bot-sdk 9.5, zod 3.23, csv-parse 7, vitest 2. `package.json:1-60`.

---

## 1. Directory layout

```
/Users/sam/Documents/MyProject/mixProject/youth-line-bot/
├── src/
│   ├── index.ts              (63)  listen/EADDRINUSE handler/SIGINT+SIGTERM shutdown
│   ├── app.ts                (105) createApp() + bootstrap()
│   ├── config/env.ts         (141) env object, isLineConfigured(), checkLineCredentialShape(), projectRoot
│   ├── db/
│   │   ├── index.ts          (122) Db interface, SqliteDb, getDb/migrate/ensureColumn/createInMemoryDb/closeDb
│   │   ├── schema.ts         (219) SCHEMA_SQL, ADMIN_SCHEMA_SQL, ADDED_COLUMNS
│   │   ├── authSchema.ts     (44)  AUTH_SCHEMA_SQL, VERSIONED_TABLES, AUTH_ADDED_COLUMNS
│   │   ├── syncSchema.ts     (37)  SYNC_SCHEMA_SQL (sync_logs)
│   │   ├── userSchema.ts     (35)  USER_SCHEMA_SQL (admin_users), USER_ADDED_COLUMNS
│   │   └── migrate.ts        (6)   CLI entry
│   ├── models/{caseStatus.ts (189), types.ts (135)}
│   ├── content/{registry.ts (745), contentService.ts (214), statusCopy.ts (35)}
│   ├── line/
│   │   ├── webhook.ts (80), client.ts (72), theme.ts (51)
│   │   ├── richMenu.ts (251), richMenuSync.ts (355)
│   │   ├── messages/templates.ts (138)
│   │   ├── flex/{caseTimeline.ts (185), caseList.ts (91), subsidyCards.ts (334)}
│   │   └── handlers/{eventHandler.ts (199), flows.ts (15), caseFlow.ts (83),
│   │                 eligibilityFlow.ts (104), applyHelper.ts (324), infoHandlers.ts (205)}
│   ├── repositories/ (14 files) case, subsidy, faq, knowledge(+importRun), user(+userCase),
│   │                 notification, conversation, content, media, audit, syncLog,
│   │                 adminSession, adminUser, mappers
│   ├── services/ caseService(167) subsidyService(143,+checklistService) faqService(89)
│   │             eligibilityService(136) intentService(152) notificationService(146)
│   │             previewService(181) mediaService(156) versionGuard(102) adminAuthService(239)
│   │             ai/{aiService(62), ragService(69), securityCheckService(99), types(66)}
│   ├── controllers/ case(137) admin(382) misc(215) auth(92) content(146)
│   ├── routes/{api/index.ts (152), schemas.ts (171)}
│   ├── middleware/{auth.ts (109), validate.ts (34), errorHandler.ts (33), loginRateLimit.ts (81)}
│   ├── import/{importService(166), csvSource(48), seedImporter(105), runImport(61), types(26)}
│   └── utils/{date.ts (41), logger.ts (52), mask.ts (31), phone.ts (13)}
├── scripts/ demo.ts(153) benchLine.ts(122) verifyAdminToLine.ts(116) setupRichMenu.ts
│            notifyTest.ts seed.ts resetDb.ts adminPassword.ts
├── tests/ helpers.ts + 10 *.test.ts (see §14)
├── data/ youth.db (233 KB, real data), uploads/ (empty), mock/{subsidies.json, faqs.json,
│        knowledge.json, cases.csv, cases-update.csv}
├── deploy/{install.sh (122, systemd unit), README.md (150, Cloudflare Tunnel)}
├── assets/{richmenu.jpg (2500x1686, the one uploaded), richmenu-source-original.png}
├── public/admin/ index.html, login.html, css/admin.css (1965),
│                 js/{app.js, api.js, ui.js, icons.js, linePreview.js, login.js},
│                 js/pages/{dashboard, cases, subsidies, faqs, contents, media,
│                           richmenu, notifications, settings}.js
└── 1.png (rich-menu image fallback candidate), .env, .env.txt, .env.example, vitest.config.ts
```

---

## 2. LINE webhook: signature, dispatch, routing

`src/line/webhook.ts`

- **Raw body capture** happens in `express.json({limit:'6mb', verify})` → `req.rawBody: Buffer` — `src/app.ts:19-26`. Not a second parser.
- **`verifySignature(rawBody, signature, secret)`** `webhook.ts:14-24`: `HMAC-SHA256(secret, rawBody)` → base64, compared with `crypto.timingSafeEqual` after an explicit length check. Any throw → `false`.
- **`POST /webhook`** `webhook.ts:53-78`:
  1. If `isLineConfigured()` (both secret+token non-empty): missing rawBody or bad `x-line-signature` → `401 {error:'invalid signature'}`.
  2. If not configured: logs `LINE credentials missing - webhook signature check skipped` and **accepts unsigned** events (offline/demo mode).
  3. Responds `200 {ok:true, received:N}` **before** processing, then `for (const event of events) void dispatch(event)` — fire-and-forget, no await, no queue.
- **`dispatch(event)`** `webhook.ts:26-49`: `messages = await buildEventReply(event)`; if empty or no replyToken → return; else `getLineSender().reply(replyToken, messages)`. On error: logs with masked userId and best-effort replies `'😥 系統忙碌中，請稍後再試一次。'`; a second failure is swallowed.
- **Sender** `src/line/client.ts`: `LineSender {reply, push, enabled}`. `RealLineSender` slices messages to **5** before `replyMessage`/`pushMessage`. `NoopLineSender` (used when credentials absent) records into `.sent[]`. Singleton via `getLineSender()`, injectable via `setLineSenderForTesting()`.
- **Event routing** `src/line/handlers/eventHandler.ts:172-199` `buildEventReply(event)`:
  - no `event.source.userId` → `[]`
  - always `userRepository.touch(lineUserId)` first
  - `follow` → `conversationRepository.clear()` + `messages.welcome()`
  - `postback` → `handlePostback(userId, event.postback.data ?? '')`
  - `message.text` → `handleText`; `message.image` → `messages.imageNotSupported()`; other message types → `messages.nonTextMessage()`
  - everything else (join/leave/unfollow/…) → `[]`
- **Text routing order** `eventHandler.ts:107-166`: classify first → if `CANCEL`, clear state and return. Then **active flow wins**: `state.flow === 'case_query'` → `caseFlow.handleInput`; `=== 'eligibility'` → `eligibilityFlow.handleInput`. Note: flows `apply_helper` and `checklist` are *not* consulted for text — they only react to postbacks. Then intent switch:
  - `CASE_STATUS` (+`entities.caseId`) → `caseFlow.start()` then immediately `caseFlow.handleInput(AWAIT_CASE_ID, {}, caseId)` (jumps to phone step)
  - `MY_CASES`→`caseFlow.myCases`; `FAQ`→`infoHandlers.answerQuestion(input)`; `SUBSIDY_INFO`→`subsidyMenu`
  - `ELIGIBILITY_CHECK` → `subsidyService.findByMention(input)` ? `applyHelper.pick(id)` : `applyHelper.start()`
  - `CHECKLIST` → text `apply.need_subsidy_first` + `subsidyMenu().slice(1)`
  - `CONTACT`→`contact`; `SECURITY_CHECK`→`securityCheck(input)`; `GREETING`/`HELP`→`welcome()`
  - default → `infoHandlers.answerQuestion(input)`
- **Postback parsing** `eventHandler.ts:40-44`: `new URLSearchParams(data)` → `Record<string,string>`; `params.action` selects the branch.

---

## 3. Postback action table (complete)

Action constants at `eventHandler.ts:17-38`; dispatch at `:52-100`. Data format is always `action=<name>&k=v&…` (URL-encoded query string, ≤300 bytes — the reason document refs travel as indices).

| action | params | behaviour |
|---|---|---|
| `case_status` | — | `caseFlow.start()`: set state `case_query/await_case_id`, ask for 8-digit case id |
| `refresh_case` | `caseId` | `caseFlow.refresh()`: re-render timeline **only if** this LINE user is linked to the case, else `verificationFailed` |
| `my_cases` | — | `caseFlow.myCases()`: 0 → `mycase.empty`; 1 → timeline bubble; ≥2 → `buildMyCasesMessage` |
| `faq` | — | `infoHandlers.faqMenu()`: `faq.menu_intro` with top-8 questions + category quick replies |
| `faq_category` | `category` | up-to-5 Q/A joined by `────────`, prefixed `【category】` |
| `subsidy_info` | — | `subsidy.menu_intro` + browse quick replies + `buildSubsidyCarousel(all active)` |
| `subsidy_category` | `category` | carousel titled `「{category} 補助」`, or `subsidy.category_empty` |
| `subsidy_latest` | — | `subsidyService.latest(10)` — sorted by `applicationStart` DESC — carousel altText `最新補助` |
| `subsidy_closing` | — | `subsidyService.closingSoon(10)` — still-open, `applicationEnd` ASC — altText `即將截止的補助` |
| `subsidy_detail` | `subsidyId` | single-bubble carousel for that subsidy, else `subsidy.not_found` |
| `apply_start` | — | `applyHelper.start()`: clears state, lists ≤11 subsidies as text + picker quick reply (+「其他補助」) |
| `apply_pick` | `subsidyId` | `applyHelper.pick()`: set state `apply_helper/preparing {subsidyId, checked}` and render the 5-section giga bubble |
| `apply_toggle` | `subsidyId`, `i` (or legacy `item`) | tick/untick a required document by **index**, persist in state, re-render the apply bubble |
| `apply_other` | — | `applyHelper.otherHint()` text + `eligibilityFlow.start()` (6-question wizard) |
| `eligibility` | — | **aliases to `applyHelper.start()`** (Rich Menu tile 3), not the wizard |
| `eligibility_answer` | `key`, `value` | record answer into state data; ask next question or finish with match carousel |
| `checklist` | `subsidyId` | set state `checklist/browsing`, render `buildChecklistMessage` |
| `toggle_doc` | `subsidyId`, `i` (or legacy `item`) | toggle in `checklist` flow state, re-render checklist bubble |
| `contact` | — | `messages.contact()` (unit/phone/email/address/hours from content keys) |
| `cancel` | — | clear conversation state, `error.cancelled` |
| *(unmatched / unknown)* | — | `messages.unknown()` → `home.unknown` |

Other postback data emitted by builders but routed by the same table: `action=refresh_case&caseId=` (timeline footer + case-list rows), `action=my_cases` (timeline footer), `action=apply_pick&subsidyId=` (subsidy card「我想申請」), `action=checklist&subsidyId=`, `action=subsidy_detail&subsidyId=`, `action=apply_start` (「換一個補助」), plus the 6 main-menu quick replies (`case_status/faq/subsidy_info/my_cases/eligibility/contact`) and `action=cancel`.

---

## 4. Conversation state machine

Table `conversation_states` (`src/db/schema.ts:112-118`): `line_user_id` PK, `flow`, `step`, `data` (JSON TEXT, default `'{}'`), `updated_at`. **One row per user — starting any flow replaces the previous one.** `src/repositories/conversationRepository.ts`: `get` (JSON.parse with `{}` fallback on error), `set` (UPSERT `ON CONFLICT(line_user_id) DO UPDATE`), `clear` (DELETE). **No TTL, no expiry, no sweeper** — state survives forever until overwritten or cleared (verified: no purge code references `conversation_states`).

Flow ids (`src/line/handlers/flows.ts` + inline constants):

| flow | steps | `data` shape | set at |
|---|---|---|---|
| `case_query` (`Flow.CASE_QUERY`) | `await_case_id` → `await_phone` | `{}` then `{caseId: string}` | `caseFlow.ts:19,34` |
| `eligibility` (`Flow.ELIGIBILITY`) | `question:0` … `question:5` | `{age?, identity?, isStudent?, isEmployed?, residency?, interest?}` — all raw option strings | `eligibilityFlow.ts:31` |
| `apply_helper` (const `APPLY_FLOW`, `applyHelper.ts:26`) | `preparing` | `{subsidyId: string, checked: string[]}` (document **names**) | `applyHelper.ts:285,304` |
| `checklist` (const `CHECKLIST_FLOW`, `infoHandlers.ts:12`) | `browsing` | `{subsidyId: string, checked: string[]}` | `infoHandlers.ts:158,171` |

Cleared on: `follow`, `cancel` postback, `CANCEL` intent, after successful/failed phone verification (`caseFlow.ts:44`), at `applyHelper.start()` (`:254`), at wizard `finish()` (`eligibilityFlow.ts:59`), and on an unrecognised step (`caseFlow.ts:53`, `eligibilityFlow.ts:94`).

`checked` is read back only when `state.flow` matches **and** `state.data.subsidyId === subsidyId`, otherwise treated as `[]` (`applyHelper.ts:244-249`, `infoHandlers.ts:151-154`) — so switching subsidy silently resets ticks.

Eligibility answer normalisation (`eligibilityFlow.ts:37-56`): `"23-27"` → `age = 23` (lower bound); `isStudent/isEmployed = (value === '是')`; `interest === '都看看'` is dropped. Free-typed text while a question is pending is accepted verbatim as that question's answer (`:91-103`).

---

## 5. Case verification (two-factor)

**Note: the second factor is the FULL mobile number, not last-4.** No last-4 logic exists anywhere in the repo.

- Format gates, `src/line/handlers/caseFlow.ts`: case id `CASE_ID_RE = /^\d{8}$/` after stripping spaces and `-` (`:11,28`); phone `isValidTwMobile` = `/^09\d{8}$/` on the normalised form (`src/utils/phone.ts:8-10`).
- `normalizePhone` (`phone.ts:2-6`): strip all non-digits; a leading `886` becomes `0` + rest. So `0912-345-678`, `+886912345678`, `0912345678` all compare equal.
- **Existence is deliberately not checked at the case-id step** (`caseFlow.ts:32-34`) — confirming a case number before the phone would leak which numbers are real.
- `caseRepository.findByIdAndPhone` (`src/repositories/caseRepository.ts:46-50`): `findById` then compare `normalizePhone(stored) === normalizePhone(input)`; returns `null` for both "no such case" and "wrong phone".
- `caseService.verify` → `{ok:true, case} | {ok:false, reason:'VERIFICATION_FAILED'}` (`src/services/caseService.ts:17-95`); logs masked (`maskCaseId`→`2026****`, `maskPhone`→`****678`).
- `caseService.verifyAndLink(caseId, phone, lineUserId)` (`:98-108`): on success writes `user_cases` (`UNIQUE(line_user_id, case_id)`), which is the *only* thing that grants later read access.
- On success LINE gets: `buildCaseTimelineMessage(view)` + `case.link_success`. On failure: the single uniform `case.verify_failed` message, then the state is cleared either way (`caseFlow.ts:44-50`).
- Public HTTP twin: `POST /api/cases/verify` (`src/controllers/caseController.ts:81-92`) — byte-identical `401 {error:'verification_failed', message:'案件編號或手機號碼驗證失敗，請確認資料後再試。'}`. Body schema `verifyCaseSchema` = `{caseId: /^\d{6,12}$/, phone: TW mobile}` (`src/routes/schemas.ts:11-19,50-53`).
- Read-after-verify: `getForLineUser` returns `null` unless `userCaseRepository.isLinked` (`caseService.ts:114-117`).

**Lockout rules: there are NONE for case verification.** No attempt counter, no cooldown, no per-user or per-case throttle. The only rate limiting in the codebase is on staff sign-in: `src/middleware/loginRateLimit.ts` — in-memory `Map`, key = `x-forwarded-for[0] || req.ip || socket.remoteAddress`, `WINDOW_MS = 15 min`, `MAX_ATTEMPTS = 10`; exceeding it sets `blockedUntil = now + 15 min` and returns `429 {error:'too_many_attempts'}`; a successful login calls `clearLoginAttempts`; map is swept when it exceeds 500 entries. This is a **porting gap worth flagging**: the LINE verification path is unthrottled.

---

## 6. Flex message builders

Colours all come from `src/line/theme.ts` (`PRIMARY #5B8AC4`, `PRIMARY_LIGHT #E8EFF7`, `PRIMARY_SOFT #8FAFD4`, `BACKGROUND #F4F7FA`, `CARD #FFFFFF`, `TEXT #333B45`, `TEXT_SECONDARY #6B7A8C`, `TEXT_MUTED #9AA7B5`, `BORDER #DCE4EC`, `ON_PRIMARY #FFFFFF`, `ON_PRIMARY_MUTED #FFFFFFCC`, `SUCCESS #4E9E7E`, `INFO #5B8AC4`, `WARNING #D9954A`, `ERROR #C0665E`).

**`src/line/flex/caseTimeline.ts`**
- `buildCaseTimelineBubble(view: CaseView): FlexBubble` (`:54-156`) — brand-blue header (`case.card_eyebrow` eyebrow + `{emoji} {label}`); body = status chip (`case.status_chip` with `{{status}}`, dot tinted by `STATUS_META[status].color`), info rows (`case.field.case_id/applicant/subsidy/submitted_at/updated_at`, conditional `supplement_deadline` and `payment_date`), separator, `case.timeline_title` + 5 timeline rows, separator, `case.next_action_title` + `view.nextActionText`; footer = primary button `button.refresh_case` → `action=refresh_case&caseId=…`, secondary `button.my_cases_secondary` → `action=my_cases`.
- Markers map (`:15-20`): `done '✓' PRIMARY_SOFT regular`, `current '●' PRIMARY bold`, `blocked '⚠' WARNING bold`, `upcoming '○' TEXT_MUTED regular`.
- `buildCaseTimelineMessage(view)` → `{type:'flex', altText:'案件 {caseId} 目前狀態：{statusLabel}'}`.
- `buildCaseTimelineText(view)` (`:167-185`) — plain-text fallback used by tests/logs.

**`src/line/flex/caseList.ts`**
- `buildMyCasesBubble(entries: {record: SubsidyCase, subsidyName: string|null}[])` (`:45-74`) — header `mycase.title` + `mycase.subtitle` (`{{count}}`); body = ≤10 tappable rows (whole row action `action=refresh_case&caseId=`) each showing caseId / `{emoji} {statusLabel}` tinted / subsidy name / `mycase.updated_prefix` + date; trailing `mycase.hint`.
- `buildMyCasesMessage` (altText `我的案件（N 件）`), `buildMyCasesText`.

**`src/line/flex/subsidyCards.ts`**
- `header(eyebrow, title)` shared helper (`:22-33`), `kv(label, value)` (`:9-19`).
- `buildSubsidyBubble(subsidy)` (`:35-121`) — size `mega`; optional `hero` image only when `mediaService.absoluteUrl(imageUrl)` matches `^https://` (LINE fetches it itself); header eyebrow = `subsidy.category`, title = name; body = description + 6 kv rows (`subsidy.field.eligibility/age/period/amount/method/contact`, with `subsidy.age_unlimited` and `subsidy.period_unset` fallbacks); footer = primary `我想申請` → `action=apply_pick&subsidyId=`, secondary `button.checklist` → `action=checklist&subsidyId=`, optional link `button.official_url` → uri.
- `buildSubsidyCarousel(subsidies, altText='補助資訊')` — **slices to 10 bubbles**.
- `buildSubsidyText(subsidy)` (`:131-148`).
- `buildChecklistBubble(checklist: ChecklistView)` (`:150-237`) — header `apply.checklist_eyebrow` + subsidy name; rows `☑/☐` + name (strikethrough when checked), item action `action=toggle_doc&subsidyId=…&i={index}`; summary `apply.checklist_done` or `apply.checklist_missing` (`{{count}}`) + `（checked/total）`; `apply.checklist_empty` when no documents.
- `buildChecklistMessage` (altText `{name} 文件準備清單`), `buildChecklistText`.
- `buildEligibilityResultMessage(matches: EligibilityMatch[], disclaimer)` (`:257-333`) — carousel of `mega` bubbles, eyebrow `apply.result_eyebrow` (`{{index}}`), body = description + `apply.reasons_title` bullets + `apply.caveats_title` bullets, footer = `button.subsidy_detail` → `action=subsidy_detail&subsidyId=` + disclaimer. altText `符合條件的補助建議`.

**`src/line/handlers/applyHelper.ts`** (the largest builder, not under `flex/`)
- `buildApplyBubble(subsidy, checkedItems)` (`:83-225`) — size `giga`; header `📝 申請小幫手` + subsidy name; body sections: `① 資格檢查` (age range / `設籍或居住於{residencyRequirement}` / `eligibility`), `② 應備文件` (tappable `☐/☑` rows → `action=apply_toggle&subsidyId=…&i=…`, plus a "still needed" summary box), `③ 申請期限` via `deadlineSummary()` (`:73-81`: `start ~ end（已截止 / 今天最後一天 / 還有 N 天）`), `④ 申請方式` + optional `補助額度`, `⑤ 注意事項` rendered from `subsidy.details[] {label,value}`; footer = optional uri `查看官方資料`, secondary `換一個補助` → `action=apply_start`, and a fixed disclaimer line. All copy here is **hard-coded Chinese, not content-registry keys**.
- `subsidyPickerQuickReply(subsidies)` (`:28-49`) — ≤11 items, labels truncated to 20 chars with `…`, plus 其他補助.
- `resolveDocument(subsidy, ref)` (`:239-242`) — numeric ref → index into `requiredDocuments`; otherwise accepts a literal name (back-compat with old buttons).

**Quick-reply builders** `src/line/messages/templates.ts`: `buildMainMenuQuickReply()` (6 fixed items — labels from `button.*` keys sliced to 20 chars, `data` hard-coded), `buildCancelQuickReply()`, plus legacy getter-backed `mainMenuQuickReply` / `cancelQuickReply`. `messages.*` factory returns `welcome, askCaseId, askPhone, verificationFailed, invalidCaseIdFormat, invalidPhoneFormat, cancelled, caseLinked, noLinkedCases, contact, unknown, error, imageNotSupported, nonTextMessage`.

---

## 7. Rich menu

`src/line/richMenu.ts`
- `RICH_MENU_SIZE = {width: 2500, height: 1686}`; `COLS=3`, `ROWS=2`; `TILE_W=833.33`, `TILE_H=843`. `bounds(col,row)` (`:23-30`) rounds and snaps the last column/row to the canvas edge so the six areas tile exactly (test asserts `Σ area === 2500*1686`).
- `RICH_MENU_TILES` (`:58-107`), order = artwork order:

| # | col,row | artworkLabel | postbackData | displayText |
|---|---|---|---|---|
| 1 | 0,0 | 案件進度 | `action=case_status` | 案件進度 |
| 2 | 1,0 | 補助資訊 | `action=subsidy_info` | 補助資訊 |
| 3 | 2,0 | 申請小幫手 | `action=eligibility` | 申請小幫手 |
| 4 | 0,1 | 我的案件 | `action=my_cases` | 我的案件 |
| 5 | 1,1 | 常見問題 | `action=faq` | 常見問題 |
| 6 | 2,1 | 聯絡我們 | `action=contact` | 聯絡我們 |

Documented caveat at `:43-57`: the shipped artwork prints 補助資訊 on tile 3; the tap target is correct.
- `buildRichMenuRequest()` (`:109-125`): `{size, selected:true, name:'青年補助智慧助手主選單', chatBarText:'開啟選單', areas:[{bounds, action:{type:'postback', label, data, displayText}}]}`.
- `IMAGE_CANDIDATES` (`:128-134`), in order: `assets/richmenu.jpg`, `assets/richmenu.png`, `<root>/1.png`, `<root>/richmenu.png`; `findRichMenuImage(explicitPath?)` prepends a cwd-resolved explicit path.
- `inspectImage(path)` (`:155-199`): hand-rolled PNG (magic `89504e470d0a1a0a`, dims at offsets 16/20) and JPEG (walk segments to first SOF) header reader. Accepts only `2500x1686`, `2500x843`, `1200x810`; rejects > 1 MiB. Returns `{path,width,height,bytes,contentType,valid,problems[]}`.
- `deployRichMenu({imagePath?, replaceExisting=true})` (`:212-251`) — CLI path: delete all existing menus, create, upload blob, `setDefaultRichMenu`.

`src/line/richMenuSync.ts` (dashboard path, `RESOURCE='richmenu'`)
- `SyncState = 'synced' | 'different' | 'missing' | 'not_configured' | 'unknown'`.
- `status()` (`:132-235`) — read-only: `getRichMenuList()` + `getDefaultRichMenuId()` in parallel, maps to `RemoteMenu[]`, finds the default, runs `diff()`. Returns `{state, summary, differences[], remote[], defaultRichMenuId, image, lastSync, checkedAt}`. A thrown error → `unknown`, never `different`.
- `diff(remote)` (`:93-125`) compares size, `chatBarText`, area count, then per-area `action.data` and exact `bounds` (x/y/width/height); each mismatch is a Chinese sentence naming the tile.
- `publish({actor='staff', deleteOthers=true, setAsDefault=true, imagePath?})` (`:247-338`) — writes a `sync_logs` row as `pending` first (operation string = `create+uploadImage+setDefault+deleteOld`), validates the image **locally** before calling LINE, then strictly: list previous ids → `createRichMenu` → `setRichMenuImage` → `setDefaultRichMenu` → only then delete the old ids (failures to delete are logged, not fatal). Any error: best-effort delete the half-created menu, `syncLogRepository.fail(id, message)`. `describeError` truncates to 400 chars and appends the SDK's `error.body`.
- `remove(richMenuId)`, `logs(limit=20)`.
- HTTP: `GET /api/line/richmenu`, `POST /api/line/richmenu/sync` (**502** on failure, and the response re-reads live status), `GET /api/line/sync-logs` — `src/controllers/adminController.ts:349-382`.

---

## 8. Push notification logic

`src/services/notificationService.ts`
- `buildStatusChangeMessages(record): Message[]` (`:36-59`) — returns **two** messages: a text block then the full timeline flex. Text lines: `notifyHeadline(status)` (i.e. `notify.headline.{status}` falling back to `notify.headline.default`), blank, `notify.case_id_label`+caseId, `notify.status_label`+`{emoji} {statusLabel}`; if status is `supplement_required` also `notify.supplement_items_title` + bullets and `notify.supplement_deadline_label` + date; if `paid` and `paymentDate` also `notify.payment_date_label`; always `notify.footer`.
- `notifyStatusChange(caseId, {historyId?, force?})` (`:68-124`) — returns `NotifyResult {caseId, recipients, sent, failed, skipped, note?}`:
  - case missing → `note:'case_not_found'`, nothing sent
  - `userCaseRepository.listUsersForCase(caseId)` → recipients = **only verified LINE users**; zero → `note:'no_linked_line_users'`, still marks history notified
  - per recipient: insert `notifications` row `kind = 'status:{status}'`, `payload = {"status": …}`, status `pending`; if `!sender.enabled && !force` → `markSkipped(id,'line_not_configured')`; else `sender.push` → `markSent` / `markFailed(id, message)`
  - finally `caseHistoryRepository.markNotified(historyId)`
- `pushToUser(lineUserId, caseId, messages, kind='manual')` (`:127-142`) — ad-hoc push, same bookkeeping.
- Triggers (all funnel through `caseService.upsert` → history row → `notifyStatusChange`):
  - `PUT /api/cases/:caseId` — `caseController.update` (`caseController.ts:128-133`), only when `change.from !== null`
  - `PATCH /api/cases/:caseId/status` — `caseAdminController.setStatus` (`adminController.ts:178-181`)
  - CSV import — `importService.importCaseRows` (`importService.ts:132-138`), notifies **after** the whole file, skipping `from === null`
  - `POST /api/notifications/test {caseId, force}` — `miscController.ts:177-181`
  - `scripts/notifyTest.ts`
- `notifications` row states: `pending | sent | failed | skipped`. `GET /api/notifications` returns the 50 most recent.

---

## 9. Content registry

**File: `src/content/registry.ts` (745 lines).** Exact key count: **119**. (DB `contents` table also holds exactly 119 rows.)

- **Types** (`:19-38`): `ContentType = 'text' | 'button' | 'label'`; `ContentCategoryId = 'home'|'case'|'subsidy'|'apply'|'mycase'|'faq'|'contact'|'notify'|'security'|'error'|'button'`.
- **`ContentDefinition`** (`:40-55`): `{key, category, title, description, defaultValue, type, variables: string[], sortOrder}`. Built by the `def(key, category, title, description, defaultValue, {type?, variables?, sortOrder?})` helper (`:79-96`); defaults `type:'text'`, `variables:[]`, `sortOrder:0`.
- **`CONTENT_CATEGORIES`** (`:64-76`) — `{id, label, icon, description}`, this is the sidebar order:
  `home 📌 首頁／歡迎`, `case 📋 案件進度`, `subsidy 🎁 補助資訊`, `apply 📝 申請小幫手`, `mycase 👤 我的案件`, `faq ❓ 常見問題`, `contact 📞 聯絡我們`, `notify 🔔 通知`, `security 🛡️ 防詐檢查`, `error ⚠️ 錯誤訊息`, `button 🔘 按鈕文字`.
- **Export order** (`:712-724`): `HOME, CASE, MYCASE, SUBSIDY, APPLY, FAQ, CONTACT, NOTIFY, SECURITY, ERROR, BUTTON` (note: differs from the sidebar order — MYCASE before SUBSIDY). Plus `BY_KEY` map, `getDefinition(key)`, `getDefault(key)`, `hasKey(key)`.

**Key naming convention:** lowercase dot-separated `category.name`, with sub-namespacing `case.field.*`, `case.status.<status>.{label,next_action}`, `case.timeline.step0..4`, `notify.headline.<status>`, `security.level.<risk>`. Validated server-side by `contentKeySchema = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i` (`src/routes/schemas.ts:115-118`).

**Category counts (sum 119):**

| category | count | keys |
|---|---|---|
| home | 2 | `home.welcome`, `home.unknown` |
| case | 36 | `case.ask_case_id`, `ask_phone`, `verify_failed`, `link_success`, `card_eyebrow`, `status_chip`, `timeline_title`, `next_action_title`, `field.{case_id,applicant,subsidy,submitted_at,updated_at,supplement_deadline,payment_date}` (7), `timeline.step0..step4` (5), and `status.{submitted,eligibility_review,document_review,supplement_required,review_completed,approved,rejected,paid}.{label,next_action}` (16) |
| mycase | 5 | `mycase.empty`, `title`, `subtitle`, `hint`, `updated_prefix` |
| subsidy | 13 | `subsidy.menu_intro`, `empty`, `category_empty`, `not_found`, `search_empty`, `field.{eligibility,age,period,amount,method,contact}` (6), `period_unset`, `age_unlimited` |
| apply | 13 | `apply.question_header`, `no_match`, `result_intro`, `disclaimer`, `result_eyebrow`, `reasons_title`, `caveats_title`, `checklist_eyebrow`, `checklist_hint`, `checklist_done`, `checklist_missing`, `checklist_empty`, `need_subsidy_first` |
| faq | 5 | `faq.menu_intro`, `also_ask`, `source_label`, `ungrounded_note`, `category_empty` |
| contact | 7 | `contact.title`, `unit`, `phone`, `email`, `address`, `hours`, `footer_note` |
| notify | 11 | `notify.headline.{default,approved,paid,supplement_required,rejected}` (5), `case_id_label`, `status_label`, `supplement_items_title`, `supplement_deadline_label`, `payment_date_label`, `footer` |
| security | 9 | `security.title`, `result_label`, `reasons_title`, `advice_title`, `disclaimer`, `level.{low,medium,high,unknown}` (4) |
| error | 6 | `error.invalid_case_id`, `invalid_phone`, `cancelled`, `system_busy`, `image_not_supported`, `non_text_message` |
| button | 12 | `button.case_status`, `faq`, `subsidy_info`, `my_cases`, `eligibility`, `contact`, `cancel`, `refresh_case`, `my_cases_secondary`, `checklist`, `official_url`, `subsidy_detail` |

**`content_type` distribution** (from the `type:` overrides): `button` = 12 (all `button.*`), `label` = 62, `text` = 45 (the default).

**Variables syntax: `{{name}}`** (double braces, optional inner whitespace). Substitution regex `/\{\{\s*(\w+)\s*\}\}/g`; an unknown placeholder is left in place (`contentService.ts:50-54`). Only **9 keys** declare variables:

| key | variables |
|---|---|
| `case.status_chip` | `status` |
| `mycase.subtitle` | `count` |
| `subsidy.category_empty` | `category` |
| `subsidy.search_empty` | `keyword` |
| `apply.question_header` | `current`, `total` |
| `apply.result_intro` | `list` |
| `apply.result_eyebrow` | `index` |
| `apply.checklist_missing` | `count` |
| `faq.menu_intro` | `list` |

**Runtime access** `src/content/contentService.ts`: `content.t(key)` (process-wide `Map` cache; a missing row **or a blank/whitespace stored value** falls back to `getDefault(key)` so LINE can never show an empty bubble); `content.tf(key, vars)`; `invalidateContentCache()` called after every write. A missing `contents` table is caught and logged, not fatal (`:33-39`). Status wording goes through `src/content/statusCopy.ts`: `statusLabel`, `statusNextAction`, `timelineLabel(step)`, `notifyHeadline(status)` — each falling back to `STATUS_META`/`TIMELINE_STEPS`.

**Draft / publish / reset**
- Storage: one row, two columns — `content` = live (what LINE reads), `draft` = work in progress (`src/db/schema.ts:158-170`).
- `syncDefaults()` (`contentService.ts:121-132`) runs on every boot from `app.ts:97`: for each of the 119 definitions, `insertIfMissing` (never touches an existing row's text) else `syncMetadata` (refreshes only category/title/description/type/variables/sort_order). Returns `{inserted, total}`.
- `saveDraft(key, draft, updatedBy)` → `ensureRow` + `UPDATE contents SET draft=?, updated_at, updated_by` (`contentRepository.ts:121-129`). LINE keeps showing `content`.
- `publish(key, text, updatedBy)` → `UPDATE contents SET content=?, draft=NULL, …` (`:110-118`) — publishing clears the draft. `publishDraft(key)` publishes `draft ?? content`.
- `reset(key, updatedBy)` = `publish(key, definition.defaultValue)` — restores the shipped text.
- `ContentView` adds `defaultValue`, `customised` (`content !== defaultValue`), `hasDraft` (`draft !== null && draft !== content`).
- `stats()` → `{total, customised, drafts}`.
- HTTP (`src/routes/api/index.ts:113-120`, all `requireAdminKey`): `GET /api/contents?category&q`, `GET /api/contents/categories`, `POST /api/contents/preview`, `GET /api/contents/:key`, `PUT /api/contents/:key {content}` (save draft), `POST /api/contents/:key/publish {content?, expectedVersion?}`, `POST /api/contents/:key/reset`. `GET /contents/:key` **writes the row on read** (`contentController.ts:60`) so a never-edited key still has a version to lock against.
- Audit: `publish` writes an `audit_logs` row only when the text actually changed (`action:'publish'`, before/after stored); `reset` always writes one (`action:'reset'`).

**LINE preview rendering**
- Server `src/services/previewService.ts`:
  - `buildContentPreview(key, text)` → `{kind: 'text'|'button'|'label', rendered, quickReplies: string[], where, missingVariables: string[]}`. `SAMPLE_VARIABLES` (`:36-45`): `status:'文件審查中', count:'2', category:'創業', keyword:'租金', current:'1', total:'6', index:'1', list:'1. 審查需要多久？\n2. 補助什麼時候撥款？'`. `quickReplies` = the six main-menu labels when the key starts with `home.`, `case.verify_failed`, `case.link_success`, `mycase.empty`, `error.`, or `contact.` (`:58-60`). `missingVariables` = declared variables no longer present as `{{name}}`.
  - `PREVIEW_SURFACES` (`:121-130`): `welcome, case_ask, case_card, my_cases, subsidy_card, checklist, contact, notification` (each `{id,label}`); `buildSurfacePreview(surface)` renders through the **real** builders using `SAMPLE_CASE` (caseId `20260001`, 王小明, status `document_review`) and the first live subsidy (falling back to `SAMPLE_SUBSIDY`). Endpoints `GET /api/line/preview`, `GET /api/line/preview/:surface`.
- Client `public/admin/js/linePreview.js`: `renderMessage(message)` / `phoneFrame(messages, label)` / `copyPreview(preview)` — a simplified DOM re-implementation of Flex (text size map `xxs 10px … xl 17px`, box/separator/button/image children, carousel shows the first card plus a "swipe for N more" bar). `copyPreview` branches on `kind`: `button` → a quick-reply pill, `label` → a card field row, otherwise a bubble + quick replies. The editor (`public/admin/js/pages/contents.js:45-130`) duplicates the sample-variable substitution client-side for live typing and warns on missing placeholders.

---

## 10. Rule-based intent classifier

`src/services/intentService.ts`

- `Intent` union (`:4-17`): `CASE_STATUS, MY_CASES, FAQ, SUBSIDY_INFO, ELIGIBILITY_CHECK, CHECKLIST, CONTACT, GREETING, CANCEL, HELP, SECURITY_CHECK, UNKNOWN`.
- Output `IntentResult` (`:21-27`): `{intent, confidence: number, entities: {caseId?, phone?, keyword?}, matchedBy: 'rule'|'faq'|'fallback'}`.
- `RULES: {intent, keywords[], weight}[]` (`:40-101`):
  - `CASE_STATUS` w3 — 案件進度, 查進度, 進度, 案件查詢, 查案件, 我的案件到哪, 審查到哪, 案件狀態, 到哪了, 審核進度, 申請進度, 查詢案件, 案件編號
  - `MY_CASES` w3 — 我的案件, 我的申請, 我有哪些案件, 已驗證, 我的紀錄, 我的補助案件
  - `CHECKLIST` w3 — 需要什麼文件, 準備文件, 文件清單, 要帶什麼, 應備文件, checklist, 檢查清單, 要準備
  - `ELIGIBILITY_CHECK` w3 — 資格檢查, 我符合, 符合資格, 我可以申請, 找補助, 推薦補助, 適合我, 哪些補助, 我能申請, 申請小幫手, 我想申請, 我要申請, 怎麼申請, 如何申請, 申請流程
  - `SUBSIDY_INFO` w2 — 補助資訊, 有什麼補助, 補助有哪些, 查補助, 我要查補助, 看補助, 瀏覽補助, 創業補助, 就業補助, 租金補貼, 青年補助, 補助說明, 補助介紹, 補助項目
  - `CONTACT` w3 — 聯絡, 客服, 電話, 承辦, 怎麼找你們, 聯繫, 窗口, 地址
  - `SECURITY_CHECK` w3 — 詐騙, 可疑, 假訊息, 這是真的嗎, 簡訊詐騙, 釣魚, 可疑網址
  - `GREETING` w1 — 你好, 哈囉, hi, hello, 嗨, 在嗎
  - `HELP` w2 — help, 幫助, 怎麼用, 功能, 選單, 說明
  - `CANCEL` w5 — 取消, 重來, 結束, 離開, 返回, cancel, 回主選單
- Scoring (`:128-137`): lowercase substring containment; `score = rule.weight + keyword.length / 10`; highest single hit wins; `confidence = min(score/6, 1)`, `matchedBy:'rule'`.
- Entities (`:103-115`): `PHONE_PATTERN = /\b(09\d{8}|8869\d{8}|\+886-?9\d{8})\b/` extracted first, then the phone substring is blanked before `CASE_ID_PATTERN = /\b(\d{8})\b/` — so a mobile number is never read as a case id.
- Fallbacks (`:140-150`): a text that is **all digits** and yields a `caseId` → `CASE_STATUS` conf 0.8; otherwise if `faqService.best(raw)` matches → `FAQ` conf 0.6, `matchedBy:'faq'`, `entities.keyword = raw`; else `UNKNOWN` conf 0. Empty input → `UNKNOWN` conf 0 `matchedBy:'fallback'`.
- Exposed at `POST /api/intent/classify {text}` (`miscController.ts:189-194`) for admin testing.

Related non-AI matchers to port: `faqService.scoreFaq` (`src/services/faqService.ts:17-42`) — keyword containment worth 3 (len≥3) or 2, +5 for a near-verbatim question, `+faq.priority` **only if something matched**, `MIN_SCORE = 2`; and `subsidyService.findByMention` (`subsidyService.ts:79-99`) — name hit +10, tag hit +3 (latin or len≥3) / +2, requires final score ≥3.

---

## 11. SQLite schema

Driver: `better-sqlite3`, `journal_mode = WAL`, `foreign_keys = ON` (`src/db/index.ts:34-35`). File resolved from `DATABASE_FILE` (absolute or relative to project root); **`NODE_ENV=test` forces `:memory:`** (`:72`). `migrate()` runs on first `getDb()` and executes all five schema strings then `ensureColumn` for every entry in `ADDED_COLUMNS + AUTH_ADDED_COLUMNS + USER_ADDED_COLUMNS` (checks `pragma_table_info`, then `ALTER TABLE … ADD COLUMN`). **There is no versioned migration table — it is idempotent DDL only.** No dates are stored as SQL dates: every timestamp is an ISO-8601 TEXT; every array is a JSON TEXT; every boolean is INTEGER 0/1.

### `src/db/schema.ts` — `SCHEMA_SQL` (`:6-142`)

**subsidies** — `subsidy_id TEXT PK`, `name TEXT NOT NULL`, `category TEXT NOT NULL DEFAULT '其他'`, `description TEXT NOT NULL DEFAULT ''`, `eligibility TEXT NOT NULL DEFAULT ''`, `age_min INTEGER`, `age_max INTEGER`, `application_start TEXT`, `application_end TEXT`, `required_documents TEXT NOT NULL DEFAULT '[]'`, `application_method TEXT NOT NULL DEFAULT ''`, `official_url TEXT NOT NULL DEFAULT ''`, `contact TEXT NOT NULL DEFAULT ''`, `amount_note TEXT NOT NULL DEFAULT ''`, `tags TEXT NOT NULL DEFAULT '[]'`, `identity_tags TEXT NOT NULL DEFAULT '[]'`, `student_requirement TEXT NOT NULL DEFAULT 'any'`, `employment_requirement TEXT NOT NULL DEFAULT 'any'`, `residency_requirement TEXT`, `details TEXT NOT NULL DEFAULT '[]'`, `active INTEGER NOT NULL DEFAULT 1`, `updated_at TEXT NOT NULL` — plus added columns `image_url TEXT NOT NULL DEFAULT ''`, `updated_by TEXT NOT NULL DEFAULT 'system'`, `version INTEGER NOT NULL DEFAULT 1`.

**cases** — `case_id TEXT PK`, `applicant_name TEXT`, `phone TEXT NOT NULL`, `subsidy_id TEXT`, `status TEXT NOT NULL`, `submitted_at TEXT`, `updated_at TEXT NOT NULL`, `supplement_required INTEGER NOT NULL DEFAULT 0`, `supplement_items TEXT NOT NULL DEFAULT '[]'`, `supplement_deadline TEXT`, `payment_status TEXT NOT NULL DEFAULT 'not_applicable'`, `payment_date TEXT`, `payment_amount INTEGER`, `next_action TEXT`, `note TEXT`, `created_at TEXT NOT NULL` — plus `updated_by TEXT NOT NULL DEFAULT 'system'`, `version INTEGER NOT NULL DEFAULT 1`. Indexes `idx_cases_status(status)`, `idx_cases_phone(phone)`.

**case_status_history** — `id INTEGER PK AUTOINCREMENT`, `case_id TEXT NOT NULL`, `from_status TEXT`, `to_status TEXT NOT NULL`, `changed_at TEXT NOT NULL`, `source TEXT NOT NULL DEFAULT 'system'`, `notified INTEGER NOT NULL DEFAULT 0`. Indexes on `case_id` and `notified`.

**faqs** — `faq_id TEXT PK`, `category TEXT NOT NULL DEFAULT '一般'`, `question TEXT NOT NULL`, `answer TEXT NOT NULL`, `keywords TEXT NOT NULL DEFAULT '[]'`, `priority INTEGER NOT NULL DEFAULT 0`, `updated_at TEXT NOT NULL` — plus `active INTEGER NOT NULL DEFAULT 1`, `updated_by TEXT NOT NULL DEFAULT 'system'`, `version INTEGER NOT NULL DEFAULT 1`.

**line_users** — `line_user_id TEXT PK`, `display_name TEXT`, `created_at TEXT NOT NULL`, `last_seen_at TEXT NOT NULL`.

**user_cases** — `id INTEGER PK AUTOINCREMENT`, `line_user_id TEXT NOT NULL`, `case_id TEXT NOT NULL`, `verified_at TEXT NOT NULL`, `UNIQUE(line_user_id, case_id)`. Index `idx_user_cases_case(case_id)`.

**notifications** — `id INTEGER PK AUTOINCREMENT`, `case_id TEXT NOT NULL`, `line_user_id TEXT NOT NULL`, `kind TEXT NOT NULL`, `payload TEXT NOT NULL DEFAULT '{}'`, `status TEXT NOT NULL DEFAULT 'pending'`, `error TEXT`, `created_at TEXT NOT NULL`, `sent_at TEXT`. Index on `status`.

**conversation_states** — `line_user_id TEXT PK`, `flow TEXT NOT NULL`, `step TEXT NOT NULL`, `data TEXT NOT NULL DEFAULT '{}'`, `updated_at TEXT NOT NULL`.

**knowledge_documents** — `doc_id TEXT PK`, `title TEXT NOT NULL`, `content TEXT NOT NULL`, `source_url TEXT NOT NULL DEFAULT ''`, `source_type TEXT NOT NULL DEFAULT 'manual'`, `tags TEXT NOT NULL DEFAULT '[]'`, `updated_at TEXT NOT NULL`.

**import_runs** — `id INTEGER PK AUTOINCREMENT`, `source TEXT NOT NULL`, `inserted INTEGER NOT NULL DEFAULT 0`, `updated`, `skipped`, `failed` (same shape), `started_at TEXT NOT NULL`, `finished_at TEXT`, `detail TEXT NOT NULL DEFAULT '{}'`.

### `ADMIN_SCHEMA_SQL` (`schema.ts:157-201`)

**contents** — `content_key TEXT PK`, `category TEXT NOT NULL DEFAULT 'general'`, `title TEXT NOT NULL`, `description TEXT NOT NULL DEFAULT ''`, `content TEXT NOT NULL DEFAULT ''`, `draft TEXT`, `content_type TEXT NOT NULL DEFAULT 'text'`, `variables TEXT NOT NULL DEFAULT '[]'`, `sort_order INTEGER NOT NULL DEFAULT 0`, `updated_at TEXT NOT NULL`, `updated_by TEXT NOT NULL DEFAULT 'system'` — plus `version INTEGER NOT NULL DEFAULT 1`. Index on `category`.

**media** — `media_id TEXT PK`, `filename TEXT NOT NULL`, `original_name TEXT NOT NULL DEFAULT ''`, `mime_type TEXT NOT NULL`, `bytes INTEGER NOT NULL DEFAULT 0`, `width INTEGER`, `height INTEGER`, `usage_note TEXT NOT NULL DEFAULT ''`, `created_at TEXT NOT NULL`, `created_by TEXT NOT NULL DEFAULT 'system'`.

**audit_logs** — `id INTEGER PK AUTOINCREMENT`, `actor TEXT NOT NULL DEFAULT 'staff'`, `action TEXT NOT NULL`, `entity_type TEXT NOT NULL`, `entity_id TEXT NOT NULL`, `summary TEXT NOT NULL DEFAULT ''`, `before_value TEXT`, `after_value TEXT`, `created_at TEXT NOT NULL`. Indexes `(entity_type, entity_id)` and `(created_at)`.

### `AUTH_SCHEMA_SQL` (`src/db/authSchema.ts:9-25`)

**admin_sessions** — `session_id TEXT PK` (**stores the SHA-256 hash**, not the raw cookie value), `username TEXT NOT NULL`, `created_at TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `last_seen_at TEXT NOT NULL`, `user_agent TEXT NOT NULL DEFAULT ''` — plus `user_id INTEGER` (from `USER_ADDED_COLUMNS`). Index on `expires_at`. No IP is stored, by design.

### `SYNC_SCHEMA_SQL` (`src/db/syncSchema.ts:13-37`)

**sync_logs** — `id INTEGER PK AUTOINCREMENT`, `resource_type TEXT NOT NULL`, `resource_id TEXT NOT NULL DEFAULT ''`, `local_version INTEGER`, `operation TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'pending'` (`pending|synced|failed`), `remote_id TEXT`, `error TEXT`, `actor TEXT NOT NULL DEFAULT 'staff'`, `created_at TEXT NOT NULL`, `completed_at TEXT`. Indexes `(resource_type, created_at)` and `(status)`.

### `USER_SCHEMA_SQL` (`src/db/userSchema.ts:12-25`)

**admin_users** — `id INTEGER PK AUTOINCREMENT`, `username TEXT NOT NULL UNIQUE COLLATE NOCASE`, `password_hash TEXT NOT NULL`, `role TEXT NOT NULL DEFAULT 'admin'`, `is_active INTEGER NOT NULL DEFAULT 1`, `created_at TEXT NOT NULL`, `last_login_at TEXT`. Index on `is_active`.

### Actual DB file

`/Users/sam/Documents/MyProject/mixProject/youth-line-bot/data/youth.db` — 233 KB, last modified 2026-09-16, **populated**. Row counts (`sqlite3`):

| table | rows | | table | rows |
|---|---|---|---|---|
| subsidies | 10 (5 active) | | contents | **119** |
| cases | 5 | | media | 0 |
| case_status_history | 9 | | audit_logs | 11 |
| faqs | 10 (all active) | | sync_logs | 2 |
| line_users | 15 | | import_runs | 3 |
| user_cases | 7 | | admin_users | 6 |
| notifications | 4 | | admin_sessions | 14 |
| conversation_states | 3 | | knowledge_documents | 4 |

Cases present: `20260001 測試用小明 0912345678 HCLOAN115 eligibility_review`, `20260002 測試用小華 0987654321 HCRENT115 supplement_required`, `20260003 測試用小美 0922334455 HCDIV115 approved/pending`, `20260004 測試用小強 0900111222 HCAI115 paid/paid`, `20260005 測試用小芳 0933444555 HCCLUB115 document_review`. Admin users: `plankton, Sam, Yeeuan, Miles, Ivan, Cindy` (all `role='admin'`, active). One content row has been edited by staff: `case.ask_case_id` (`updated_by='staff'`, version 1). `data/uploads/` is empty. Note `.gitignore` excludes `data/*.db` — the file is local only.

Enums to port (`src/models/caseStatus.ts`):
- `CaseStatus`: `submitted | eligibility_review | document_review | supplement_required | review_completed | approved | rejected | paid`.
- `STATUS_META[status] = {value, label, emoji, color, step, terminal, defaultNextAction}` (`:44-125`): submitted 📨 step0, eligibility_review 🔎 step1, document_review 📄 step2, supplement_required ⚠️ step2 (WARNING), review_completed ✅ step3, approved 🎉 step3 (SUCCESS), rejected ❌ step3 (ERROR, `terminal:true`), paid 💰 step4 (SUCCESS, `terminal:true`).
- `TIMELINE_STEPS` (`:128-134`): 0 已送出申請, 1 資格審查, 2 文件審查, 3 審查完成, 4 撥款.
- `buildTimeline(status)` (`caseService.ts:30-46`): `supplement_required` at its own step → `blocked`; for `rejected`, steps > 3 stay `upcoming`; else `< step` = `done`, `=== step` = `current`, `> step` = `upcoming`.
- `STATUS_ALIASES` (`:137-155`) accepted by `parseCaseStatus`: `reviewing/review → eligibility_review`, `pending/submitted → submitted`, `doc_review → document_review`, `supplement → supplement_required`, `approved/rejected/paid` identity, plus the 8 Chinese labels 已送出申請/資格審查中/文件審查中/待補件/審查完成/已核准/未核准/已撥款.
- `PaymentStatus`: `not_applicable | pending | processing | paid`, with `PAYMENT_STATUS_LABEL` 尚未進入撥款程序 / 等待撥款 / 撥款作業中 / 已撥款.

---

## 12. Admin endpoints and optimistic locking

**Auth model** `src/middleware/auth.ts`: two ways in — (1) a staff session cookie `youth_admin_session` (httpOnly, `sameSite:'lax'`, `secure` when `req.protocol==='https'` or `x-forwarded-proto: https`, `maxAge = SESSION_TTL_MS = 12 h`, `path:'/'`), (2) header `x-api-key` compared with `crypto.timingSafeEqual` against `ADMIN_API_KEY`. `requireAdminKey` (aliased `requireAdmin`) → `next()` if either; if *neither* a key nor any account is configured → **503 `admin_not_configured`** (fails closed); else **401 `unauthorized`**. `accessMode(req)` returns `'session'|'key'|'none'`. Note `env.adminAllowRemote` / `env.adminShareToken` still exist in config but are no longer enforced in `auth.ts` (share links were removed).

Sessions: `adminAuthService` (`src/services/adminAuthService.ts`) — scrypt `N=16384 r=8 p=1 keylen=64`, stored as `scrypt$N$r$p$salt$hashHex`; password normalised `NFKC`; `DUMMY_HASH` verify on unknown user to equalise timing; generic failure message `帳號或密碼不正確。` for every case; session id = `randomBytes(32).base64url`, stored SHA-256-hashed; `resolve()` re-checks the account's `is_active` on every request and destroys the session if disabled. `seedDefaultAccounts()` creates `Sam, Yeeuan, Miles, Ivan, Cindy` from `ADMIN_SEED_PASSWORD` (idempotent, never rewrites an existing password) plus carries over legacy `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`.

**All routes** (`src/routes/api/index.ts`), `wrap()` catches async rejections:

*Public:* `POST /api/auth/login` (+`loginRateLimit`, `loginSchema`), `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/status`, `POST /api/cases/verify`, `GET /api/subsidies`, `GET /api/subsidies/:id`, `GET /api/faqs`, `GET /api/eligibility/questions`, `POST /api/eligibility/check`, `POST /api/intent/classify`, `POST /api/ai/ask`, `POST /api/ai/explain`, `POST /api/security/check`. Plus `GET /health` (`app.ts:34-40`) and `GET /uploads/*` static.

*Protected (`requireAdminKey`):* `GET /cases` (query schema), `GET /cases/:caseId`, `POST /cases`, `PUT /cases/:caseId`, `POST /subsidies`, `PUT /subsidies/:id`, `POST /import/csv`, `GET /import/runs`, `POST /notifications/test`, `GET /notifications`, `GET /contents`, `GET /contents/categories`, `POST /contents/preview`, `GET /contents/:key`, `PUT /contents/:key`, `POST /contents/:key/publish`, `POST /contents/:key/reset`, `GET /admin/faqs`, `POST /faqs`, `PUT /faqs/:id`, `PATCH /faqs/:id/status`, `GET /admin/subsidies`, `PATCH /subsidies/:id/status`, `GET /case-statuses`, `PATCH /cases/:caseId/status`, `GET /media`, `POST /media`, `DELETE /media/:id`, `GET /admin/access-mode`, `GET /admin/users`, `GET /dashboard/stats`, `GET /audit-logs`, `GET /line/richmenu`, `POST /line/richmenu/sync`, `GET /line/sync-logs`, `GET /line/preview`, `GET /line/preview/:surface`.

*Static/SPA (`app.ts:51-85`, gated on `ADMIN_UI_ENABLED`):* `GET /admin/login` (always public, as are `/login.html`, `/css/admin.css`, `/js/login.js`), everything else under `/admin` redirects to `/admin/login?next=…` without a session; `GET /admin/*` serves the SPA shell; `GET /` redirects to `/admin/`.

**Optimistic locking** `src/services/versionGuard.ts`:
- `GUARDED = {subsidies:'subsidy_id', faqs:'faq_id', contents:'content_key', cases:'case_id'}` — the same four listed in `VERSIONED_TABLES` (`authSchema.ts:36`), each carrying `version INTEGER NOT NULL DEFAULT 1`.
- `readVersion(table, id)` → number or `null`.
- `assertVersion(table, id, expectedVersion)`: **`undefined`/`null` opts out entirely** (old scripts keep working, unprotected); a row that does not exist yet cannot conflict; otherwise `current !== expected` → throw `VersionConflictError` → **HTTP 409 `version_conflict`** with message `這筆{補助|常見問題|文案|案件}已被其他管理員更新，請重新載入最新版本後再編輯。`
- `bumpVersion(table, id)` = `UPDATE … SET version = version + 1`, returns the new value.
- `withVersionGuard(table, id, expected, write)` = assert → write → bump, returning `{result, version}` (helper exists; call sites currently use the three primitives directly).
- Wire-up: `expectedVersion` is an optional field on `updateSubsidySchema`, `updateFaqSchema`, `contentPublishSchema`, `caseStatusSchema` (`src/routes/schemas.ts:9`, `:83, 128, 149, 154`). Handlers: `miscController.ts:111,127` (subsidy update), `adminController.ts:74,94` (FAQ update), `adminController.ts:166,195` (case status), `contentController.ts:92,111` (content publish). Every read that feeds an editor returns the current `version` alongside the data: `GET /cases/:caseId`, `GET /subsidies/:id`, `GET /contents/:key`. Client sends it back: `api.publishContent(key, content, loadedVersion)` (`public/admin/js/api.js:99-100`), and `ApiError.isConflict` (status 409) drives the "reload" prompt.
- Gap to be aware of when porting: the check and the bump are **two separate statements with no transaction**, so two simultaneous saves can both pass `assertVersion`.

**Audit trail**: `auditRepository.add({actor, action, entityType, entityId, summary, before?, after?})`. Actions observed: `create`, `update`, `publish`, `reset`, `enable`, `disable`, `status_change`, `upload`, `delete`, `sync`, `sync_failed`. `entityType` values: `content`, `faq`, `subsidy`, `case`, `media`, `richmenu`. Actor resolution `contentController.ts:22-31` (exported as `staffActor`): the signed-in username wins; only an API-key caller may supply `x-staff-name` (percent-decoded, trimmed to 50 chars), default `'staff'`. Case audit entries store the **masked** case id (`adminController.ts:188`) so the audit table never becomes a second copy of case data.

---

## 13. Subsidy (方案) data

**Field set** (`Subsidy`, `src/models/types.ts:49-81` / `mapSubsidy`, `src/repositories/mappers.ts:72-99`):
`subsidyId, name, category, description, eligibility, ageMin: number|null, ageMax: number|null, applicationStart: ISO|null, applicationEnd: ISO|null, requiredDocuments: string[], applicationMethod, officialUrl, contact, amountNote, tags: string[], identityTags: string[], studentRequirement: 'required'|'excluded'|'any', employmentRequirement: 'employed'|'unemployed'|'any', residencyRequirement: string|null, details: {label,value}[], imageUrl, active: boolean, updatedAt, updatedBy`.
Write validation `subsidySchema` (`src/routes/schemas.ts:55-83`): ages 0–120, ≤30 `requiredDocuments` of ≤200 chars, `officialUrl` must be a URL or `''`, `description`/`eligibility` ≤2000, `applicationMethod` ≤500, ≤30 tags/identityTags. `details` is **not** in the write schema — it is only settable via the seed importer.

**How many:** `data/mock/subsidies.json` contains **5** (all Hsinchu 115年度 programmes). `data/youth.db` contains **10** — those 5 (`active=1`) plus 5 older generic demo rows `YOUTH001..YOUTH005` (`active=0`, so invisible in LINE). Details-row counts in DB: HCAI115 10, HCLOAN115 5, HCCLUB115 5, HCRENT115 5, HCDIV115 4, `YOUTH*` 0. All ten have `residency_requirement = '新竹市'` and empty `image_url`.

| subsidyId | name | category | age | window | active |
|---|---|---|---|---|---|
| HCAI115 | 115年度 AI領航青年數位工具補助計畫 | 數位工具 | 16–40 | 2026-04-02 → 2026-11-30 | ✅ |
| HCDIV115 | 促進青年多元發展補助 | 青年發展 | 16–40 | — → 2026-11-30 | ✅ |
| HCLOAN115 | 115年度新竹市青年創業貸款利息補貼計畫 | 創業 | 18–45 | — → 2026-11-30 | ✅ |
| HCCLUB115 | 安心Go Young青年學生社團發展補助計畫 | 學生社團 | — | — → 2026-11-30 | ✅ (`studentRequirement:'required'`) |
| HCRENT115 | 115年度新竹好好租－新竹市青年租金加碼補貼 | 居住 | –39 | — → 2026-12-31 | ✅ |
| YOUTH001 | 青年創業啟動補助 | 創業 | 18–45 | 2026-03-01 → 2026-11-30 | ❌ |
| YOUTH002 | 青年就業獎勵金 | 就業 | 18–29 | 2026-01-01 → 2026-12-31 | ❌ (`excluded`/`employed`) |
| YOUTH003 | 青年租金補貼 | 居住 | 20–40 | 2026-07-01 → 2026-10-31 | ❌ |
| YOUTH004 | 青年技能進修補助 | 教育進修 | 18–35 | 2026-02-01 → 2026-12-15 | ❌ |
| YOUTH005 | 在學青年生活助學金 | 教育進修 | 18–25 | 2026-09-01 → 2026-10-15 | ❌ (`required`) |

**The Hsinchu AI entry is present** — `HCAI115`, `data/mock/subsidies.json` entry 1, and in the DB with `version=6`:
- `name` 115年度 AI領航青年數位工具補助計畫, `category` 數位工具, `ageMin 16`, `ageMax 40`, `applicationStart 2026-04-02`, `applicationEnd 2026-11-30`, `residencyRequirement 新竹市`, `studentRequirement/employmentRequirement: 'any'`.
- `amountNote`: 一般青年：補助購買金額 50%，每人上限 3,000 元；特定對象及文化語言保存者：補助 90%，每人上限 6,000 元。
- `officialUrl`: `https://youthhsinchu.hccg.gov.tw/youth/app/artwebsite?module=artwebsite&id=64&serno=null`
- `contact`: 新竹市青年發展中心 03-522-0557／LINE 官方帳號 @youthhsinchu
- `tags` (10): AI, 數位工具, ChatGPT, Claude, Gemini, Canva, Copilot, Midjourney, 軟體訂閱, 數位 — these drive `findByMention` so "我想申請 AI 補助" opens this card directly.
- `identityTags`: 一般青年, 應屆畢業生, 待業中, 創業者.
- `requiredDocuments` (7): 身分證正反面照片 / 官方收據（含訂閱人姓名、電子信箱、完整 AI 軟體名稱、公司名稱、訂閱日期與期間）/ 臺幣換算及繳款憑證 / 存摺封面影本 / 切結書（親筆簽名正本）/ 特定對象或本土語言證照證明 / 第三人代付切結與身分證明.
- `details` (10 label/value rows): 申請期間, 購買日期限制 (115/4/2–115/10/31), 申請時限 (月費 1 個月／年費 2 個月內), 補助次數 (每年一次), 可補助 AI 工具 (ChatGPT, Gemini, Grok, Claude, Perplexity, Canva AI, Adobe Firefly, Midjourney, Figma AI, Microsoft Copilot, copy.ai, Notion AI, Jasper, Grammarly, Speak, Elicit, Cursor), 不予補助項目 (中國大陸軟體 CapCut/Kling/Meitu/Wink；集合式平台 Poe.com/GoingBus；預付儲值、點數、代幣、API 額度), 補件期限 (10 個工作天), 計畫經費 (570 萬), 線上申辦 (`https://dgservice.hccg.gov.tw/serviceNotice.do?rule=guest&id=1323`), 資料來源.
- There is also a matching knowledge doc `KB-AI-115` in `data/mock/knowledge.json`.

**Related services:** `subsidyService` (`list/listForAdmin/setActive/count/recentlyUpdated/categories/getById/search/upsert/latest/closingSoon/findByMention/isOpen`); `checklistService.build(subsidyId, checkedItems=[])` → `ChecklistView {subsidyId, subsidyName, items:[{name,checked}], totalCount, checkedCount, missingCount}` and `checklistService.toggle(subsidyId, checked, itemName)` which also drops ticks no longer in `requiredDocuments`.

**Eligibility matcher** (`src/services/eligibilityService.ts`) — 6 questions with fixed options:
`age` 18-22/23-27/28-32/33-45 · `identity` 一般青年/應屆畢業生/待業中/創業者 · `isStudent` 是/否 · `isEmployed` 是/否 · `residency` 新竹市/新竹縣/其他縣市 · `interest` 創業/就業/居住/教育進修/都看看.
Scoring `evaluate()` (`:30-108`), base `score = 1`: age outside range → **excluded (null)**, inside a declared range → `+2`; unanswered but the subsidy declares one → caveat. Same pattern for `studentRequirement` (`required`+not student → exclude; `excluded`+student → exclude) and `employmentRequirement`, each `+2`. `residencyRequirement` with a non-overlapping answer → exclude, match `+2`, unanswered → caveat. `identityTags` substring hit `+3`. `interest` matching `category` or any tag `+5` (strongest signal, by design). Application already closed → caveat + `score -= 2` (kept visible). `match(answers, limit=5)` sorts by score desc over active subsidies only.

---

## 14. Tests

vitest, `tests/**/*.test.ts`, `isolate:true`, `pool:'forks'`, `testTimeout 20s`, and **`env: {LINE_CHANNEL_SECRET:'', LINE_CHANNEL_ACCESS_TOKEN:''}`** so the suite can never touch the real LINE account (`vitest.config.ts`). Each file gets its own `:memory:` DB via `NODE_ENV=test`.

`tests/helpers.ts` — `TEST_USER`/`OTHER_USER` constants, `seedTestData()` (runs `seedImporter.all()` then upserts demo cases 20260001–20260004), `resetConversation`, `textEvent`/`postbackEvent` webhook factories, `messageText()` (flattens, Flex contributes `altText`), `flexStrings()` (deep string walk).

| file | coverage |
|---|---|
| `lineFlow.test.ts` (219) | rich-menu: 6 tiles all postback, area sum == 2500×1686, every tile routes to a non-`unknown` reply, shipped artwork passes `inspectImage`. Case flow: full id→phone→timeline walk (asserts the phone never appears in the reply), malformed id rejected without a DB hit, **wrong-phone and unknown-case replies are string-identical and mention neither 不存在 nor 查無此案件**, cancel, inline case number jumps to the phone step. My cases: empty state, post-verification list, refresh refused for an unverified user. Info handlers: subsidy carousel from DB, checklist build + toggle by index, full 6-answer wizard, free-typed FAQ, contact, unknown fallback, image message. `verifySignature` accept/tamper/wrong-secret/missing/not-base64. |
| `caseService.test.ts` (106) | two-factor verify, phone-format tolerance (`0912-345-678`, `+886…`), identical failure objects, ownership isolation between users, `toCaseView` strips phone + masks name (`測OOO明`), timeline states per status, supplement/paid views, history written once per real transition. |
| `intentAndFaq.test.ts` (135) | 11 intent table-driven cases, FAQ fallback intent, entity extraction (caseId + phone, phone never read as caseId, bare 8 digits → CASE_STATUS), FAQ matching across phrasings for FAQ001–FAQ008, no-guess on unrelated text, eligibility exclusions (student-only, age range) and caveats, disclaimer wording, checklist counts/toggle/foreign-item drop. |
| `api.test.ts` (239) | `/health`, key-protected route table, `GET /cases` (no phones leaked) + query validation, `GET /cases/:id` with history + 404, `POST /cases/verify` byte-identical 401, case create/update, invalid status, public subsidy/FAQ reads + write protection, eligibility questions/check, CSV import over HTTP, empty CSV 400, intent classify, AI grounded-only answer, security check, 404 without a stack trace. |
| `adminApi.test.ts` (239) | subsidy create/update/disable reflected in LINE immediately, duplicate id 409, FAQ create/update/disable reflected in the bot, case status change → LINE + history + audit (with masked case id), unknown status/case, media upload/list/reject-type/auth, dashboard stats. |
| `adminContent.test.ts` (237) | registry invariants (unique keys, non-empty defaults, **every `{{placeholder}}` used in a default is declared**), seeding idempotence, blank-value fallback, publish→LINE immediately, button label change without behaviour change, status description + rename propagation, drafts invisible to LINE until published, content API auth/search/404, audit of who changed what, every preview surface renders through the real builders, preview reflects edits, bot survives an empty `contents` table. |
| `adminAuth.test.ts` (291) | scrypt hashing (salted, verify, malformed rejection), login sets httpOnly cookie, identical answer for wrong password vs unknown user, hash never returned, protected-route table without a session, session accepted, API key still accepted, forged cookie rejected, public endpoints untouched, server-side logout revocation, expiry, concurrent sessions see one DB, **signed-in username wins over `x-staff-name`**, optimistic locking: stale save refused / accepted after reload / no-version save still allowed / version bumped on case status change. |
| `adminUsers.test.ts` (328) | seeds the five team accounts, idempotent, never resets a changed password, stores only hashes, distinct salts, five concurrent sessions, one logout does not affect others, `last_login_at`, disabled account refused and its sessions killed, username existence never revealed, two people editing different records, version conflict on subsidies + contents + case status, per-account attribution, user list never returns a hash, session counting by person not tab. |
| `richMenuSync.test.ts` (163) | canvas coverage, distinct postback per tile, postback-only (never bare text), `not_configured` reported rather than "synced", artwork validity reported regardless, a failed publish is never logged `synced`, a bad image is refused before any LINE call, **no credential ever reaches a log line**, sync log opens `pending`, success only when told explicitly, long errors truncated, API auth + 502 on failed sync + log listing. |
| `importAndNotify.test.ts` (159) | CSV header normalisation + BOM strip, insert, upsert on re-run, status-change detection, untouched fields preserved, per-row error reporting, supplement/payment fields derived from status, push to every verified user, failed push recorded not thrown, no-op when nobody verified, missing case handled, supplement details written into the push message. |

---

## 15. Environment variables

Defined and read in `src/config/env.ts` (dotenv loads `.env`, falling back to `.env.txt` when `.env` is absent — `:6-8`). `str()` trims, `bool()` accepts `1/true/yes/on`, `int()` requires finite and > 0.

| var | default | used for |
|---|---|---|
| `NODE_ENV` | `development` | `isProduction`, and **`test` forces the DB to `:memory:`** (`db/index.ts:72`) |
| `PORT` | `3000` | `server.listen` (deploy script forces `3100`) |
| `HOST` | `0.0.0.0` | bind address (deploy script forces `127.0.0.1`) |
| `LOG_LEVEL` | `info` | `error|warn|info|debug` threshold (`utils/logger.ts:6`) |
| `LINE_CHANNEL_SECRET` | `''` | webhook HMAC; empty ⇒ signature check skipped |
| `LINE_CHANNEL_ACCESS_TOKEN` | `''` | MessagingApiClient / BlobClient; empty ⇒ `NoopLineSender` |
| `DATABASE_FILE` | `./data/youth.db` | resolved absolute against project root if relative |
| `ADMIN_API_KEY` | `''` | `x-api-key` for scripts/CI; empty + no accounts ⇒ admin API returns 503 |
| `ADMIN_USERNAME` | `''` | legacy single account, migrated into `admin_users` on boot (getter, read at access time) |
| `ADMIN_PASSWORD_HASH` | `''` | its scrypt hash (produced by `npm run admin:password`) |
| `ADMIN_SEED_PASSWORD` | `''` | initial password for the five seeded team accounts; only ever creates missing accounts |
| `ADMIN_ALLOW_REMOTE` | `false` | legacy localhost-only switch; **read but no longer enforced** in `middleware/auth.ts` |
| `ADMIN_UI_ENABLED` | `true` | serves `/admin`; false ⇒ bot-only |
| `ADMIN_SHARE_TOKEN` | `''` | legacy share-link token; **read but no longer enforced** |
| `PUBLIC_BASE_URL` | `''` | trailing slashes stripped; prefixes `/uploads/...` so LINE can fetch card images; `reachableByLine` requires it to start with `https://` |
| `UPLOAD_DIR` | `./data/uploads` | where `mediaService` writes, served at `/uploads` with `maxAge:'1h'` |

Also present in `.env.example` but never read by code: `LINE_Channel_ID`. Only test code touches `process.env` directly (`tests/adminUsers.test.ts`, setting `ADMIN_SEED_PASSWORD`).

`checkLineCredentialShape()` (`config/env.ts:123-139`) is a startup diagnostic used by `scripts/setupRichMenu.ts`: flags token === secret, a 32-hex token (that is a Channel Secret), or a token under 100 chars.

---

## Porting notes worth carrying over

1. **Ordering guarantee in the webhook**: LINE gets `200` before any handling, and events are processed with no await — a Python port should use a background task/queue, not a synchronous handler.
2. **Uniform-failure invariant** is load-bearing and test-enforced in three places (LINE reply, `caseService.verify` result object, `POST /cases/verify` body). Do not let an error message diverge.
3. **No case-verification throttle exists** — the only rate limiter is on staff login.
4. **Postback data is index-based for documents** (`&i=N`) specifically because LINE caps postback data at 300 bytes and URL-encoded Chinese filenames overflow it; the name-based form is still accepted for old buttons.
5. **Content fallback chain**: DB row (non-blank) → `CONTENT_REGISTRY` default → `''`. The bot must never fail because of a content problem; a missing `contents` table is caught, not fatal.
6. **`conversation_states` has no expiry** and one row per user; the Python port may want a TTL.
7. **Version guard is check-then-bump without a transaction** and is opt-in (`expectedVersion` omitted ⇒ unprotected).
8. Timestamps are all ISO-8601 strings, arrays all JSON strings, booleans all 0/1 — `mappers.ts` is the single conversion boundary and `parseJsonArray` also tolerates `"a|b,c、d"` from CSV.
9. **Logger scrubs by key name** (`utils/logger.ts:12-23`) — `phone`, `name`, `token`, `secret`, `password`, `apikey`, etc. — and `utils/mask.ts` provides `maskPhone` (`****678`), `maskCaseId` (`2026****`), `maskLineUserId` (first 5 + `…`), `maskName` (`王O明`). Reproduce both.
10. The **AI layer is entirely mocked** (`aiService.isEnabled() === false`); `ragService` is a real keyword retriever over `knowledge_documents` using Chinese character bigrams with a `minScore` of 2 when the query yields multiple terms. `securityCheckService` is a pure heuristic (14 scam phrases, `.gov.tw` allowlist, 6 suspicious TLDs, IP-literal and `http://` checks) with thresholds `≥3 reasons → high`, `≥1 → medium`, else `low`.