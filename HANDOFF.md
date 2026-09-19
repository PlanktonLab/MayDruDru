# HANDOFF — MayDru 交接文件

寫給接手的開發者（GPT Codex）。日期 2026-09-19。
**先讀這份，再讀 [`CLAUDE.md`](CLAUDE.md)（工作規則）與 [`SPEC.md`](SPEC.md)（唯一規格來源，§16 是階段表、§18 是決策紀錄 D1–D34）。**

---

## 0. 一分鐘現況

| 階段（SPEC §16） | 狀態 |
|---|---|
| P0 骨架 | ✅ 已完成並合併 |
| P1 資料層 | ✅ 已完成並合併 |
| P2 內容與 LINE | ✅ 已完成並合併 |
| P3 送件與審核 | ✅ 已完成並合併（前後端都有，含實機 smoke） |
| **P4 SOP 串接** | ✅ 已完成並合併（含 apply-web 教學／遮罩定位、admin 對照、完整 E2E 與 CI） |
| **P5 方案管理與內容助理** | ✅ 已完成並合併（merge `83a13b9`） |
| **P6 `/v1` 與 webhook** | ✅ 已完成（完整資源契約、scopes、outbox webhook、生成 client） |
| P7 部署 | ⬜ 未開始 |
| P8 打磨 | ⬜ 未開始 |

目前測試數：後端 **1280 passed、5 skipped**，admin-web 120、apply-web 91、packages 131；OpenAPI 與生成 client 已同步。下一階段是 P7 部署。

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

## 2. 已完成的收尾動作（本輪交接前做的）

- P4 已補齊 apply-web 教學、admin 文件類型對照、跨模組 E2E 與 CI，並重新產生 OpenAPI。
- P5 已由 worktree 分支合併回 main（merge `83a13b9`）；衝突已保留 P4/P5 雙方功能，並完成全套回歸。

### 2.1 P4/P5 整合結果

合併後的單一 main 已包含 P4 與 P5。`app/ai/fake.py` 同時保留意圖分類與內容助理的 fake schema；copilot 用量測試改為寫入隔離測試資料庫；D28–D31 已記錄在 SPEC §18。

## 3. 剩餘任務

### P4 SOP 串接（**已完成**，SPEC §8.4 / §8.5 / §9.1 / §9.2 / §9.7）

**已經做好的（`be0f1a4`，已含測試）**：
- `app/services/sop_links.py`：`document_type ↔ flow` 對照解析；`app/routers/admin/sop_flows.py`：後台 CRUD 端點。
- `app/routers/sop.py`（`/api/sop/*`，匿名 + 限流）與 `app/services/sop_public.py`；`public_api.py` 對應的 `/v1/sop/*`。
- `app/services/line/sop.py`：LINE `sop_session` 生命週期（開始、下一步、我卡住了、換流程、結束、逾時）。
- `app/ai/intent.py::classify()`：LLM 意圖分類 + 規則 fallback + quick reply；`services/faq.py` 向量檢索（pgvector，非 Postgres 時退回關鍵字）；`scripts/embed_faqs.py`。
- `services/policy.py` 改讀 contents 的 `sop.template.*`；`app/ratelimit.py`。

**已補完的**：
1. apply-web `/sop`：文件／平台選擇、流程與逐步卡片、縮放、遮罩與截圖定位；退件頁會帶方案與退件碼連到精確流程。
2. admin-web「文件類型對照」：方案 × 文件類型 × 平台，只能選已發布流程，整組取代儲存。
3. `apps/api/scripts/e2e_maydru.py`：送件 → 退件 → LINE 教學 → 補件 → 核准的完整劇本，成功印出 `ALL OK`。
4. CI 已啟用 MayDru workflow E2E job；SPEC D28–D31、README 與 OpenAPI 均已同步。

### P5 方案管理與內容助理（**已完成並合併**，SPEC §8.2 / §8.6 / §9.6）

**已提交（branch `worktree-agent-a9dac84b8568275d8`，commits `3df7619` + `ab67356`）**：後端 `app/ai/copilot.py`、`app/services/copilot.py`、`app/routers/admin/copilot.py`（內容助理 a/b/c）、方案管理後端（排序、待審工具 resolve、規則試算）、alembic `0015_copilot_suggestions`、三個測試檔（`test_copilot.py`、`test_scheme_admin_p5.py`、`test_new_scheme_acceptance.py`，含「新增方案不改 code 即可送件」驗收測試）；前端 `apps/admin-web/src/pages/schemes/*`（方案清單、編輯器、tabs、規則編輯器、試算面板、待審工具、內容助理面板）與 LINE 內容區的 FAQ 建議卡。

**驗收**：方案 CRUD／規則試算／內容助理測試與「新增方案不改 code 即可送件」驗收均通過。

### P6 `/v1` 與 outbound webhook（**已完成**，SPEC §10）

- Schemes / Applications / Review / SOP / Contents / FAQ / Intent / Notifications / Webhooks 全部掛在既有 domain service 上；Bearer API key 有 `read, apply, review, sop, contents, webhooks, admin` scopes 與 per-key rate limit。
- 六種領域事件寫入 transactional outbox；delivery 使用精確 JSON body 做 HMAC-SHA256，帶兩個指定標頭，由 arq 指數退避重試五次，並提供查詢與手動重送。
- `packages/api-client/src/schema.d.ts` 已由 OpenAPI 生成並進 git；CI 會重生後檢查 diff。

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
| **OpenAPI 快照** | 改動任何端點後 `tests/test_openapi_snapshot.py` 就會紅。用 `UPDATE_OPENAPI=1` 重新產生並提交 `apps/api/openapi.json`；目前快照已同步。 |
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
| [`SPEC.md`](SPEC.md) | 唯一規格來源。§6 資料表、§7 狀態機、§8 功能規格、§9 Agent 規格與紅線、§10 API 契約、§11 安全隱私、§16 階段表、§18 決策 D1–D34 |
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

P5 merge commit 是 `83a13b9`；P4 收尾會以本文件所在的後續 commit 為準。工作樹中的 `.claude/` 是 Claude 的本機資料，不納入版本控制。遠端尚未設定，沒有任何 commit 被 push 過。
