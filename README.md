# MayDru

政府申辦流程協助平台。**一個後端、兩個前端、一個 LINE channel**：市民能在網頁匿名送件、在 LINE 隨手求助；承辦人在同一個後台管理罐頭訊息、製作 SOP、審核案件、設定方案。所有能力同時以 `/v1` API 對外開放。

完整規格在 [`SPEC.md`](SPEC.md)（v1.0，唯一規格來源）；工作規則在 [`CLAUDE.md`](CLAUDE.md)。

目前階段：**P0 骨架**（SPEC §16）。後端、renderer 與承辦人後台自 `SOP_Tutor` 搬入並可跑通；送件、審核、LINE、方案管理等產品功能在 P1–P5。

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

CI（`.github/workflows/ci.yml`）跑同一組指令，另加 `docker buildx`（linux/arm64 + linux/amd64），只有 main 的 push 會推 GHCR。e2e job 先保留形狀，P3 才會有劇本。

### API client 型別

```bash
npm run generate -w @maydru/api-client            # 需要後端在 localhost:8000
npm run generate -w @maydru/api-client -- ./openapi.json
```

產出的 `packages/api-client/src/schema.d.ts` 不進 git；契約以後端的 OpenAPI 為準。

## 已知取捨（P0 技術債）

從 SOP_Tutor 原樣搬入的程式碼尚未達到 SPEC §14 的靜態門檻。與其改寫 219 個測試涵蓋的既有行為，P0 選擇把例外明確列在設定裡，讓門檻對**新程式碼**是真的：

- **ruff**：`pyproject.toml` 的 `extend-ignore` 列出九條規則（`E701`/`E702` 的緊湊單行是 SOP_Tutor 的既有風格，`B008` 是 FastAPI 的 `Depends()` 慣用法，其餘為 prompt/HTML 長字串與測試裡的 lambda）。`uv run ruff check --fix` 已套用過一次 import 排序。
- **mypy**：分兩層。第一層是連預設模式都過不了的 19 個模組（`ignore_errors`），第二層是過得了預設模式但過不了 strict 的 8 個模組（只放寬 strict 旗標）。兩份清單都寫在 `pyproject.toml` 且只會變短；新模組一律 strict。
- **openapi-typescript** 仍把 typescript peer 鎖在 `^5.x`，root `package.json` 用 `overrides` 放行（它只在 codegen 腳本裡跑）。

## 隱私紅線（SPEC §11）

證明文件永不送 LLM；市民截圖只在記憶體；承辦人原圖加密、審後硬刪；手機／身分證只存末四碼 hash。git 裡不放任何 secret、真實個資或真實截圖。
