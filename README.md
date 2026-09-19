# MayDru

政府申辦流程協助平台。**一個後端、兩個前端、一個 LINE channel**：市民能在網頁匿名送件、在 LINE 隨手求助；承辦人在同一個後台管理罐頭訊息、製作 SOP、審核案件、設定方案。所有能力同時以 `/v1` API 對外開放。

完整規格在 [`SPEC.md`](SPEC.md)（v1.0，唯一規格來源）；工作規則在 [`CLAUDE.md`](CLAUDE.md)。

目前階段：**P0–P6、P8 已完成並合併**（SPEC §16）。資料層、內容與 LINE、送件與審核、SOP、方案管理、完整 `/v1`、outbound webhook、Dashboard、稽核 UI 與可及性 gate 均已就緒；P7 等待正式 VM／DNS／憑證／LINE 切換。

## 版面

```
apps/api/          FastAPI 後端（routers 薄殼、services 業務邏輯、ai LangChain/LangGraph、worker arq）
apps/renderer/     Playwright HTML→PNG 服務
apps/admin-web/    承辦人後台（React 19 + Vite + Tailwind 4）
apps/apply-web/    市民送件網頁（同工具鏈，行動優先）
packages/ui/       共用設計 token（兩個前端都 import tokens.css）
packages/api-client/   OpenAPI 產生的型別 + fetch 包裝
packages/ocr/          瀏覽器端 OCR 包裝（tesseract.js）
packages/review-rules/ 規則引擎 TS 版（即時回饋用；伺服器 Python 版為準）
packages/mask-editor/  證件遮罩編輯器
docker/ docker-compose*.yml deploy/   部署
```

Python 用 [uv](https://docs.astral.sh/uv/) workspace（root `pyproject.toml`），JS 用 npm workspaces（root `package.json`）。

## 開發快速上手

```bash
cp .env.example .env          # 填入密鑰；.env 永不提交
uv sync                       # 建立 .venv，裝好 api + renderer + 所有品質工具
npm install                   # 安裝兩個前端與五個 package
```

### 全套用 docker compose 跑

```bash
docker compose up -d --build
# api 127.0.0.1:8200 · admin-web 8201 · apply-web 8202 · renderer 8101
# postgres 5433 · redis 6380 · minio 9002/9003
docker compose down           # 保留 volume
```

連接埠刻意與 SOP_Tutor 的 stack 錯開，兩者可並存（SPEC §13.3）。migration 由 api 容器啟動時自動跑。

### 只跑資料面，後端在本機跑

```bash
docker compose up -d postgres redis minio renderer
uv run --package maydru-api alembic upgrade head    # 在 apps/api/ 下
uv run --package maydru-api uvicorn app.main:app --reload
uv run --package maydru-api arq app.worker.main.WorkerSettings
npm run dev:admin             # http://localhost:5173
npm run dev:apply             # http://localhost:5174
```

`LLM_PROVIDER=fake` 與 `LINE_SENDER=noop` 可完全離線跑通，測試環境永不連真實 LINE / LLM。

## 資料層（SPEC §6、§7、§12）

方案是純資料：級距、文件類型、繳費管道、審核規則、退件碼與合格工具都存在資料庫裡，
新增一個方案不需要改任何程式碼。案件的狀態只能由 `app/services/application.py` 的
`transition()` 改變，每一次轉移都留下一筆**不可變**的事件。

在 `apps/api/` 下，先 `alembic upgrade head`，再：

```bash
# 新竹市 AI 工具補助的完整設定 + 5 筆示範案件（每個狀態一筆，資料全是假的）
uv run --package maydru-api python scripts/seed.py

# youth-line-bot 的 SQLite 搬進來（唯讀讀來源；路徑可省略，預設在隔壁專案）
uv run --package maydru-api python scripts/migrate_legacy/youth.py [youth.db]
```

兩支腳本都冪等，跑幾次結果都一樣，結束時印出 inserted / updated / skipped（搬遷另有
failed）報表。SOP_Tutor 的 Postgres 與 MinIO 是整份接手，不需要腳本，程序寫在
`apps/api/scripts/migrate_legacy/sop_tutor.md`。

排程工作由 worker 執行：補件逾期每小時檢查一次（T8），終態案件滿保存期限後在每天
03:00 硬刪證明文件——刪的是影像、OCR 與標註座標，申請主檔與事件時間軸永遠留著。

## 送件與審核 API（SPEC §8.1、§8.2、§8.3）

市民走 `/api/apply/*`（匿名、依來源 IP 限流），承辦人走 `/api/admin/applications/*`
（JWT + capability）。兩邊共用同一組 service，狀態只由 `transition()` 改變。

| 端點 | 做什麼 |
|---|---|
| `GET /api/apply/schemes`、`GET /api/apply/schemes/{code}` | 開放中的方案；詳情含級距、文件類型、繳費管道、退件碼與**審核規則**（前端即時回饋用） |
| `POST /api/apply/schemes/{code}/required-documents` | 必要文件由伺服器算，前端不自己推 |
| `POST /api/apply/applications` | multipart 送件：`application`、`documents` 兩個 JSON 欄位 + `file_0`、`file_1`… |
| `POST /api/apply/verify` | 案號 + 末四碼 → 30 分鐘的案件 token；5 次失敗鎖 15 分鐘（423） |
| `GET /api/apply/applications/{case_no}` | 案件時間軸、補件項目、文件版本（帶案件 token） |
| `POST …/documents`、`POST …/withdraw` | 補件（T4，系統接著跑 T5）與撤回（T10） |
| `GET /api/apply/faqs` | 關鍵字搜尋；語意搜尋在 P4 |
| `GET /api/admin/applications` | 佇列：分頁、狀態／方案／承辦人篩選、案號與姓名搜尋 |
| `GET /api/admin/applications/{case_no}` | 案件頁：文件與 OCR、findings（最新 + 歷史）、規則、可用轉移、核准阻擋項 |
| `GET …/documents/{id}/url` | private bucket 的 5 分鐘 presigned URL |
| `POST …/documents/{id}/ocr`、`POST …/evaluate`、`PUT …/findings/{rule_code}` | 承辦人重新辨識、重跑規則、人工覆寫 |
| `POST …/transitions`、`POST …/assign` | 狀態轉移與指派 |

規則引擎（`app/services/review.py`）是判定的唯一權威：它不碰資料庫、不呼叫任何模型，
也不 import `app.ai`（import-linter 強制）。申請人瀏覽器跑的 `packages/review-rules`
只是即時回饋，伺服器收件後一律重跑。兩版共用
`packages/review-rules/fixtures/*.json`，`tests/test_review_fixtures.py` 與
`src/fixtures.test.ts` 對同一組輸入斷言相同輸出。

核准（T3）的前置條件在伺服器端強制：所有 `required` 規則的**最新** finding 都得是
MATCH，否則回 `409 {code:"TRANSITION_NOT_ALLOWED", blockers:[…]}`。承辦人覆寫會另寫一列
`source=reviewer`，舊的留著供稽核。

證明文件只進 private bucket，key 是
`applications/{tenant}/{case_no}/{doc_type}/{revision}.{ext}`；影像永不經過 API 本體，
只給 presigned URL。

## 罐頭訊息（SPEC §8.6）

市民看到的每一個字都來自 `contents`，程式碼裡沒有硬編的中文文案（測試以 AST 檢查
`app/services/line/` 的字串常數，決策 D24）。出廠文案在 `app/content_registry/`，
每次啟動與每次 `seed.py` 都會把缺的 key 補進資料庫，**但永遠不覆蓋承辦人改過的字**。
承辦人在後台「LINE 內容 → 罐頭訊息」改；草稿與已發布分開，發布才會換掉線上的字。

| 端點 | 做什麼 |
|---|---|
| `GET /api/contents?keys=…` | 匿名可讀的已發布文案，回 `{items:{key:text}}`；apply-web 的狀態說明走這裡 |
| `POST /api/contents/render` | key + 變數 → 文字或 Flex（與 `/v1/contents/render` 同一個 service） |
| `GET /api/admin/contents`、`PUT …`、`POST …/publish`、`POST …/reset` | 後台的列表、草稿、發布與還原 |

`/api/apply/*` 與 `/api/admin/applications/*` 回應裡的文案一律是 **key + 已渲染的字**
兩欄並存（`next_action` / `next_action_text`、`note` / `note_text`）：前端要嘛直接用，
要嘛自己拿 key 去 overlay，兩種都不必在前端複製一份中文。

## LINE 開發（SPEC §8.4、§8.7）

**離線開發**：`LINE_SENDER=noop`（`.env.example` 的預設值）不會連任何網路，送出的
訊息只記在記憶體裡。這時候可以用測試端點直接餵一個 LINE 事件進來，拿回 bot 會回
什麼：

```bash
curl -s localhost:8000/__test__/line/inbound \
  -H 'content-type: application/json' \
  -d '{"event":{"type":"message","replyToken":"t",
       "source":{"userId":"Udemo"},"message":{"type":"text","text":"我的案件到哪了"}}}'
```

這個端點只在 `ENV != production` 且 `LINE_SENDER != line` 時存在，其餘情況一律 404；
SPEC §14 的 E2E 劇本走的就是它。

**接上真的 LINE**：設 `LINE_SENDER=line`、`LINE_CHANNEL_SECRET` 與
`LINE_CHANNEL_ACCESS_TOKEN`，webhook 指到 `POST /line/webhook`。簽章一定要驗，
**憑證缺失時請求會被拒絕**（401），不會像舊系統那樣跳過驗證。圖文選單在後台
「LINE 內容 → Rich menu」按同步；圖檔限 PNG/JPEG、2500×1686（或 2500×843、
1200×810）、1 MB 以內，不合規只會被回報，系統不會自己改圖。

推播由 worker 送出：狀態轉移寫一列 `notifications` 並排一個工作，失敗重試三次，
三次都失敗就留在 `failed` 讓承辦人看得到。

## SOP 教學（SPEC §8.1、§8.5、§9.1–§9.3）

市民在 apply-web 的 `/sop` 先選文件類型與平台，再逐張瀏覽已發布的 step card；送件準備頁與退件補件頁會直接帶上 `document_type`，退件連結另帶 `scheme` 與 `rejection_code`，因此承辦人特別指定的教學優先。按「我卡住了」可先用瀏覽器端遮罩工具蓋掉敏感資訊，再把截圖送到 `/api/sop/locate`；截圖全程只在記憶體處理、不寫 MinIO 或資料庫。

後台「SOP → 文件類型對照」管理方案 × 文件類型 × 平台的 flow。市民端與 LINE 只解析 `published` flow，草稿不會外流。主要匿名端點：

| 端點 | 做什麼 |
|---|---|
| `GET /api/sop/catalog/platforms`、`GET /api/sop/catalog/document-types` | 有已發布教學的平台與文件類型 |
| `GET /api/sop/document-types/{code}/flows` | 解析文件對應流程；可依平台、方案與退件碼過濾 |
| `GET /api/sop/flows/{id}/steps` | 依序回傳 step card 與文字備援 |
| `POST /api/sop/locate` | multipart 截圖定位；回傳結果、引導與定位後的卡片 |

對外 API 使用 `/v1/sop/*`；舊的 `/v1/chat`、`/v1/sessions` 等平路徑暫留一版別名（D28）。

### OpenAPI 快照

`apps/api/openapi.json` 是提交進 git 的契約快照，CI 用它做「client 同步檢查」。
端點或 schema 改了就重新產生並一起 commit：

```bash
cd apps/api
UPDATE_OPENAPI=1 uv run --package maydru-api pytest tests/test_openapi_snapshot.py
```

只在開發環境存在的 `__test__` 路由刻意不進快照。

## 品質門檻（SPEC §14）

```bash
uv run ruff check             # lint
uv run mypy                   # 型別（services/ 與 ai/ 為 strict）
uv run lint-imports --config pyproject.toml   # services/review、routers/apply 禁 import app.ai
cd apps/api && uv run --package maydru-api pytest -q

npm run typecheck             # tsc -b（全部 workspace）
npm run lint                  # oxlint
npm test                      # vitest
npm run build                 # tsc -b && vite build
```

目前的數量：後端 1281（另有 5 個環境條件 skip）、admin-web 122、apply-web 92、五個 package 合計 131。

CI（`.github/workflows/ci.yml`）跑同一組指令，另加 `docker buildx`（linux/arm64 + linux/amd64），只有 main 的 push 會推 GHCR。

### API client 型別

```bash
npm run generate -w @maydru/api-client            # 需要後端在 localhost:8000
npm run generate -w @maydru/api-client -- ./openapi.json
```

產出的 `packages/api-client/src/schema.d.ts` 會進 git；CI 重新產生並拒絕不同步的契約。

## 已知取捨（P0 技術債）

從 SOP_Tutor 原樣搬入的程式碼尚未達到 SPEC §14 的靜態門檻。與其改寫既有測試涵蓋的行為，P0 選擇把例外明確列在設定裡，讓門檻對**新程式碼**是真的：

- **ruff**：`pyproject.toml` 的 `extend-ignore` 列出九條規則（`E701`/`E702` 的緊湊單行是 SOP_Tutor 的既有風格，`B008` 是 FastAPI 的 `Depends()` 慣用法，其餘為 prompt/HTML 長字串與測試裡的 lambda）。`uv run ruff check --fix` 已套用過一次 import 排序。
- **mypy**：分兩層。第一層是連預設模式都過不了的 19 個模組（`ignore_errors`），第二層是過得了預設模式但過不了 strict 的 8 個模組（只放寬 strict 旗標）。兩份清單都寫在 `pyproject.toml` 且只會變短；新模組一律 strict。
- **openapi-typescript** 仍把 typescript peer 鎖在 `^5.x`，root `package.json` 用 `overrides` 放行（它只在 codegen 腳本裡跑）。

## 第一次啟動（SPEC §10.2、決策 D26）

還沒有任何 owner 帳號時，`GET /api/auth/bootstrap-status` 回 `needs_bootstrap: true`，
後台登入頁就變成「建立第一個管理者」。閘門看的是**有沒有還在用的 owner**，不是有沒有
機關——`seed.py` 會先把機關灌進去，所以那台機器上機關早就在了，這時 bootstrap 會把
owner 掛到既有機關上，不再開第二個。`BOOTSTRAP_*` 三個環境變數則讓容器啟動時自動做完
同一件事。

## 隱私紅線（SPEC §11）

證明文件永不送 LLM；市民截圖只在記憶體；承辦人原圖加密、審後硬刪；手機／身分證只存末四碼 hash。git 裡不放任何 secret、真實個資或真實截圖。
