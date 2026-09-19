# HANDOFF — MayDru 交接文件

寫給接手的開發者（GPT Codex）。日期 2026-09-19。
**先讀這份，再讀 [`CLAUDE.md`](CLAUDE.md)（工作規則）與 [`SPEC.md`](SPEC.md)（唯一規格來源，§16 是階段表、§18 是決策紀錄 D1–D27）。**

---

## 0. 一分鐘現況

| 階段（SPEC §16） | 狀態 |
|---|---|
| P0 骨架 | ✅ 已完成並合併 |
| P1 資料層 | ✅ 已完成並合併 |
| P2 內容與 LINE | ✅ 已完成並合併 |
| P3 送件與審核 | ✅ 已完成並合併（前後端都有，含實機 smoke） |
| **P4 SOP 串接** | 🔶 **後端骨幹已提交（`8a8582b`），測試檔未提交，前端與 e2e 未做** |
| **P5 方案管理與內容助理** | 🔶 **後端已提交在獨立 branch，前端已寫但未提交、未驗證** |
| P6 `/v1` 與 webhook | ⬜ 未開始 |
| P7 部署 | ⬜ 未開始 |
| P8 打磨 | ⬜ 未開始 |

目前測試數（`main` 含未提交的 P4 工作）：**後端 1130 passed / 1 failed**（唯一失敗是 OpenAPI 快照過期，重新產生即可），前端 288 passed。

---

## 1. 環境與指令

工具鏈：Python 3.12 + [uv](https://docs.astral.sh/uv/) workspace、Node 24 + npm workspaces、Docker + Compose。

```bash
export PATH="$HOME/Library/Python/3.12/bin:$PATH"   # uv 裝在這裡（pip install --user uv）
uv sync                                             # 根目錄，建出單一 .venv
npm install                                         # 根目錄
```

品質門檻（**每次提交前四個都要綠**）：

```bash
cd apps/api && uv run --package maydru-api pytest -q -p no:warnings
```
```bash
uv run ruff check && uv run mypy && uv run lint-imports --config pyproject.toml
```
```bash
npm run typecheck && npm run lint && npm test && npm run build
```

OpenAPI 快照（新增或改動端點後必跑，並提交 `apps/api/openapi.json`）：

```bash
cd apps/api && UPDATE_OPENAPI=1 uv run --package maydru-api pytest tests/test_openapi_snapshot.py -q
```

本機全套（連接埠刻意與舊的 SOP_Tutor stack 錯開）：

```bash
docker compose up -d --build
```
api `127.0.0.1:8200`、admin-web `8201`、apply-web `8202`、renderer `8101`、postgres `5433`、redis `6380`、minio `9002/9003`。`docker compose down` 保留 volume。

只跑資料面、後端在本機跑：

```bash
docker compose up -d postgres redis minio renderer
```
然後在 `apps/api/` 下 `uv run --package maydru-api alembic upgrade head`、`… uvicorn app.main:app --reload`、`… arq app.worker.main.WorkerSettings`；前端 `npm run dev:admin`（5173）/ `npm run dev:apply`（5174）。

`LLM_PROVIDER=fake` 與 `LINE_SENDER=noop` 可完全離線跑通，測試環境永不連真實 LINE / LLM。`.env` 已存在於本機、已被 gitignore、永不提交。

---

## 2. 立刻要做的三件事（接手第一步）

### 2.1 保住 P5 的未提交前端（**最優先，有遺失風險**）

P5 的後端已經提交在 branch `worktree-agent-a9dac84b8568275d8`，但**前端檔案只存在於一個 git worktree 的工作目錄裡，尚未提交**，而那個目錄位在未被追蹤的 `.claude/` 底下：

```
/Users/sam/Documents/MyProject/mixProject/MayDru/.claude/worktrees/agent-a9dac84b8568275d8
```

未提交的內容：

| 檔案 | 說明 |
|---|---|
| `apps/admin-web/src/pages/schemes/` | 新目錄，10 個檔案：`SchemesPage.tsx`、`SchemeEditorPage.tsx`、`ChildTab.tsx`、`RulesTab.tsx`（審核規則編輯器）、`ToolsTab.tsx`、`CopilotPanel.tsx`、`fields.tsx`、`queries.ts`、`types.ts`、`schemes.test.tsx` |
| `apps/admin-web/src/pages/line/SuggestionCards.tsx` | 新檔，內容助理 (b) 的 FAQ 建議卡 |
| `apps/admin-web/src/pages/line/UnmatchedPage.tsx` | 改動，加上「產生 FAQ 建議」 |
| `apps/admin-web/src/{App.tsx,layout/AppShell.tsx}` | 改動，加上「方案管理」導航與路由 |
| `apps/api/app/routers/admin/{schemas,schemes}.py` | 小改動（15 行） |

**第一個動作**：進到那個 worktree，跑一次前端測試，然後提交。

```bash
cd /Users/sam/Documents/MyProject/mixProject/MayDru/.claude/worktrees/agent-a9dac84b8568275d8
npm install && npm run typecheck && npm run lint && npm test && npm run build
git add apps/admin-web apps/api && git commit -m "feat(admin-web): 方案管理區與內容助理面板（SPEC §8.2 / §8.6）"
```

若不想用 worktree，也可以直接在主目錄 `git checkout worktree-agent-a9dac84b8568275d8`，但**未提交的檔案不會跟著過去**（它們在 worktree 的工作目錄裡），所以請務必先在 worktree 內提交。

### 2.2 提交 P4 未提交的測試與修正

`main` 的工作目錄有 P4 未提交的內容（測試全綠，只差 OpenAPI 快照）：

```
已改：apps/api/app/ai/retrieval.py, app/ai/session_graph.py, app/deps.py,
      app/services/line/sop.py, tests/conftest.py
新增：apps/api/tests/{sop_helpers.py, test_sop_api.py, test_sop_links.py,
      test_intent_classify.py, test_faq_search.py, test_line_sop_session.py}   （共 1512 行）
```

跑一次測試確認，重新產生 OpenAPI 快照，然後提交。

### 2.3 合併 P5 branch 回 main

P5 branch 從 `82b9825` 分出，main 已經前進到 `8a8582b`（P4 骨幹）。兩邊都碰的檔案（預期會衝突，**保留雙方功能**）：

`apps/api/app/main.py`、`app/routers/admin/__init__.py`、`app/ai/{fake,prompts,schemas}.py`、`app/content_registry/definitions.py`、`app/services/{contents,review,scheme}.py`、`app/routers/admin/{schemas,schemes}.py`、`apps/admin-web/src/{App.tsx,layout/AppShell.tsx}`、`apps/api/openapi.json`（衝突就重新產生，別手動合）。

合併後跑完整四道門檻，並重新產生 OpenAPI 快照。

---

## 3. 剩餘任務

### P4 SOP 串接（**未完成**，SPEC §8.4 / §8.5 / §9.1 / §9.2 / §9.7）

**已經做好的（`8a8582b` + 未提交測試）**：
- `app/services/sop_links.py`：`document_type ↔ flow` 對照解析；`app/routers/admin/sop_flows.py`：後台 CRUD 端點。
- `app/routers/sop.py`（`/api/sop/*`，匿名 + 限流）與 `app/services/sop_public.py`；`public_api.py` 對應的 `/v1/sop/*`。
- `app/services/line/sop.py`：LINE `sop_session` 生命週期（開始、下一步、我卡住了、換流程、結束、逾時）。
- `app/ai/intent.py::classify()`：LLM 意圖分類 + 規則 fallback + quick reply；`services/faq.py` 向量檢索（pgvector，非 Postgres 時退回關鍵字）；`scripts/embed_faqs.py`。
- `services/policy.py` 改讀 contents 的 `sop.template.*`；`app/ratelimit.py`。

**還沒做的**：
1. **apply-web 的 `/sop` 與 `/sop/:flow`** — 目前 `apps/apply-web/src/pages/SopPage.tsx` 還是 P3 留下的佔位頁（`grep "api/sop" apps/apply-web/src` 沒有任何結果）。要做：選文件類型／平台 → 列出 flow → step card 逐步瀏覽（上一步/下一步、步驟編號、放大）；「我卡住了」→ 上傳截圖 → `@maydru/mask-editor`（可略過）→ 顯示 contents 的 `security.screenshot_notice` → `POST /api/sop/locate` → 跳到定位到的步驟或顯示引導。頁面要讀網址上的 `?document_type=CODE`（P3 的「教我怎麼取得」連結已經帶好了）。`/status/:case_no` 的退件說明也要連到解析出來的 flow。
2. **admin-web「文件類型對照」頁** — SOP 導航群組下，方案 × 文件類型的表格，每列可選該平台已發布的 flow（打 `GET/PUT /api/admin/schemes/{code}/document-types/{dt_code}/sop-flows`）。
3. **`apps/api/scripts/e2e_maydru.py`** — SPEC §14 的完整劇本：送件 → 承辦審核 → 退件 → LINE 推播（Noop 捕捉）→「教我準備」開 SOP session → step card → 網頁補件 → 核准 → 推播。用 `/__test__/line/inbound` 這個測試端點驅動 LINE 側（只在非 production 且 `LINE_SENDER=noop` 時開放）。跑起來要印 `ALL OK`。
4. **CI 的 `e2e` job**（`.github/workflows/ci.yml` 目前是 stub）。
5. SPEC §18 補 D28、D29（P4 的實作決策），README 補 SOP 章節，重新產生 OpenAPI 快照。

### P5 方案管理與內容助理（**後端完成、前端待驗證**，SPEC §8.2 / §8.6 / §9.6）

**已提交（branch `worktree-agent-a9dac84b8568275d8` 的 `3df7619`）**：`app/ai/copilot.py`、`app/services/copilot.py`、`app/routers/admin/copilot.py`（內容助理 a/b/c）、方案管理後端（排序、待審工具 resolve、規則試算）、alembic `0015_copilot_suggestions`、三個測試檔（`test_copilot.py`、`test_scheme_admin_p5.py`、`test_new_scheme_acceptance.py`，含「新增方案不改 code 即可送件」驗收測試）。

**待辦**：§2.1 的前端提交與驗證、§2.3 的合併、SPEC §18 補 D30+。

### P6 `/v1` 與 outbound webhook（SPEC §10）

- 補齊 SPEC §10.1 表列的所有 `/v1` 端點（Schemes / Applications / Review / SOP / Contents / FAQ / Intent / Notifications / Webhooks）；API key scopes `read, apply, review, sop, contents, webhooks, admin`；per-key 限流（`deps.py` 已有雛形）。
- `webhook_subscriptions` / `webhook_deliveries` 資料表在 P1 就建好了，還沒有服務與端點。要做：事件 `application.status_changed`、`application.created`、`application.document_uploaded`、`review.findings_updated`、`sop.session_completed`、`content.published`；格式 `{id, event, occurred_at, tenant_id, data}`、標頭 `X-MayDru-Signature: sha256=HMAC(secret, body)` 與 `X-MayDru-Delivery`；指數退避重試 5 次，可查可重送（arq worker）。
- `packages/api-client` 目前只有 fetch 包裝與產生腳本，要真的從 `apps/api/openapi.json` 產出型別並讓 CI 檢查同步。

### P7 部署（SPEC §13）

`docker/`、`docker-compose.prod.yml`、`deploy/nginx/maydru.conf`、`deploy/vm-setup.md` 在 P0 就寫好了，**但從未在真的 VM 上跑過**。要做：多架構映像（buildx arm64+amd64 推 GHCR）、VM 部署、資料搬遷（`scripts/migrate_legacy/`、SOP_Tutor 的 `pg_dump`/`mc mirror`）、smoke test、把 LINE webhook URL 切過去。§19 的 O1–O4（DNS、憑證、LINE channel 憑證、使用條款）要產品負責人先處理。

### P8 打磨（SPEC §15）

HIG 審視、axe 可及性檢查、Dashboard、稽核日誌 UI、文件。已知的具體項目：apply-web 成功頁的 LINE QR 還是虛線佔位（需要 QR 函式庫或伺服器產圖，且 `VITE_LINE_OA_ID` 尚未設定，目前該區塊預設隱藏）、相機拍攝用的是 `<input capture>` 而非舊專案的裁切框 modal、多頁 PDF 逐頁遮罩的體驗待順。

---

## 4. 不可違反的規則

來自 SPEC §9（紅線）、§11（安全與隱私）、§17（工作規則）。**這些有自動化檢查在守，別繞過**：

1. **LLM 永不生成直接給市民的文字**。LLM 只做意圖分類（`ai/intent.py`）與截圖定位（`ai/retrieval.py`）。例外只有 `/v1/sop/chat`（外部頻道與 Playground），LINE 不接。
2. **申請證明文件永不進任何 LLM**。`services/review.py` 與 `routers/apply.py` 禁止 import `app.ai` — `lint-imports` 會擋下來。
3. **市民截圖只在記憶體處理，不落地**。有測試斷言 locate 流程沒有呼叫任何 MinIO 寫入。
4. **所有給市民的文字走 `contents`**。`services/line/` 裡不得出現中文字串常數 — 有一個 AST 檢查（排除 docstring 與 log 訊息，見 D24）。服務層回傳的是 key（例如 `review.note.*`、`status.{STATUS}.next_action`），由 contents 層渲染。
5. **狀態轉移只能呼叫 `services/application.py::transition()`**；`application_status_events` 不可 UPDATE/DELETE（Postgres trigger + SQLAlchemy listener 雙保險）。
6. **內容助理只寫 `draft`，不寫 `content`**（發布是人的動作），有測試守。
7. 手機與身分證只存末四碼 hash（加密的完整手機另存，供推播綁定）；承辦人原圖 Fernet 加密、審後硬刪。
8. 不在 git 中存任何 secret、真實個資、真實截圖。

Commit 用 Conventional Commits、中文摘要，scope 例如 `api`、`line`、`review`、`apply-web`、`admin-web`、`worker`、`docker`。

---

## 5. 已知陷阱

| 項目 | 說明 |
|---|---|
| **OpenAPI 快照** | 改動任何端點後 `tests/test_openapi_snapshot.py` 就會紅。用 `UPDATE_OPENAPI=1` 重新產生並提交 `apps/api/openapi.json`。目前 `main` 就是紅的，因為 P4 加了端點。 |
| **`/api/admin/schemes/{code}/settings` 路由順序** | 必須註冊在 `/{code}/{kind}` 之前，否則 `settings` 會被當成子資源名稱。有測試釘住。 |
| **seed 出來的 demo 案件查不到** | `scripts/seed.py` 寫入的 `HC-2026-9000xx` 末四碼 hash 綁在當時的 `SECRET_KEY`；換了 key 就驗不過。文件物件 key 也指向 MinIO 裡不存在的物件，後台檢視器會 404、顯示「第 0 版」。這是 seed 資料的預期行為，不是 bug。 |
| **第一個管理者** | `scripts/seed.py` 會先建 tenant。閘門已改成「有沒有 active owner」（D26），所以 seed 之後仍可用 `POST /api/auth/bootstrap` 或 `BOOTSTRAP_OWNER_*` 環境變數建立第一個 owner。 |
| **Tailwind 掃不到 `packages/ui`** | 它是 workspace symlink，兩個前端的 `index.css` 都加了 `@source "../../../packages/ui/src"`；新增共用元件時若樣式沒生效，先檢查這行。 |
| **`<dialog>` 置中** | Tailwind preflight 會把 UA 的 `margin:auto` 歸零，所以 `packages/ui/src/Modal.tsx` 自己用 `fixed inset-0 m-auto h-fit` 置中。別改回依賴預設值。 |
| **vitest 的 jsdom 蓋掉 `FormData`/`Blob`/`File`** | `apps/apply-web/src/test/setup.ts` 把 Node 的版本還原，否則 multipart 測試會靜默走錯路徑。 |
| **兩個 `content` 模組** | `services/content.py` 是 SOP 流程快照（SOP_Tutor 沿用），`services/contents.py` 才是罐頭訊息（D19）。別搞混。 |
| **補件後的狀態** | 補件送出後伺服器立刻接著跑 T5，回傳的是 `UNDER_REVIEW`，`REVISION_SUBMITTED` 是過場狀態（D18f）。 |
| **`tolerance_pct` 是百分比** | `5` 代表 5%，Python 與 TS 兩版一致（D18g）。 |
| **規則引擎雙版一致性** | `packages/review-rules/fixtures/*.json` 共 21 個案例是 Python 與 TS 的一致性契約，兩邊都跑同一組。改引擎行為時兩邊要同步，fixture 是仲裁者。 |

---

## 6. 參考資料

| 檔案 | 內容 |
|---|---|
| [`SPEC.md`](SPEC.md) | 唯一規格來源。§6 資料表、§7 狀態機、§8 功能規格、§9 Agent 規格與紅線、§10 API 契約、§11 安全隱私、§16 階段表、§18 決策 D1–D27 |
| [`CLAUDE.md`](CLAUDE.md) | 工作規則、結構、開發指令、風格慣例 |
| [`README.md`](README.md) | 專案概觀與快速上手 |
| `docs/legacy/inventory-sop-tutor.md` | 舊專案 SOP_Tutor 的完整盤點（models、routers、services、ai 管線、docker）— 本專案的後端基底 |
| `docs/legacy/inventory-youth-line-bot.md` | 舊專案 youth-line-bot 盤點（webhook、postback action 表、119 個罐頭訊息 key、SQLite schema、意圖分類）— P2 的移植來源 |
| `docs/legacy/inventory-submit-flow-proreview.md` | 舊專案 submit-flow / proreview 盤點（六步送件、遮罩編輯器、狀態機、12 種文件類型與退件碼、規則判定邏輯、審核頁互動）— P3 的移植來源 |
| `docs/legacy/api-contract-p3.md` | P3 前後端之間的 API 契約（實作時有數處微調，以 `apps/api/openapi.json` 為準） |
| `docs/legacy/decisions-p1-source.md` | P1 開工前的決策草稿（正式版在 SPEC §18 的 D13–D17） |

舊專案的原始碼仍在 `/Users/sam/Documents/MyProject/mixProject/` 底下的 `SOP_Tutor`、`youth-line-bot`、`proreview`、`submit-flow`，**唯讀參考，不要修改**。

---

## 7. Git 現況速查

```
main            8a8582b  feat(api): SOP 串接的後端骨幹        ← 有未提交的 P4 測試
branch          3df7619  feat(api): 方案管理…與內容助理        ← worktree-agent-a9dac84b8568275d8
                         worktree 目錄內另有未提交的 P5 前端
```

從 `3aff953`（只有 SPEC）到現在共約 40 個 commit。沒有任何 commit 被 push 過，遠端尚未設定。
