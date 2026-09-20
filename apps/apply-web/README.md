# apply-web — 市民送件網頁

SPEC §8.1 的市民端：方案列表、六步送件、案件查詢、補件、撤回。行動優先、不登入、
以 Apple HIG 為準（SPEC §15）。樣式一律走 `@maydru/ui` 的 token，支援深色模式。

## 路由

| 路徑 | 功能 |
|---|---|
| `/` | 開放中的方案；一張卡一個主要動作（開始申請） |
| `/apply/:scheme` | 六步送件：工具 → 身分 → 繳費 → 準備 → 上傳 → 確認 |
| `/apply/:scheme/done?case=` | 送件成功：大字案號、請截圖保存、LINE 綁定入口 |
| `/status` | 案件編號 + 末四碼查詢 |
| `/status/:case_no` | 進度時間軸、下一步、補件面板、撤回 |
| `/sop`、`/sop/:flow` | 取得文件的教學（P4 才有內容，路由與 `?document_type=` 先立起來） |
| `/help` | 常見問題（伺服器搜尋 + 前端即時過濾） |
| `/demo` | 手機優先的一頁式 Feature Demo：資料去敏、國泰 SOP、文件標注與 LINE Bot |

`/demo` 會從公開 SOP API 找出國泰世華平台的已發布流程，流程選單、橫向教學圖與聊天
客服共用同一份資料。後端離線或沒有國泰流程時，改顯示 `public/demo/cathay-home.png` 的
離線展示內容；畫面會清楚標示來源，不把備援圖冒充成資料庫結果。

## 上傳管線（`src/apply/pipeline.ts`）

1. `@maydru/ocr` 的 `loadImage()`（HEIC 有明確訊息）或 `pdfToPageCanvases()`（前 5 頁）
2. `must_mask` 的文件進 `@maydru/mask-editor`，**必須勾選確認**才繼續
3. `recognize()` 逐頁辨識，bbox 換算成合併圖的座標
4. 幾頁疊成一張 JPEG 送出——契約是一份文件一個檔案

`@maydru/review-rules` 的 `evaluate()` + `precheck()` 在上傳與確認兩步即時回饋：
FAIL 擋住送出（留「請人工協助」逃生門）、INDETERMINATE 放行並標記。
伺服器會重跑一次規則引擎，前端結果不具決定性（SPEC §8.1 第 5 步）。

**原圖永遠不離開瀏覽器**；送出的只有遮罩後合併的 JPEG。草稿鏡到 `sessionStorage`，
但只有文字欄位，影像一律不寫入（SPEC §11）。

## 開發

```bash
npm run dev:apply           # 5174，API 走 vite proxy 到 :8000
API_URL=http://localhost:8200 npm run dev:apply   # 指到 compose 的 api
```

### 不接後端跑（MSW mocks）

```bash
VITE_USE_MOCKS=1 npm run dev:apply
```

`src/mocks/` 實作 P3 契約的 `/api/apply/*` 與 `/api/contents`，資料是
`apps/api/scripts/seed_data.py` 的新竹市方案（代碼與文案逐字對齊），外加三筆示範案件：

| 案件編號 | 狀態 | 末四碼 |
|---|---|---|
| `HC-2026-900002` | 審核中 | `0002` |
| `HC-2026-900003` | 需要補件 | `0003` |
| `HC-2026-900005` | 已撥款完成 | `0005` |

全是假資料，沒有任何真實個資（CLAUDE.md 規則 9）。瀏覽器端需要
`public/mockServiceWorker.js`（已在 repo 裡；msw 升版後用 `npx msw init public` 更新）。
測試走 `src/mocks/server.ts`（`msw/node`），與開發用的是同一組 handlers。

### 環境變數

| 變數 | 用途 |
|---|---|
| `VITE_USE_MOCKS` | `1` 時啟動 MSW，整個 app 不需要後端 |
| `VITE_LINE_OA_ID` | LINE 官方帳號 id（例如 `@maydru`）；沒設定時送件成功頁不顯示綁定區塊 |

## 測試

```bash
npm test -w @maydru/apply-web
```

`@maydru/ocr` 與遮罩編輯器在元件測試裡都用替身——要驗的是流程（沒確認遮罩就不會有結果、
precheck FAIL 會擋住送出、補件只顯示被退的那幾份），不是 tesseract 本身。
