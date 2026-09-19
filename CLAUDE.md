# CLAUDE.md

MayDru：政府申辦流程協助平台。一個 FastAPI 後端、兩個 Vite 前端（admin-web 承辦人後台、apply-web 市民送件）、一個 LINE channel。完整規格在 `SPEC.md`（v1.0），以它為唯一規格來源；本檔只列工作規則與開發須知。

## 工作規則（SPEC §17）

1. `SPEC.md` 為唯一規格來源；設計變更先改 SPEC 再改 code，並在 SPEC §18 記錄決策。
2. 業務邏輯只在 `apps/api/app/services/`；router 不含邏輯；LINE、admin、`/v1` 共用同一份 service。
3. `services/review.py`、`routers/apply.py` 禁止 import `app.ai`（import-linter 強制）。
4. 所有給市民的文字走 `contents`（`content.t(key)` / `content.tf(key, vars)`）；程式碼中不得硬編中文文案（測試以 grep 檢查 `services/line`）。
5. 狀態轉移只能呼叫 `services/application.py::transition()`。
6. 每個 PR：測試、typecheck、lint 全綠；新增端點必附測試與 OpenAPI 更新。
7. 測試環境永不連真實 LINE / LLM（`LLM_PROVIDER=fake`、`NoopLineSender`）。
8. Commit 用 Conventional Commits（中文摘要）：`type(scope): 摘要`；type 用 `feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`build`、`ci`；scope 例如 `api`、`line`、`review`、`apply-web`、`admin-web`、`worker`、`docker`。PR 描述附對應 SPEC 章節。
9. 不在 git 中存任何 secret、真實個資、真實截圖。

## 結構

- `apps/api/`：FastAPI 後端（自 SOP_Tutor/backend 起家）。`app/routers/` 薄殼、`app/services/` 業務邏輯、`app/models/` 資料表（core / scheme / application / content 四個模組）、`app/ai/` LangChain/LangGraph、`app/content_registry/` 罐頭訊息預設值、`app/worker/` arq、`scripts/` seed 與搬遷。
- `apps/renderer/`：Playwright HTML→PNG 服務。
- `apps/admin-web/`：承辦人後台（自 SOP_Tutor/frontend 起家）。
- `apps/apply-web/`：市民送件網頁（自 submit-flow 搬遷）。
- `packages/`：`ui`（共用元件與 token）、`api-client`（OpenAPI 產生）、`ocr`（tesseract.js 包裝）、`review-rules`（規則引擎 TS 版，僅前端即時回饋）、`mask-editor`。
- `docker/`、`docker-compose.yml`、`docker-compose.prod.yml`、`deploy/`：部署。

## 開發須知

- Python 用 `uv`（workspace root 在 `pyproject.toml`，成員 `apps/api`、`apps/renderer`）：根目錄 `uv sync` 建出單一 `.venv`；測試在 `apps/api/` 下跑 `uv run --package maydru-api pytest -q`。
- 靜態門檻在根目錄跑：`uv run ruff check`、`uv run mypy`、`uv run lint-imports --config pyproject.toml`。ruff / mypy 的既有例外清單寫在 `pyproject.toml`，只會變短，不得新增。
- JS 用 npm workspaces：根目錄 `npm install`，`npm run dev:admin`（5173）/ `npm run dev:apply`（5174）；`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 會 fan out 到所有 workspace。
- 全套本機環境：`docker compose up -d --build`（api 8200、admin-web 8201、apply-web 8202、renderer 8101、postgres 5433、redis 6380、minio 9002/9003；連接埠刻意與 SOP_Tutor 錯開）。`docker compose down` 保留 volume。
- 只跑資料面時：`docker compose up -d postgres redis minio renderer`，後端 `uv run --package maydru-api alembic upgrade head` 與 `uvicorn app.main:app`，worker `arq app.worker.main.WorkerSettings`。
- `.env.example` 列出所有變數；`LLM_PROVIDER=fake` 與 `LINE_SENDER=noop` 可完全離線跑通。`.env` 永不提交、永不印出。
- 隱私是硬規則（SPEC §11）：證明文件永不送 LLM；市民截圖只在記憶體；承辦人原圖加密、審後硬刪；手機/身分證只存末四碼 hash。

## 風格與慣例

- UI 文字用台灣正體中文，識別字用英文。設計走 Apple HIG 的簡約（SPEC §15）：留白、少色、一個畫面一個主要動作。
- 顏色、字級、間距、圓角一律用 `packages/ui` 的 token，支援深色模式。
- 派 subagent 時用 opus。
- 文件（SPEC、README）維持高層描述，不放程式碼與 SQL。
