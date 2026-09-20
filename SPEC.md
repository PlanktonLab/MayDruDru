# MayDru — 政府申辦流程協助平台 技術規格 (SPEC)

- 版本：v1.0（開工前定稿）
- 日期：2026-09-19
- 狀態：已與產品負責人達成共識，等待開工
- 來源專案：`youth-line-bot`（LINE Bot）、`SOP_Tutor`（SOP 製作與導引）、`proreview`（資料審核）、`submit-flow`（申請送件）

---

## 0. 一句話

把四個各自試做的小專案整合成**一個後端、兩個前端、一個 LINE channel**，讓市民能在網頁匿名送件、在 LINE 隨手求助，讓承辦人能在同一個後台管理罐頭訊息、製作 SOP、審核案件、設定方案；所有能力同時以 `/v1` API 對外開放，成為可重複套用到其他機關與方案的 SaaS。

---

## 1. 目標、範圍與非目標

### 1.1 目標
1. **統一技術路線**：一個 Python FastAPI 後端，一套 React/Vite 前端工具鏈，一組資料庫。
2. **三個平台**：
   - (a) 統一後端 API（含 LINE webhook、SOP 服務、審核服務、申請服務、內容服務）
   - (b) 後台 Admin（承辦人用）
   - (c) 申請人網頁（市民用）
   - LINE Bot 是後端的一個 **channel**，不是獨立平台。
3. **Agent 一律用 LangChain / LangGraph**，且只出現在明確定義的位置（§9）。
4. **接近可上線的 SaaS 品質**：測試、CI、部署、RBAC、隱私紅線齊備。

### 1.2 範圍內
- 單一機關、多補助方案（第一個方案：新竹市「AI 領航青年數位工具補助計畫」）。
- 匿名送件 + 案件編號查詢/補件。
- 瀏覽器端 OCR（tesseract.js）+ 伺服器端規則引擎審核。
- SOP 製作（Canvas）、SOP 導引（step card / 截圖定位），LINE 與網頁皆可用。
- 罐頭訊息目錄與內容助理。
- LINE 推播通知。
- `/v1` 公開 API + outbound webhook。
- 既有資料搬遷（youth-line-bot SQLite、SOP_Tutor Postgres/MinIO）。

### 1.3 非目標（本版不做）
- 多租戶 UI（schema 保留 `tenant_id`，UI 只操作單一 tenant）。
- 帳號系統（LINE Login / LIFF / 自然人憑證）；申請人不登入。
- Email / 簡訊通知。
- 紙本建案 UI（資料模型保留 `intake_channel = PAPER`）。
- LLM 生成任何直接呈現給市民的文字。
- LLM 讀取申請證明文件。
- 伺服器端 OCR。

---

## 2. 既有專案盤點與取用決策

| 專案 | 技術 | 取用 | 捨棄 |
|---|---|---|---|
| **SOP_Tutor** | Python 3.12 / FastAPI / SQLAlchemy async / Alembic / LangChain 1 + LangGraph / arq / Playwright；React 19 + Vite + Tailwind 4；Postgres 17 + pgvector / Redis / MinIO | **作為統一後端與 admin 前端的基底**：全部程式碼、資料模型、Canvas 編輯器、ingestion graph、session graph、assistant、retrieval、`structured_call` chokepoint、auth/RBAC/API key、docker 佈局 | evals 頁面降為次要；tenant policy 文案併入 `contents` |
| **youth-line-bot** | TypeScript / Express / SQLite / vanilla admin | **移植為 Python**：LINE webhook 簽章驗證與非同步派發、postback action 表（~20 個）、對話狀態、案件編號 + 手機兩因子驗證、Flex 訊息（案件時間軸、案件列表、方案卡片）、rich menu 同步、推播、119 條 content registry、draft/publish、LINE 預覽、規則式意圖分類（作為 LLM 失敗時 fallback）、optimistic locking（version 欄位） | 程式碼本身（TS）、SQLite、vanilla admin、mock AI service、keyword RAG |
| **submit-flow** | Next.js 16 / React 19 / Tailwind 4 / JSON 檔 | **搬到 Vite**：6 步送件流程 UI、`MaskEditor`（卡號自動偵測 + 手動遮罩 + 必須確認）、`image.ts`（HEIC 處理、縮圖、品質探測）、`creditCardOcr.ts`、狀態機設計（狀態集合、轉移表、角色、理由、不可變事件）、12 種 DocumentType / 12 種退件碼 / `CHANNEL_DOCS` / tier 設定（轉為 DB 資料）、`precheck()` / `judgeBilling()`（轉為規則引擎 rule_type）、staff 審核頁（queue、DocViewer、ComparePanel、CaseActions、RejectionForm）、docs/ 決策紀錄 | Next.js、API routes、JSON 檔、cookie 假登入、`seed.ts` 假案件（僅取 demo 用子集） |
| **proreview** | Node raw http / tesseract.js / JSON 檔 | **概念與 UI 互動**：OCR 輸出格式 `{text, confidence, lines[{text, confidence, bbox, words}]}`、圖片 pan/zoom + OCR 高亮 canvas、欄位規則卡（待確認/符合/不符/無法辨識 + 人工覆寫）、欄位設定對話框（→ 規則編輯器）、決策列 | 後端全部、JSON 檔、Node 端 OCR |

---

## 3. 系統架構

```
                        ┌──────────────────────────────────────────────┐
  市民 (瀏覽器)  ──────▶│ apply-web (Vite SPA)  maydru.xamjiang.com    │
  市民 (LINE)    ──┐    └───────────────┬──────────────────────────────┘
                   │                    │ /api (public, no auth) + /v1
  承辦人 (瀏覽器) ─┼───▶┌───────────────┴──────────────────────────────┐
                   │    │ admin-web (Vite SPA) maydru-admin.xamjiang.com│
                   │    └───────────────┬──────────────────────────────┘
                   │                    │ /api (JWT)
  外部系統 ────────┼───▶ /v1 (API key) ─┤
                   │                    ▼
                   │    ┌──────────────────────────────────────────────┐
  LINE Platform ───┴──▶ │ api (FastAPI)  maydru-api.xamjiang.com       │
        /line/webhook   │  routers: line, sop, review, apply, contents,│
                        │           schemes, notify, admin, public_v1  │
                        │  services: guide, policy, content, review,   │
                        │           application(state machine), notify │
                        │  ai: intent, locate, ingestion_graph,        │
                        │      session_graph, assistant, copilot       │
                        └───┬──────────┬──────────┬──────────┬─────────┘
                            │          │          │          │
                     ┌──────▼───┐ ┌────▼────┐ ┌───▼────┐ ┌───▼──────────┐
                     │ Postgres │ │  Redis  │ │ MinIO  │ │ worker (arq) │
                     │ +pgvector│ │ queue/  │ │ private│ │ ingestion,   │
                     │          │ │ session │ │ public │ │ push, purge, │
                     └──────────┘ └─────────┘ └────────┘ │ webhook,     │
                                                         │ expire       │
                                                         └───┬──────────┘
                                                             │
                                                      ┌──────▼──────────┐
                                                      │ renderer        │
                                                      │ (Playwright)    │
                                                      └─────────────────┘
```

**原則**
- 單一 FastAPI app、單一 arq worker、單一 renderer。不拆微服務。
- 每個 router 都是薄殼；業務邏輯全在 `services/`，LINE、admin、`/v1` 共用同一份 service。
- SOP 由 LINE 模組**同 process 直接呼叫** `services/guide.py`，不走 HTTP。
- 所有能力同時暴露為 `/v1`（API key）；`/api`（JWT / 匿名）只是給自家前端的包裝。

---

## 4. 技術棧（定案）

| 層 | 選擇 | 備註 |
|---|---|---|
| 後端語言 | Python 3.12 | 沿用 SOP_Tutor |
| Web 框架 | FastAPI 0.141+ | |
| ORM / migration | SQLAlchemy 2 async + Alembic | 既有 0001–0010 migration 續接 |
| 任務佇列 | arq（Redis） | OCR 不在 worker；worker 跑 ingestion、推播、webhook、purge、expire |
| Agent | LangChain 1.x + LangGraph 1.x；`init_chat_model` 供應商可切換；`LLM_PROVIDER=fake` 離線測試 | 預設 OpenAI，SPEC 明列每個送外部的資料類型 |
| 向量 | pgvector（1536 維） | FAQ 比對、SOP retrieval |
| 物件儲存 | MinIO（S3 相容） | private bucket（證明文件、承辦人原圖加密）、public bucket（step card，content-hash 檔名） |
| 渲染 | Playwright（renderer 服務） | step card / replica |
| 前端 | React 19 / TypeScript / Vite / Tailwind 4 / react-router 7 / TanStack Query 5 / lucide-react | admin-web 與 apply-web 同工具鏈 |
| 瀏覽器 OCR | tesseract.js 6（chi_tra + eng）；PDF 用 pdf.js 轉頁圖，限 5 頁 | 申請人端與承辦人端 |
| Python 套件管理 | uv workspace | 取代 pip requirements |
| JS 套件管理 | npm workspaces | |
| API client | OpenAPI → `packages/api-client`（openapi-typescript + fetch wrapper） | 前後端契約以 OpenAPI 為準 |
| 測試 | pytest + pytest-asyncio + aiosqlite；vitest + Testing Library；Playwright e2e | |
| CI | GitHub Actions | lint / typecheck / pytest / vitest / e2e / docker build（arm64 + amd64） |
| 部署 | docker compose on OracleCloud VM（Ubuntu 24.04 **ARM64**）+ 主機 nginx + Cloudflare | |
| 觀測 | OpenTelemetry → self-hosted collector（沿用） | 不用 LangSmith |

---

## 5. Monorepo 版面

```
MayDru/
├── SPEC.md
├── README.md
├── CLAUDE.md                      # 工作規則（見 §17）
├── pyproject.toml                 # uv workspace root
├── package.json                   # npm workspaces root
├── docker-compose.yml             # 開發
├── docker-compose.prod.yml        # VM 覆寫（ports !override、restart）
├── docker/
│   ├── api.Dockerfile  worker.Dockerfile  renderer.Dockerfile
│   ├── admin-web.Dockerfile  apply-web.Dockerfile
│   ├── nginx-admin.conf  nginx-apply.conf   # 容器內 nginx（SPA fallback）
│   └── otel-collector.yaml
├── deploy/
│   ├── nginx/maydru.conf          # 主機 nginx 三個 server block
│   └── vm-setup.md
├── apps/
│   ├── api/                       # FastAPI（從 SOP_Tutor/backend 起家）
│   │   ├── app/
│   │   │   ├── main.py  config.py  db.py  models/  deps.py  security.py
│   │   │   ├── routers/
│   │   │   │   ├── line.py            # /line/webhook
│   │   │   │   ├── public_v1/         # /v1/*（API key）
│   │   │   │   ├── apply.py           # /api/apply/*（匿名）
│   │   │   │   ├── admin/             # /api/admin/*（JWT）
│   │   │   │   └── media.py
│   │   │   ├── services/
│   │   │   │   ├── application.py     # 狀態機、建案、補件、撤回
│   │   │   │   ├── review.py          # 規則引擎、判定、覆寫
│   │   │   │   ├── scheme.py
│   │   │   │   ├── contents.py        # 罐頭訊息 draft/publish/render（複數，見 D19）
│   │   │   │   ├── faq.py  knowledge.py
│   │   │   │   ├── notify.py          # LINE push + outbound webhook
│   │   │   │   ├── guide.py  policy.py  publish.py  stepcard.py（沿用）
│   │   │   │   └── line/              # sender, flex, richmenu, handlers, conversation
│   │   │   ├── ai/
│   │   │   │   ├── llm.py  prompts.py  schemas.py  fake.py  tracing.py（沿用）
│   │   │   │   ├── intent.py          # 市民訊息意圖分類（結構化）
│   │   │   │   ├── retrieval.py  ingestion_graph.py  session_graph.py  assistant.py（沿用）
│   │   │   │   └── copilot.py         # 內容助理（承辦人側）
│   │   │   ├── content_registry/      # 罐頭訊息預設值（自 youth-line-bot 轉譯）
│   │   │   └── worker/  main.py  tasks.py
│   │   ├── alembic/
│   │   ├── tests/
│   │   └── scripts/  seed.py  migrate_legacy/  e2e_smoke.py
│   ├── renderer/                  # 沿用
│   ├── admin-web/                 # 從 SOP_Tutor/frontend 起家
│   │   └── src/  pages/{line,sop,review,schemes,members,api-keys,dashboard}
│   └── apply-web/                 # 從 submit-flow 搬遷
│       └── src/  pages/{apply,status,sop,help}
├── packages/
│   ├── ui/                        # 共用元件、Tailwind preset、設計 token
│   ├── api-client/                # OpenAPI 產生
│   ├── ocr/                       # tesseract.js 包裝、PDF→圖、輸出格式
│   ├── review-rules/              # 規則引擎 TS 版（precheck 即時回饋用；伺服器 Python 版為準）
│   └── mask-editor/               # MaskEditor 元件
└── .github/workflows/ci.yml
```

---

## 6. 領域模型與資料表

所有表都有 `tenant_id`、`created_at`、`updated_at`；可編輯的設定表有 `version`（optimistic locking → 409）。

### 6.1 沿用 SOP_Tutor（不改）
`tenants, users, api_keys, goals, platforms, style_docs, style_doc_versions, platform_components, flows, steps, edges, variants, flow_versions, event_logs, llm_usage, eval_cases, eval_runs`

### 6.2 方案設定（新）
| 表 | 主要欄位 |
|---|---|
| `schemes` | id, code, name, category, description, eligibility, age_min/max, application_start/end, official_url, contact, amount_note, tags[], identity_tags[], details JSON, active, **retention_days**(預設 90), **supplement_days**(預設 14), **max_revisions**(預設 3) |
| `scheme_tiers` | scheme_id, code(GENERAL/LOW_INCOME…), label, subsidy_rate, cap_amount, required_proof_doc_types[] |
| `document_types` | scheme_id, code, label, hint, required, must_mask, keep_after_disbursed, accepted_mime[], max_pages, sort_order |
| `payment_channels` | scheme_id, code(CREDIT_CARD/TELECOM/E_PAYMENT/OTHER), label, required_document_type_codes[], guide_content_key |
| `review_rules` | scheme_id, code, label, document_type_code, **rule_type**(§8.3), config JSON, required, severity, sort_order, active |
| `rejection_codes` | scheme_id, code, staff_label, public_what_wrong, public_how_to_fix, related_document_type_codes[], related_sop_flow_ids[] |
| `document_type_sop_flows` | document_type_id, flow_id, platform_id（多對多：同一文件在不同平台有不同 SOP） |
| `eligible_tools` | scheme_id, name, vendor, aliases[], status(APPROVED/PENDING/REJECTED), verdict_note（submit-flow 的 tools / pendingTools） |

### 6.3 申請與審核（新）
| 表 | 主要欄位 |
|---|---|
| `applications` | id, **case_no**(對外編號，格式 `HC-YYYY-NNNNNN`), scheme_id, tier_code, payment_channel_code, intake_channel(WEB/PAPER), applicant_name, phone, phone_last4_hash, id_last4_hash, email, tool_name, tool_id, purchase_amount, purchase_date, paid_by_proxy, note, **status**, first_submitted_at, last_submitted_at, revision_count, supplement_items JSON, supplement_deadline, payment_date, payment_amount, documents_purge_at, assigned_reviewer_id, version |
| `application_documents` | id, application_id, document_type_code, revision, supersedes_id, is_current, object_key(private bucket), mime, size, page_count, preview_key, masked(bool), uploaded_at |
| `document_ocr_results` | id, document_id, **source**(applicant/reviewer), engine, lang, text, confidence, lines JSON, created_at |
| `review_findings` | id, application_id, rule_id, document_id, status(PENDING/MATCH/MISMATCH/UNREADABLE), extracted_value, expected_value, confidence, bbox JSON, source(auto/reviewer), note, reviewer_id, decided_at |
| `application_status_events` | id, application_id, from_status, to_status, transition_code, actor_type(APPLICANT/STAFF/SYSTEM), actor_id, reason, rejection_codes[], payload JSON, created_at（**不可變**） |
| `case_verifications` | id, application_id, line_user_id, verified_at, method（LINE 綁定；取代 youth-line-bot `user_cases`） |

### 6.4 內容與 LINE（新，自 youth-line-bot 轉譯）
| 表 | 主要欄位 |
|---|---|
| `contents` | key(唯一), category, title, description, content(published), draft, content_type(text/button/label/flex), variables[], scheme_id(nullable：方案專屬文案), sort_order, version, published_at, published_by |
| `faqs` | id, category, question, answer, keywords[], priority, active, embedding vector(1536), scheme_id(nullable), source(manual/copilot), version |
| `knowledge_documents` | id, title, content, source_url, source_type, tags[], embedding |
| `media` | id, key, mime, size, alt, uploaded_by |
| `line_users` | line_user_id, display_name, followed_at, blocked_at |
| `line_conversations` | line_user_id(PK), flow(idle/case_verify/sop_session/…), step, data JSON, sop_session_id, updated_at, expires_at |
| `line_rich_menus` | id, name, layout JSON, image_key, line_rich_menu_id, is_default, synced_at |
| `line_sync_logs` | 沿用 |
| `unmatched_messages` | id, line_user_id_hash, text, intent_result JSON, created_at（餵給內容助理 (b)） |
| `notifications` | id, application_id, line_user_id, kind, content_key, payload JSON, status, error, sent_at |
| `webhook_subscriptions` | id, api_key_id, url, secret, events[], active |
| `webhook_deliveries` | id, subscription_id, event, payload, status, attempts, last_error |
| `audit_logs` | actor_id, action, target_type, target_id, diff JSON |

### 6.5 角色
`owner > admin > {sop_editor, sop_reviewer, case_reviewer, case_supervisor}`
- `sop_editor`：Canvas 編輯、上傳截圖、送審。
- `sop_reviewer`：審核 SOP 內容（ingestion graph 的 human-in-the-loop）。
- `case_reviewer`：審案、標記 findings、送出建議。
- `case_supervisor`：核准、退件、取消、撥款確認。
- `admin`：以上全部 + 方案設定 + 內容發布 + rich menu。
- `owner`：admin + 成員與 API key。

授權判斷以 **capability** 為準，不以角色高低為準（決策 D14）：每個端點宣告自己需要
`sop_edit`、`sop_review`、`case_review`、`case_supervise`、`admin` 或 `owner`，角色只是
capability 的組合。另保留 `viewer` 作為舊資料的唯讀層級，UI 不再提供。

---

## 7. 案件狀態機

```
SUBMITTED ──T1(system)──▶ UNDER_REVIEW ──T3(supervisor)──▶ APPROVED ──T6(supervisor)──▶ DISBURSING ──T7(supervisor)──▶ DISBURSED
                              │ ▲
                 T2(reviewer) │ │ T5(system, on resubmit)
                              ▼ │
                        NEEDS_REVISION ──T4(applicant)──▶ REVISION_SUBMITTED
                              │
                              └──T8(system, deadline passed)──▶ EXPIRED

UNDER_REVIEW ──T9(supervisor, rejection_codes+reason)──▶ REJECTED
SUBMITTED | UNDER_REVIEW | NEEDS_REVISION ──T10(applicant)──▶ WITHDRAWN
任一非終態 ──T11(supervisor, reason)──▶ CANCELLED_BY_STAFF
```

| 規則 | 說明 |
|---|---|
| 終態 | DISBURSED, REJECTED, WITHDRAWN, CANCELLED_BY_STAFF, EXPIRED |
| 排隊順序 | 以 `first_submitted_at` 排序，補件**不重排** |
| 補件 | T2 必填 `supplement_items[]`（document_type_code + rejection_code + 說明）與 `supplement_deadline`（預設今日 + scheme.supplement_days）；`revision_count` ≥ `max_revisions` 時 T2 被拒，需走 T9 |
| 文件版本 | 補件產生新 `application_documents` 列（revision+1, supersedes_id, is_current），舊版保留至 purge |
| 理由 | T9、T11 必填 reason；T9 必填 ≥1 個 rejection_code |
| 事件 | 每次轉移寫一筆 `application_status_events`；禁止 UPDATE/DELETE（DB trigger） |
| 通知 | T2、T3、T7、T8、T9、T11 觸發通知（§8.7） |
| 清除 | 進入終態時設 `documents_purge_at = now + scheme.retention_days`；worker 每日執行硬刪 MinIO 物件、OCR 結果、findings 的 bbox；保留 application 主檔與事件 |
| 文案 | 每個狀態在 `contents` 有 `status.{STATUS}.public_label / staff_label / next_action / notify_headline` |

狀態機以**單一** `services/application.py::transition()` 實作，所有入口（apply-web、admin、`/v1`、system job）都經過它；它負責角色檢查、前置條件、事件、通知、purge 排程。

---

## 8. 功能規格

### 8.1 apply-web（申請人網頁）

路由：
| 路徑 | 功能 |
|---|---|
| `/` | 方案列表（active schemes）、入口 |
| `/apply/:scheme` | 6 步送件：工具 → 身分 → 繳費管道與購買資訊 → 準備指引（SOP 連結）→ 上傳（身分文件 / 繳費證明 / 撥款與切結）→ 確認 |
| `/status` | 輸入案件編號 + 手機末四碼（或身分證末四碼）→ 驗證 → 進入案件頁 |
| `/status/:case_no` | 進度時間軸、目前狀態的 `next_action` 文案、補件面板（NEEDS_REVISION 時）、撤回 |
| `/sop` / `/sop/:flow` | SOP 教學頁：選平台與文件 → step card 逐步瀏覽；「我卡住了」上傳截圖（先進遮罩編輯器）→ 定位 |
| `/help` | FAQ（前端本地搜尋 + `/api/faqs/search`） |

規則：
- **匿名**：不登入。送件成功回傳 `case_no`，並顯示「請截圖保存」與 LINE 綁定 QR（deep link 到 LINE 並帶 `case_no`，在 LINE 內完成手機驗證綁定）。
- **上傳流程**（每份文件）：
  - 每張文件卡在拍照／選檔旁提供「帶我取得」情境入口，直接使用該方案與文件類型對應的已發布 SOP。只有一條流程時直接進入逐步卡片；多條時才請使用者選平台。教學以 modal 保留申請上下文，最後一步直接回到原文件欄位；完整頁仍保留截圖定位能力。
  1. `packages/ocr`：讀檔（HEIC 明確失敗訊息）→ 縮至長邊 2400 → 品質探測（模糊/過暗警告）→ PDF 以 pdf.js 轉前 5 頁。
  2. `must_mask` 文件強制進 `packages/mask-editor`：自動偵測卡號（tesseract.js + Luhn）→ 使用者手動塗黑 → 必須勾選確認。遮罩後的圖才進下一步；原圖不離開瀏覽器。
  3. tesseract.js（chi_tra+eng）辨識 → 產出標準 OCR 結果。
  4. `packages/review-rules` 用 scheme 的 `review_rules` 做 **即時 precheck**：PASS / FAIL / INDETERMINATE；FAIL 顯示 rejection_code 的公開說明與對應 SOP 連結，但只作提示，使用者確認原圖含有所需欄位後可忽略並繼續送出。
  5. 送出：圖 + OCR 結果（`source=applicant`）+ precheck 結果一起 POST。**伺服器重新跑規則引擎**，不信任前端結果。
- **查詢驗證**：`case_no` + `phone_last4`（或 `id_last4`），伺服器比對 hash；5 次失敗鎖 15 分鐘（Redis）。驗證成功發短效 token（30 分鐘，僅限該案件）供後續補件/撤回。
- **補件**：只顯示 `supplement_items` 列出的文件類型；上傳流程同上；送出觸發 T4。
- **SOP 求助截圖**：先遮罩（可略過）→ 送 `/api/sop/locate` → 回定位結果與 step card。頁面顯示「此截圖會交由 AI 辨識，請先遮蔽敏感資訊」。
- **設計**：Apple HIG 原則（§15）；行動優先；可放大至 200%；每頁一個主要動作；錯誤訊息說「怎麼修」而非「錯在哪」。

### 8.2 admin-web（後台）

以 SOP_Tutor 的 `AppShell` 為基底，左側導航四區 + 系統：

| 區 | 頁面 | 來源 |
|---|---|---|
| **LINE 內容** | 罐頭訊息（分類樹、draft/publish/reset、變數提示、LINE 預覽渲染）、FAQ、知識文件、rich menu（版面、圖片、同步與同步日誌）、推播紀錄（含案件綁定用戶 Demo 缺件通知按鈕）、用戶 Feedback、未命中訊息（含內容助理建議） | youth-line-bot admin 重寫為 React |
| **SOP** | Canvas（沿用）、審核佇列（sop_reviewer）、Playground、平台/目標管理、**文件類型對照**（document_type ↔ flow） | SOP_Tutor |
| **案件審核** | 「審查作業」獨立導覽含案件總覽與資料重點設定；總覽依 first_submitted_at 排隊並可篩選狀態/方案/審核人，案件頁左側為文件 pan/zoom + OCR／finding 高亮，畫布固定顯示案件、申請人、方案、金額、審核人與缺件摘要，右側為規則 findings（自動判定 + 人工覆寫 + 備註）、比對、決策列與事件時間軸；資料重點設定依方案管理查核欄位、適用文件、關鍵字／格式、必要性並可試算；「重新辨識」在承辦人瀏覽器跑 tesseract.js，`source=reviewer` | submit-flow staff + proreview 互動 |
| **方案管理** | schemes CRUD、tiers、document_types、payment_channels、review_rules（規則編輯器：四種 rule_type 表單）、rejection_codes、eligible_tools（待審工具佇列）、內容助理 (c) 一鍵產生方案文案草稿 | 新 |
| **系統** | Dashboard（案件統計、SOP 使用、LLM 用量）、成員、API keys、webhook 訂閱、稽核日誌 | SOP_Tutor + 新 |

### 8.3 審核規則引擎

`review_rules.rule_type` 與 `config`：

| rule_type | config | 判定 |
|---|---|---|
| `keyword_extract` | `keywords[]`, `value_after_keyword: bool`, `regex?` | 在指定 document_type 的 OCR lines 中找關鍵字（拉丁優先 → 子字串 → 去空白），可選 regex 抽值；命中 → MATCH 並回 bbox；未命中 → UNREADABLE |
| `regex_extract` | `pattern`, `group`, `normalize(amount/date/last4)` | 全文 regex 抽值 |
| `amount_tolerance` | `source_rule_code`, `compare_to(field: purchase_amount)`, `tolerance_pct`, `tolerance_abs` | 抽出金額與申報金額比對；容差內 MATCH，否則 MISMATCH |
| `required_doc` | `document_type_codes[]`（或由 payment_channel 推導） | 缺件 → MISMATCH，並自動建議 supplement_items |

- Python 實作為準（`services/review.py`），TS 版（`packages/review-rules`）只做前端即時回饋，兩者共用同一組 fixture 測試確保一致。
- 自動判定寫入 `review_findings(source=auto)`；承辦人覆寫另寫一列 `source=reviewer`，取最新。
- 核准（T3）前置條件：所有 `required` 規則的最新 finding 為 MATCH（伺服器端強制）。
- 證明文件**永不**送 LLM；規則引擎不呼叫任何模型。

### 8.4 LINE channel

- **Webhook** `POST /line/webhook`：HMAC-SHA256 簽章驗證（`timingSafeEqual`）；憑證缺失時**拒絕**請求（不再跳過驗證）；立即 200 後非同步派發。
- **訊息原則（紅線）**：所有回覆文字來自 `contents` 或承辦人審核過的 step card；LLM 只做分類與定位。
- **Rich menu**（3×2）：案件查詢、我的案件、方案資訊、申請小幫手（SOP）、常見問題、聯絡我們。
- **測試入口** `POST /__test__/line/inbound`：同步跑完 handler 並回傳 bot 會送出的訊息，供 §14 的 E2E 使用。只在 `ENV != production` 且 `LINE_SENDER != line` 時存在，其餘情況一律 404。
- **對話狀態** `line_conversations.flow`：
  - `idle`：postback 走 action 表；自由文字 → §9.1 intent → 罐頭/FAQ/quick reply；圖片 → §9.2 locate → 命中則開 `sop_session` 並回 step card，未命中回「認不出來，你要準備哪份文件？」quick reply。
  - `case_verify`：案件編號 → 手機末四碼 → 綁定 `case_verifications` → 回案件時間軸 Flex。
  - `sop_session`：綁 `sop_session_id`（SOP_Tutor Session API）；文字 → intent（next / stuck / switch / exit / unknown）；圖片 → session locate；step card 以 image + quick reply（下一步 / 我卡住了 / 換流程 / 結束）回覆。**退出**：完成、`exit` 意圖、任一 rich menu postback、30 分鐘無互動（`expires_at`）。
  - `feedback`：功能完成後由快速回覆進入；下一則文字存入 `line_feedback`，LINE user id 只留不可逆雜湊，後台可依情境與案件查看。
- **推播**：狀態變更 → `services/notify.py` → 對已綁定該案件的 LINE 使用者 push；退件推播附兩個按鈕：「教我準備」（postback 開對應 SOP session）與「前往補件」（apply-web 連結，帶 `case_no`）。
- **Demo 推播**：後台可對指定案件送出不改狀態的缺件提醒；只通知已綁定該案件的使用者，按「不會獲取信用卡消費紀錄嗎？」後開啟對應銀行／平台的完整 SOP，完成後可留下 Feedback。
- **綁定入口**：apply-web 送件成功頁的 LINE deep link（`?case=HC-…`）→ Bot 收到後直接進 `case_verify` 只需手機末四碼。
- **敏感提醒**：進 `sop_session` 或 idle 收到圖片前的第一則回覆包含 `security.screenshot_notice` 文案（請勿含卡號等資訊；網頁上傳可先遮罩）。

### 8.5 SOP 服務

沿用 SOP_Tutor 全部：Canvas 製作、ingestion graph（人審 interrupt）、step card 渲染、Session API、Chat API、locate、intent、retrieval、policy。變更：
- `goals` 與 `document_types` 建立對照（`document_type_sop_flows`）。
- tenant policy 的語氣/模板文案改讀 `contents`（key 前綴 `sop.`）。
- `/v1/sop/*` 路徑前綴統一（原 `/v1/chat`、`/v1/sessions` 保留別名一版）。
- apply-web 的 SOP 教學頁使用 `/api/sop/flows/:id/steps` 與 `/api/sop/locate`（匿名、rate limit）。

### 8.6 內容與內容助理

- `contents`：youth-line-bot 的 119 個 key 原名搬入，加上狀態文案、退件碼文案、SOP 語氣、通知文案。`content.t(key)` / `content.tf(key, vars)`；快取 + 寫入即失效；缺值回 registry 預設，永不拋錯。
- **內容助理**（承辦人側 LangChain，只寫 `draft`）：
  - (a) 依 key 的 description、語氣設定、變數清單產生/改寫草稿（白話、精簡、步驟化）。
  - (b) 從 `unmatched_messages` 聚類（embedding + LLM 命名）→ 建議新 FAQ 條目與答案草稿；答案只能引用 `schemes` / `knowledge_documents` / 既有 `contents`，每句附引用，無依據的句子標「待查證」。
  - (c) 依 scheme 設定一鍵產生整套方案文案草稿（狀態 × 4 種文案、退件碼公開說明、指引）。
  - 每次生成記 `llm_usage` 與 `audit_logs`；發布仍需 admin 按「發布」。

### 8.7 通知

- 通道：LINE push（唯一）。
- 觸發：T2 退件補件、T3 核准、T7 撥款、T8 逾期、T9 駁回、T11 取消。
- 內容：`contents` 的 `notify.{transition}` 模板 + 狀態 `notify_headline`；Flex 附案件時間軸與動作按鈕。
- 記錄：`notifications`（status: queued/sent/failed，錯誤保留）；worker 重試 3 次。
- 外部：同時觸發 outbound webhook（§10.3）。
- Demo 缺件通知是明確的人工作業，不建立虛構狀態事件；仍寫入 `notifications` 並走同一個 worker／重試機制。

---

## 9. Agent 規格（LangChain / LangGraph）

所有模型呼叫經 `ai/llm.py::structured_call()`（Pydantic 結構化輸出、token/延遲/成本記錄、OTel span、`LLM_PROVIDER=fake` 離線）。

| # | 位置 | 觸發 | 輸入 | 輸出 | 給市民看的文字？ |
|---|---|---|---|---|---|
| 9.1 | `ai/intent.py` | LINE idle 自由文字；sop_session 內文字 | 文字 + 候選集合（postback actions、FAQ 標題 top-k by embedding、session 意圖） | `{intent, target_id, confidence}` | 否，只選罐頭 |
| 9.2 | `ai/retrieval.py`（沿用） | LINE 圖片、網頁「我卡住了」、session 截圖 | 截圖（記憶體）+ 候選 flow/steps | located / ambiguous / off_flow / … | 否，只選 step card |
| 9.3 | `ai/session_graph.py`（沿用） | SOP session 每回合 | 狀態 + 使用者動作 | 下一個 step / clarification / escalation / completed | 否（step card 文字為承辦人審過） |
| 9.4 | `ai/assistant.py`（沿用） | `/v1/sop/chat`（外部頻道、Playground） | 對話 | 工具呼叫 → 文字/圖片/選項 | **是**，但僅限 `/v1` 外部頻道與 Playground，LINE 不接 |
| 9.5 | `ai/ingestion_graph.py`（沿用） | 承辦人上傳 SOP 截圖 | 原圖（加密）、focus boxes | 去識別化 replica、structure、check report；人審 interrupt | 否（人審後才成為 step card） |
| 9.6 | `ai/copilot.py` | admin 內容助理 | key/描述/語氣/變數；未命中訊息；scheme 設定 | 草稿（附引用） | 否（寫 draft，人發布） |
| 9.7 | FAQ 比對 | idle 文字 | embedding 相似度 + 9.1 確認 | FAQ id | 否，回既有答案 |

**紅線**
1. LLM 永不生成直接呈現給市民的文字（9.4 例外且不接 LINE）。
2. 申請證明文件永不進任何 LLM；`services/review.py` 與 `routers/apply.py` 禁止 import `ai/`（lint 規則）。
3. 市民截圖（LINE / 網頁）只在記憶體處理，不落地（`MultiPartParser.spool_max_size`、nginx `proxy_request_buffering off`，沿用）。
4. 承辦人原圖加密（Fernet）存 private bucket，人審通過後硬刪；checkpoint thread 於通過後刪除。
5. 每個 LLM 呼叫可切換供應商；SPEC §11 明列外送資料類型；使用條款揭露。
6. 意圖分類失敗（timeout / 低信心）→ 規則式分類器 fallback → quick reply 選單；系統永不因 LLM 失敗而無回應。

---

## 10. API 契約

OpenAPI 由 FastAPI 產生，`packages/api-client` 自動生成，CI 檢查 client 與 schema 同步。

### 10.1 `/v1`（API key，`Authorization: Bearer <key>`，per-key rate limit，tenant 由 key 決定）

| 群組 | 端點 |
|---|---|
| Schemes | `GET /v1/schemes`, `GET /v1/schemes/{code}`（含 document_types、channels、rejection_codes 公開欄位） |
| Applications | `POST /v1/applications`（建案 + 文件 + OCR 結果）, `GET /v1/applications/{case_no}`, `POST /v1/applications/{case_no}/documents`, `POST /v1/applications/{case_no}/transitions`（T4/T10 由 applicant token；其餘需 staff 權限的 key scope）, `GET /v1/applications/{case_no}/events` |
| Review | `POST /v1/review/evaluate`（scheme + documents + ocr → findings，不落地，純運算）, `GET /v1/review/rules?scheme=`, `GET /v1/applications/{case_no}/findings`, `PUT /v1/applications/{case_no}/findings/{rule_code}` |
| SOP | `GET /v1/sop/catalog/*`, `GET /v1/sop/flows/{id}/steps`, `POST /v1/sop/locate`, `POST /v1/sop/intent`, `POST /v1/sop/sessions`, `POST /v1/sop/sessions/{id}/actions`, `POST /v1/sop/sessions/{id}/screenshots`, `POST /v1/sop/chat`, `POST /v1/sop/chat/{id}/messages`, `GET /v1/sop/document-types/{code}/flows` |
| Contents | `GET /v1/contents?category=`, `GET /v1/contents/{key}`（published）, `POST /v1/contents/render`（key + vars → 文字/Flex） |
| FAQ / Intent | `POST /v1/faqs/search`, `POST /v1/intent/classify` |
| Notifications | `GET /v1/notifications?case_no=` |
| Webhooks | `POST /v1/webhooks`, `GET /v1/webhooks`, `DELETE /v1/webhooks/{id}`, `POST /v1/webhooks/{id}/test` |

API key scopes：`read`, `apply`, `review`, `sop`, `contents`, `webhooks`, `admin`。

### 10.2 `/api`（自家前端）
- `/api/apply/*`：匿名 + rate limit；`/api/apply/verify` 發案件 token；帶 token 的補件/撤回。
- `/api/sop/*`：匿名（flows/steps/locate）。
- `/api/admin/*`：JWT，RBAC 依 §6.5。
- `/api/auth/*`：沿用 SOP_Tutor（login、refresh、password change 使 token 失效）。

### 10.3 Outbound webhook
- 事件：`application.status_changed`, `application.created`, `application.document_uploaded`, `review.findings_updated`, `sop.session_completed`, `content.published`。
- 格式：`{id, event, occurred_at, tenant_id, data}`；`X-MayDru-Signature: sha256=HMAC(secret, body)`；`X-MayDru-Delivery: <uuid>`。
- 重試：指數退避 5 次；`webhook_deliveries` 可查、可重送。

### 10.4 LINE
- `POST /line/webhook`（LINE 平台專用，簽章驗證）。

---

## 11. 安全與隱私

| 項目 | 規範 |
|---|---|
| 申請證明文件 | 上傳前瀏覽器遮罩（must_mask 強制）；存 MinIO private bucket；只經 presigned URL（5 分鐘）給 admin；永不送 LLM；終態後 `retention_days`（預設 90）硬刪 |
| OCR | 只在瀏覽器；伺服器只存結果；`source=applicant` 的結果視為不可信，規則引擎在伺服器重跑 |
| 申請人識別 | 手機與身分證各存末四碼 hash（+ salt）供查詢驗證；完整手機加密存（推播綁定用）；完整身分證字號加密存（核銷造冊用，D40），僅 `application.read_pii` 能解密，解密一律寫稽核日誌 |
| 市民截圖（SOP） | 記憶體處理不落地；送外部 LLM 供應商前於 UI 揭露；網頁端可先遮罩 |
| 承辦人 SOP 原圖 | Fernet 加密、審後硬刪、`ORIGINAL_TTL_DAYS` 兜底 |
| Step card | public bucket、content-hash 檔名不可猜、去識別化且無 PII |
| LINE webhook | 簽章必驗；缺憑證即拒絕；`raw body` 驗簽 |
| Admin | bcrypt（constant-time on unknown email）、JWT、密碼變更使舊 token 失效、登入限流、capability-based RBAC（§6.5 / D14）、稽核日誌 |
| API key | hash 儲存、scope、per-key rate limit、可撤銷 |
| 案件查詢 | 編號 + 末四碼、5 次失敗鎖 15 分鐘、短效 token |
| 外送資料清單 | 送 LLM 供應商：市民 SOP 截圖、承辦人 SOP 截圖、罐頭草稿上下文、未命中訊息文字（去 LINE userId）。**不送**：證明文件、申請人個資、案件內容 |
| 生產設定 | `ENV=production` 時 `insecure_defaults()` 硬失敗（沿用）；所有 stateful 服務只綁 127.0.0.1 或 compose 內網 |
| 稽核 | 所有 admin 寫入與所有狀態轉移寫 `audit_logs` / `application_status_events` |

---

## 12. 既有資料搬遷

`apps/api/scripts/migrate_legacy/`：

| 來源 | 目標 | 規則 |
|---|---|---|
| youth-line-bot `contents` | `contents` | key 原名；`content` 與 `draft` 皆搬；缺的 key 由 registry 預設補 |
| `subsidies` | `schemes` | 欄位對應；tier/channel/document_types 由 seed 補「新竹 AI 工具補助」完整設定；其餘方案僅基本資料 |
| `faqs` | `faqs` | 搬後批次算 embedding |
| `knowledge_documents` | `knowledge_documents` | 同上 |
| `media`、rich menu 設定 | `media`（檔案上 MinIO）、`line_rich_menus` | |
| `cases` + `case_status_history` | `applications` + `application_status_events` | 狀態對映表（youth 狀態 → §7 狀態）；手機只存加密 + 末四碼 hash；`case_no` 沿用原 `case_id`；來源標記 `intake_channel=LEGACY` |
| `line_users`、`user_cases` | `line_users`、`case_verifications` | 保留綁定以便推播 |
| **不搬** | `admin_users`、`admin_sessions`、`notifications`、`sync_logs`、`import_runs`、`conversation_states` | 帳號重建；會話重置 |
| SOP_Tutor Postgres | 新 stack Postgres | `pg_dump` → restore → 跑新 alembic migration |
| SOP_Tutor MinIO | 新 stack MinIO | `mc mirror` 兩個 bucket |
| submit-flow `seed.ts` | `scripts/seed.py` | 只取：scheme 完整設定、12 document_types、12 rejection_codes、CHANNEL_DOCS、tools/pendingTools、FAQ；demo 案件 5 筆（各狀態一筆，資料皆為假） |

搬遷腳本冪等、可重跑、輸出報表（inserted/updated/skipped/failed）。

---

## 13. 部署

### 13.1 環境（已勘查）
OracleCloud VM：Ubuntu 24.04、**aarch64**、4 vCPU、23 GB RAM、149 GB 可用；Docker 29.6 + Compose v5.3；主機 nginx 1.24 佔 80/443，Cloudflare origin cert（`/etc/ssl/cloudflare/`）；SOP_Tutor 現以 `docker-compose.prod.yml` 運行（web → 127.0.0.1:8091）；Tailscale 已裝。

### 13.2 映像
- 所有 Dockerfile 以 `--platform` 多架構建置（linux/arm64 + linux/amd64）；基底映像確認皆有 arm64：`pgvector/pgvector:0.8.6-pg17`、`redis:8-alpine`、`quay.io/minio/minio`、`mcr.microsoft.com/playwright/python`、`python:3.12-slim`、`node:24-alpine`、`nginx:alpine`、`otel/opentelemetry-collector-contrib`。
- CI 用 `docker buildx` 推到 GHCR；VM `docker compose pull && up -d`。

### 13.3 Compose（prod）
服務：postgres、redis、minio、renderer、otel-collector、api、worker、admin-web、apply-web。所有 port 只綁 127.0.0.1：api `127.0.0.1:8200`、admin-web `127.0.0.1:8201`、apply-web `127.0.0.1:8202`。與 SOP_Tutor stack 並存（不同 project name、不同 volume、不同 port）直到切換確認。

### 13.4 主機 nginx
| server_name | proxy_pass | 備註 |
|---|---|---|
| `maydru.xamjiang.com` | `127.0.0.1:8202` | apply-web |
| `maydru-admin.xamjiang.com` | `127.0.0.1:8201` | admin-web |
| `maydru-api.xamjiang.com` | `127.0.0.1:8200` | `/line/webhook`、`/v1`、`/api`、`/media`；`proxy_request_buffering off`、`client_max_body_size 20m` |
Cloudflare proxied；origin cert 需涵蓋三個名稱（萬用或重簽）。DNS 與憑證由產品負責人處理。

### 13.5 Secrets
`.env` 只存在 VM（`chmod 600`），不進 git；`.env.example` 列出所有變數名。必要變數：`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`OPENAI_API_KEY`、`SECRET_KEY`、`ORIGINAL_ENCRYPTION_KEY`、`PII_ENCRYPTION_KEY`、`RENDERER_TOKEN`、`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`MINIO_ROOT_*`、`PUBLIC_MEDIA_BASE_URL`、`APPLY_WEB_BASE_URL`、`ADMIN_WEB_BASE_URL`、`CORS_ORIGINS`、`BOOTSTRAP_*`。

### 13.6 切換流程
1. 新 stack 起來、資料搬遷、smoke test（`scripts/e2e_smoke.py`）。
2. LINE Developers 將 webhook URL 改指 `maydru-api.xamjiang.com/line/webhook`。
3. 確認 7 天後停 SOP_Tutor stack 與 `sop*.xamjiang.com` server block。

### 13.7 既有環境注意事項
- VM 上有一個獨立 `redis:8-alpine` 容器綁 `0.0.0.0:6379`（不屬於 SOP_Tutor），對外暴露；建議關閉或改綁 127.0.0.1。

---

## 14. 測試、CI 與品質門檻

| 層 | 工具 | 要求 |
|---|---|---|
| 後端單元/整合 | pytest、aiosqlite、`LLM_PROVIDER=fake`、`NoopLineSender` | 每個 router 與 service 有測試；狀態機每條轉移含拒絕案例；規則引擎四種 rule_type 各有 fixture；LINE handler 每個 action 一測；`vitest.config` 等價：測試永不打真實 LINE / LLM |
| 規則一致性 | 共用 JSON fixtures | Python 與 TS 規則引擎對同一組 fixture 產出相同結果 |
| 前端 | vitest + Testing Library | 送件流程每步、遮罩編輯器確認邏輯、OCR 包裝、狀態頁、審核頁 findings 覆寫 |
| E2E | Playwright（compose 起全套、fake LLM、LINE 模擬器端點 `POST /__test__/line/inbound`） | 劇本：送件 → 承辦人審核 → 退件 → LINE 推播（模擬）→「教我準備」SOP step card → 網頁補件 → 核准 → 推播 |
| 靜態 | ruff、mypy（strict on services/ai）、oxlint、`tsc -b`、import-linter（`services/review`、`routers/apply` 禁 import `ai`） | |
| CI | GitHub Actions：lint → typecheck → pytest → vitest → openapi client 同步檢查 → e2e → buildx（arm64+amd64）→ push GHCR（main） | PR 必過 |
| 驗收 | §16 每個階段的驗收條件對應到具名測試 | |

---

## 15. 設計原則（前端）

以 Apple Human Interface Guidelines 為準則，以大眾使用場景、以人為本：
1. **清晰**：每頁一個主要動作；文字用白話、動詞開頭；數字與日期格式一致。
2. **順從內容**：介面退後，文件與步驟在前；審核頁以文件為主體。
3. **深度**：進度以時間軸呈現；狀態變更有可回溯的事件。
4. **可及性**：色彩對比 ≥ 4.5:1、可放大 200%、鍵盤可操作、螢幕閱讀器標籤、觸控目標 ≥ 44pt。
5. **錯誤設計**：說「怎麼修」與「去哪修」（連到 SOP），不只說「錯了」。
6. **信任**：遮罩、外送 AI、保存期限都在動作發生前明說。
7. **一致**：`packages/ui` 統一 token（色彩、字級、間距、圓角、動效），admin 與 apply 同一套。
8. **行動優先**：apply-web 以手機寬度設計；admin 以桌面為主但可在平板使用。

---

## 16. 實作階段與驗收條件

無時程限制，但依相依性分階段，每階段結束時 CI 全綠。

| 階段 | 內容 | 驗收（可對應測試） |
|---|---|---|
| **P0 骨架** | monorepo、uv/npm workspaces、從 SOP_Tutor 複製 api/renderer/admin-web、compose 開發環境、CI 跑通、`CLAUDE.md` | `docker compose up` 全服務健康；SOP_Tutor 原測試全過；admin 可登入 |
| **P1 資料層** | §6 全部表 + alembic；`services/application.py` 狀態機；`services/scheme.py`；seed.py；migrate_legacy | 狀態機測試全過；seed 後 admin 看得到方案與 5 筆案件；migrate_legacy 對 youth.db 跑出報表 |
| **P2 內容與 LINE** | contents registry 轉譯、content service、LINE webhook/sender/flex/richmenu/handlers（Python）、case_verify 流程、推播、admin LINE 內容區 | 每個 postback action 一測；簽章驗證測試；contents draft/publish/preview；rich menu 同步（Noop）；推播寫入 notifications |
| **P3 送件與審核** | apply-web 6 步、packages/ocr、mask-editor、review-rules（TS）、伺服器規則引擎、admin 案件審核區、補件、purge/expire worker | E2E：送件 → 審核 → 退件 → 補件 → 核准；規則 fixture Python/TS 一致；核准前置條件伺服器強制；purge job 測試 |
| **P4 SOP 串接** | document_type ↔ flow 對照、LINE sop_session（Session API）、idle 圖片 locate、intent 分類 + fallback、apply-web SOP 頁、退件推播雙按鈕 | E2E 加入 SOP 段；intent 低信心走 quick reply；30 分鐘逾時退出 |
| **P5 方案管理與內容助理** | admin 方案管理區（含規則編輯器）、copilot (a)(b)(c)、unmatched_messages | 新增方案不改 code 即可送件；copilot 只寫 draft 並附引用 |
| **P6 `/v1` 與 webhook** | 全部 `/v1` 端點、scopes、rate limit、outbound webhook + 重試、OpenAPI client | 每端點測試；webhook 簽章驗證測試；client 同步檢查 |
| **P7 部署** | 多架構映像、prod compose、nginx conf、VM 部署、資料搬遷、smoke test、切換 webhook | 三個網域可用；e2e_smoke 通過；LINE 真機收發 |
| **P8 打磨** | HIG 審視、可及性檢查、Dashboard、稽核日誌 UI、文件 | axe 無嚴重問題；README 與 deploy 文件完整 |

---

## 17. 工作規則（寫入 CLAUDE.md）

1. 本 SPEC 為唯一規格來源；設計變更先改 SPEC 再改 code，並在 §18 記錄決策。
2. 業務邏輯只在 `services/`；router 不含邏輯；LINE、admin、`/v1` 共用 service。
3. `services/review.py`、`routers/apply.py` 禁止 import `ai/`（import-linter 強制）。
4. 所有給市民的文字走 `contents`；程式碼中不得硬編中文文案（測試以 grep 檢查 `services/line`）。
5. 狀態轉移只能呼叫 `application.transition()`。
6. 每個 PR：測試、typecheck、lint 全綠；新增端點必附測試與 OpenAPI 更新。
7. 測試環境永不連真實 LINE / LLM（`LLM_PROVIDER=fake`、`NoopLineSender`）。
8. Commit 用 Conventional Commits（中文），PR 描述附對應 SPEC 章節。
9. 不在 git 中存任何 secret、真實個資、真實截圖。

---

## 18. 決策紀錄

| # | 決策 | 理由 |
|---|---|---|
| D1 | 統一後端用 Python FastAPI，以 SOP_Tutor 為基底 | LangGraph 投入最深；LINE 邏輯是可搬的規則與資料 |
| D2 | LINE 全罐頭，LLM 只分類/定位 | 政府對外文字須可審核；可預期、可稽核 |
| D3 | 審核不用 LLM，OCR 在瀏覽器 | 敏感資料資安考量；「圖片辨識不離開瀏覽器」 |
| D4 | 申請人匿名送件 + 編號查詢，不做帳號 | 降低門檻；符合台灣線上申辦慣例 |
| D5 | 狀態機取 submit-flow 骨架 + youth-line-bot 補件/撥款欄位 + 新增 EXPIRED | 兩者優點合併 |
| D6 | 方案設定全部資料化 | 單機關多方案、SaaS 化；新增方案不改 code |
| D7 | 所有能力同時是 `/v1` API + outbound webhook | 泛用、可套用到其他場景 |
| D8 | 內容助理只產草稿、附引用 | 擴大處理範圍但保留人審 |
| D9 | 新 stack 用 dump/restore 接手 SOP_Tutor 資料，舊 stack 並存至切換 | 可回退；ARM64 VM 資源足夠 |
| D10 | 通知只用 LINE 推播 | 產品負責人決定；email/簡訊列為未來 |
| D11 | 保存期限 90 天，方案可覆寫 | 產品負責人決定 |
| D12 | 兩個前端同用 Vite/React/Tailwind，共用 packages/ui | 一套工具鏈；申請頁無 SEO 需求 |
| D13 | youth-line-bot 舊狀態對映到 §7：submitted→SUBMITTED、eligibility_review/document_review→UNDER_REVIEW、supplement_required→NEEDS_REVISION、review_completed/approved→APPROVED（payment_status 為 pending/processing 時落 DISBURSING）、rejected→REJECTED、paid→DISBURSED；舊 8 位數 `case_id` 原樣沿用為 `case_no`，`intake_channel=LEGACY`，補件項目字串轉成 `rejection_code=OTHER` 的結構列 | 舊系統的階段比 §7 細，合併到同一組狀態才有單一狀態機；案號沿用讓民眾手上的截圖還查得到 |
| D14 | 角色改為 viewer / sop_editor / sop_reviewer / case_reviewer / case_supervisor / admin / owner，授權以 capability（sop_edit、sop_review、case_review、case_supervise、admin、owner）為準而非角色排名；舊 editor→sop_editor、reviewer→sop_reviewer | SOP 製作與案件審核是兩條互不隸屬的線，用排名授權會讓案件覆核者順手拿到 SOP 編輯權 |
| D15 | 測試用 aiosqlite in-memory；新表的清單欄位一律 JSON 而非 ARRAY；事件不可變同時以 Postgres trigger 與 SQLAlchemy event listener 落實 | 測試不需要真的資料庫也能涵蓋整個 schema；同一條不變式在兩種引擎上都成立 |
| D16 | 案件編號 `HC-YYYY-NNNNNN`，流水號依 tenant 與年度各自累加（`case_no_counters` 一列一年，Postgres 取號時列鎖）；舊系統的 8 位數編號照舊 | 對民眾好唸、對承辦好查；跨年度自動歸零，跨機關不互相干擾 |
| D17 | 查詢的第二因子是手機或身分證**末四碼**（不是完整號碼）；連續 5 次失敗鎖 15 分鐘，案號與來源 IP 各自計數；查無此案與末四碼錯誤的回應完全一致 | 末四碼即可驗證又不必再傳一次完整個資；雙軸計數同時擋單案猜測與整批掃號；回應一致才不會讓錯誤訊息變成查詢介面 |
| D18 | P3 的實作決策：(a) 文件物件 key 為 `applications/{tenant}/{case_no}/{doc_type}/{revision}.{ext}`，預覽圖同目錄下的 `{revision}-preview.jpg`；(b) 同一份文件有多筆 OCR 時，承辦人重新辨識的結果（`source=reviewer`）勝過申請人上傳的，同來源取最新；(c) 規則引擎的 `note` 回**文案 key**（`review.note.*`）而不是句子，字由 contents 層渲染；(d) `/api/apply/*` 的錯誤 body 是扁平的 `{code, …}`，不包在 `detail` 裡；(e) 匿名流量歸屬 `slug="default"` 的 tenant，沒有就取建立時間最早的那一個；(f) 補件送出後系統立刻接著跑 T5，`REVISION_SUBMITTED` 是過場狀態；(g) `review_rules.config.tolerance_pct` 是百分比（`5` = 5%），Python 與 TS 兩版一致；(h) OpenAPI 提交為 `apps/api/openapi.json` 快照，CI 以它做 client 同步檢查 | (a) 案號本身就是命名空間，整案稽核與刪除只要一個前綴；(b) 申請人送上來的 OCR 依 §11 不可信，承辦人看著原圖跑出來的才算數；(c) 給市民的文字一律走 contents（§17.4），service 不得硬編中文；(d) 契約寫的就是扁平 body，多一層 `detail` 會讓前端每個錯誤都要解兩次；(e) 用網域或 header 判斷等於讓「送到哪個機關」變成可偽造的輸入；(f) 與建案後立刻跑 T1 對稱，補件完就該回到同一個審查佇列；(g) 兩版共用 fixtures，單位不同會讓同一筆設定在兩邊得到不同判定；(h) schema 一動前端型別就得動，快照讓契約變更在 PR 裡看得見
| D19 | 內容服務叫 `services/contents.py`（複數）；`services/content.py` 是 SOP_Tutor 沿用的流程快照服務，兩者無關 | 名字撞了但責任完全不同，改名舊模組會動到 SOP 那一整條線；複數也剛好對上資料表 `contents` |
| D20 | youth-line-bot 的六題資格問卷（`eligibility` 精靈）不移植，「申請小幫手」改為先問使用的銀行／平台；選定後列出該平台所有已發布 SOP，亦可直接上傳截圖定位 | 資格判斷已經資料化在 `schemes`（D6），問卷只是把同一組條件再問一次；民眾通常先知道自己使用哪一家銀行，再從該平台的完整教學清單選擇要取得的資料 |
| D21 | 12 個狀態在 LINE 上壓成 5 個公開階段（送出 → 審核 → 核定 → 撥款 → 完成）；補件、逾期、不通過不另開階段，而是把所在階段標成「卡住」 | 民眾要知道的是「卡在哪一關、我要做什麼」，不是機關內部有幾種狀態；階段數固定，之後新增狀態也不必重畫時間軸 |
| D22 | 沒有人綁定 LINE 的案件仍然留一列 `notifications`，狀態 `skipped`、`error=no_linked_line_user` | 留白會讓後台誤以為通知都送到了；`queued` 則是在說謊——沒有收件人，它永遠不會被送出 |
| D23 | `sop.template.*` 的預設值保留 Python `str.format` 的單大括號 `{placeholder}`，不改成 `{{var}}`，`variables` 一律留空 | 那些句子由 `services/policy.py` 以 `.format()` 代入；改寫語法等於要動 SOP 引擎，而承辦人在後台看到的仍然是同一段字 |
| D24 | 「程式碼中不得硬編中文」的檢查以 AST 檢查**字串常數**，排除 docstring 與 `log.*()` 的訊息 | 規則要擋的是民眾會看到的文字；註解與日誌用團隊的語言寫，值班的人才不必先翻譯再除錯。grep 分不出這件事，AST 分得出來 |
| D25 | LINE channel 是後端的一個模組（`services/line/` + `routers/line.py`），不是獨立服務；訊息在程式內一律是 LINE 的 JSON dict，只有真的要送出去時才轉成 SDK 型別 | 罐頭訊息、案件狀態、方案設定都在同一個程序裡，拆出去只會多一層 API 與一份不同步的設定；dict 讓 builder 不必認識 SDK，測試也能直接斷言 |
| D26 | 「第一個管理者」的閘門是「任何 tenant 裡都沒有 `is_active` 的 owner」，不是「一個 tenant 都沒有」；`bootstrap-status`、`POST /api/auth/bootstrap` 與`_bootstrap_from_env()` 三處同一條判斷。tenant 已經存在時把 owner 掛上去，不另開機關 | `scripts/seed.py` 會先把機關與方案灌進去，所以「有 tenant、零使用者」是安裝流程裡真的會出現的狀態；用 tenant 數量當閘門會讓那台機器自稱已初始化——端點關著、沒有帳號，誰都進不去，而且沒有補救的路 |
| D27 | `services/faq.py` 一個模組三個呼叫面：評分（`score`/`search`/`best`，LINE 聽懂一句話時用）、瀏覽（`browse`/`matches`，`/api/apply/faqs` 的清單）、CRUD（後台維護）。P3 原本叫 `search` 的瀏覽函式改名 `browse`，`search` 讓給帶分數的那一支 | 同一張表不該有兩個模組；兩邊的語意也真的不同——市民是在「翻」FAQ，翻到就該看得到，門檻與分數只對「bot 要不要主動回答」有意義。`search` 留給評分那一支，是因為 P4 的向量檢索要換的是它，接縫寫在一個名字上比較好找 |
| D28 | `/v1/sop/*` 是 SOP 對外契約的正式前綴；原本的 `/v1/chat`、`/v1/sessions`、`/v1/catalog`、`/v1/locate` 等平路徑保留一版別名，而且兩種拼法直接掛到同一個 endpoint 函式 | 既有 SOP_Tutor 整合不用立即停機改網址，新整合又有一致的命名；共用函式與測試能防止兩套契約漂移 |
| D29 | FAQ service 不直接 import `app.ai`；語意向量由呼叫端以 `Embedder` 注入，Postgres + pgvector 可用時走餘弦檢索，缺向量、SQLite 或查詢失敗時自動退回既有關鍵字評分 | `routers/apply.py` 經 FAQ service 的相依鏈仍符合「證明文件路徑不得碰 AI」的 import-linter 紅線；向量索引尚未補齊時服務也不會中斷 |
| D30 | 內容助理的模型輸出拆成「句子 + 引用索引」，service 組成草稿時把無有效引用的句子標為「待查證」；FAQ 建議另存 `copilot_suggestions`，接受後才建立停用中的 FAQ | 模型不能把沒有根據的句子包裝成已核准內容；暫存建議讓承辦人可接受或忽略，且不會直接污染正式 FAQ |
| D31 | 方案管理的六種子設定共用 CRUD／排序端點與前端 tab 骨架；規則編輯器先用 TS 引擎即時試算，再提供伺服器試算比對 | 新增方案與調整規則保持資料驅動；兩版規則引擎若走樣，承辦人在設定當下就看得出差異 |
| D32 | `/v1` API key 正式使用 `Authorization: Bearer <key>`；`X-API-Key` 保留相容。每把 key 明列 scopes，`admin` 可通過所有 scope gate | 符合標準 Bearer 整合方式，同時不讓既有 SOP 呼叫立即中斷；路由宣告所需能力而不是自行判斷 key 名稱 |
| D33 | outbound webhook 以 `webhook_deliveries` 作 transactional outbox；領域 service 只在同一交易建立 delivery，worker 每分鐘補排 pending，單筆工作以 arq 最多重試五次 | 案件成功但 Redis 短暫失效時事件不會消失；HTTP 失敗不回滾業務交易，重送與稽核都以同一 delivery id 為準 |
| D34 | `packages/api-client/src/schema.d.ts` 是 OpenAPI 的可重現生成物並提交進 git；CI 重新生成後用 `git diff --exit-code` 驗證 | PR 可以直接審契約差異，前端不必在安裝時啟動 API；漏更新 schema 會在 CI 立即失敗 |
| D35 | P8 的可及性門檻以 axe 的 WCAG A/AA serious/critical violations 為自動化 gate；顏色對比另由 token 設計與人工檢視負責（jsdom 無法計算實際樣式）。稽核 UI 只讀 `audit_logs.diff`，不展開案件與文件 | 自動測試抓得到名稱、語意、結構等嚴重退步，又不製造 jsdom canvas 的假訊號；稽核畫面不成為第二份個資資料庫 |
| D36 | 將既有 ProReview 能力在後台收斂為「審查作業」導覽：案件總覽與實際審核沿用單一案件／finding 資料；另提供獨立「資料重點設定」入口，但仍直接編輯方案的 `review_rules`，不建立第二份規則 | 承辦人能按工作流程找到設定與審核，不必先知道規則藏在方案管理；共用同一份 API、規則引擎與稽核紀錄可避免設定漂移 |
| D37 | LINE rich menu 保留新 action 名稱並相容舊 youth-line-bot 的 `subsidy_info`、`eligibility` postback；後台版面直接預覽目前圖檔，沒有客製圖時顯示內建美術稿 | LINE 上已發布的舊選單不應因後端整合改名而失效；看得到實際圖檔才能讓承辦人確認預設圖片與點擊熱區一致 |
| D38 | LINE 選定一條 SOP 後，以 Flex carousel 一次傳送全部步驟圖片，不再要求逐步按「下一步」；保留卡住截圖、換流程與結束 | 民眾可一次掌握完整操作並自行回看；carousel 能在 LINE 單次回覆上限內承載多張步驟卡 |
| D39 | LINE 平台只有一條已發布 SOP 時直接進入完整教學；兩條以上才顯示操作指引清單 | 避免只有唯一答案時多問一題，縮短民眾取得教學的路徑 |
| D40 | 推翻原本「不存完整身分證字號」的規定：改為**加密**保存完整身分證字號（Fernet，與完整手機同一把 `PII_ENCRYPTION_KEY`），末四碼 hash 仍保留供查詢驗證。解密受 `application.read_pii` 能力控管，每次解密寫稽核日誌；列表與一般案件頁一律只顯示末四碼 | 補助核銷要造冊報府，承辦人手上必須有完整字號，否則得另外用紙本或 email 收一次——那比放在系統裡更不安全。加密而非明文、能力控管而非全員可見、解密留痕，是在「承辦真的需要」與「不製造一份裸的個資表」之間的折衷 |
| D41 | apply-web 將已發布 SOP 嵌入上傳步驟的文件卡，以 modal 在原地逐步播放；單一對應流程直接開始，多個流程才選平台，最後一步回到該文件上傳。獨立 `/sop` 頁保留完整瀏覽與截圖定位 | 使用者真正需要幫助的時刻是在某份文件前卡住。把教學貼著任務呈現可保留已填資料與注意力，也符合 §15 的順從內容、行動優先與「需要時才出現」；獨立頁則承接較進階的定位需求 |
| D42 | 黑客松 Demo 缺件通知不改案件狀態，只對 `case_verifications` 已綁定用戶建立 `notifications(kind=demo_missing_document)`；信用卡紀錄按鈕沿用 document type → published flow 對照開完整 SOP。Feedback 僅存 user id hash、情境與可選案件關聯。前端 OCR FAIL 是可忽略提示，伺服器規則與人工審核仍為最終判定 | Demo 能重複演示而不污染不可變狀態時間軸；沿用真實通知、SOP 與規則資料可避免做一條只在舞台上有效的假流程；回饋資料遵守最小化，OCR 不準時也不會把使用者鎖死 |
| D43 | 申請端遮罩畫布沿用 SOP 標註器的直接拖曳框選模式：圖片空白處拖曳建立、整框拖動、四角縮放與 Delete 刪除；圖片一律適配並可放大到編輯區。Tailwind 入口須明列掃描 `packages/mask-editor/src` | 讓市民端與後台 SOP 使用同一套操作心智；避免小尺寸截圖縮在大畫布中央，也避免 workspace 元件的定位／雙欄 utility 未被正式版 CSS 產生而造成跑版 |
| D44 | 保留舊制 Demo 案號 `20260001`（手機 `0912345678`）作為 LINE 綁定與主動通知展示資料；案件手機驗證同時接受完整臺灣手機、`+886`／分隔符格式與末四碼，最後一律正規化成末四碼比對 | 罐頭訊息本來就示範完整手機，狀態機卻只收四碼會讓 Demo 必然失敗；保留兩種輸入兼顧文案直覺與快速查詢，實際比對仍只使用加鹽 hash，不新增明文個資暴露 |
| D45 | apply-web 提供獨立 `/demo` 一頁式「卡好審」產品介紹，Demo 導覽、文案、頁尾與瀏覽器標題統一使用此名稱，不改動正式申請平台其他頁面品牌；版面採手機優先與白色簡約設計；資料去敏以無銀行識別的測試信用卡沿用正式遮罩編輯器，預設遮蔽前 12 碼與到期日期而完整露出末四碼；SOP 展示與聊天選單讀取公開 API 中國泰世華已發布流程；文件標注以真實收據的審核必要區域展示（不發布含 Email、地址的完整頁面）並明確採審核人員視角；LINE 區塊使用實際 Bot 對話與圖文選單截圖；SOP API 離線時明示為離線展示內容 | 評審可在單一網址理解並實際操作四項能力；獨立 Demo 品牌不影響既有申請流程；信用卡範例兼顧遮罩互動與品牌中立，真實 LINE 畫面提高展示可信度；真實文件標注能具體呈現加速承辦與審核核對的價值，裁切公開素材則兼顧示範真實性與個資最小化；重用正式資料與遮罩元件避免舞台 Demo 和產品走出兩套行為，離線備援則避免環境尚未啟動時整頁失效或把靜態圖誤稱為資料庫內容 |

---

### D37：承辦工作區與多期申請對應（2026-09-20）

後台依工作分為申請審查、扣款記錄 SOP、LINE 帳號與系統管理。申請審查提供文件總覽，右側顯示申請資料、核對結果與決策；文件可展開辨識與歷史版本，本次補件依最後一次補件事件標示。FAQ 採右側上層抽屜編輯。

AI 工具知識庫直接管理各方案既有的工具清單、別名、待審及阻擋狀態。申請人自行填寫的名稱在資格查詢與送件時分別累計，選單選取不計入；核可與阻擋會反映於申請端，伺服器亦驗證工具狀態。

申請主檔保留月／年費、期數與原幣金額。逐期文件以文件類型與期數共同識別，版本、儲存路徑、OCR 與補件各自對應該期，避免多期覆蓋。既有案件視為單期。多期金額仍需承辦核對所有憑證後人工判定，不能用單張帳單代表整案；核准須通過既有狀態機與缺件檢查。參考畫面中未在申請表蒐集的生日、地址不虛構顯示。
### D38：申請文件助手與消耗控制

匿名 `POST /api/apply/help-chat` 僅檢索同機關、目前方案或共用且啟用的 FAQ，回傳維護者核准的原文；不使用生成模型、不接受角色／系統提示、不存問句、不讀案件文件，因此沒有模型費用，也沒有讓輸入取得指令權限的路徑。未命中時引導洽詢承辦人。`GET/PUT /api/admin/help-chat` 提供機器人開關、每 IP 每分鐘／每日及機關每日上限、問題長度與回覆筆數；寫入限管理者、具版本衝突檢查與稽核。Redis 原子計數在查詢前預留額度，故障時停止服務；固定視窗以 UTC 計日，IP 雜湊且不信任請求自帶的轉送標頭。反向代理須設定可信來源，避免使用者偽造 IP。回覆純文字呈現，不執行輸入指令或外部連結。


## 19. 未決事項（不阻塞開工）

| # | 事項 | 負責 |
|---|---|---|
| O1 | 三個 `maydru*.xamjiang.com` DNS 與 origin cert | 產品負責人 |
| O2 | 新 LINE channel 或沿用 youth-line-bot channel 憑證 | 產品負責人（切換時決定） |
| O3 | VM 上暴露的獨立 redis 容器處置 | 產品負責人 |
| O4 | 使用條款文字（SOP 截圖外送 AI 的揭露） | 產品負責人 |
| O5 | 第二個方案上線時驗證「不改 code」承諾 | 開發 |
