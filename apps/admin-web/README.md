# admin-web — 承辦人後台

SOP_Tutor 的後台加上 P3 的案件審核區（SPEC §8.2）。樣式走 `@maydru/ui` 的 token，
支援深色模式；桌面為主，平板可用。

## 授權：capability，不是角色排名

決策 D14 之後，能不能按某個按鈕只看 capability（`sop_edit`、`sop_review`、
`case_review`、`case_supervise`、`admin`、`owner`）。`lib/types.ts` 的 `ROLE_CAPS`
逐字對齊 `apps/api/app/deps.py`；`useAuth().can(cap)` 是唯一的判斷入口，
`RequireCap` 把整個路由圈起來。角色排名（`atLeast`）已經移除——它會讓案件覆核者
順手拿到 SOP 編輯權。

| 角色 | capability |
|---|---|
| `viewer` | （無） |
| `sop_editor` | `sop_edit` |
| `sop_reviewer` | `sop_review` |
| `case_reviewer` | `case_review` |
| `case_supervisor` | `case_review`、`case_supervise` |
| `admin` | 以上全部 + `admin` |
| `owner` | 以上全部 + `owner` |

## 案件審核區

| 路徑 | 功能 |
|---|---|
| `/cases` | 佇列：依 `first_submitted_at` 遞增（補件不重排），可依狀態／方案／指派／規則判定篩選、搜尋、分頁 |
| `/cases/:case_no` | 案件頁：左邊文件檢視器，右邊申請資料、規則判定、金額比對、決策列、事件時間軸 |

- **文件檢視器**（`cases/DocumentViewer.tsx`）：目前版本分頁 + 歷史版本、presigned URL（5 分鐘）、
  滾輪縮放（0.5–3）、拖曳平移、旋轉、OCR 行框高亮。高亮用**百分比**定位，所以縮放與旋轉不必重算。
- **重新辨識**：在承辦自己的瀏覽器跑 `@maydru/ocr`，只把結果 POST 回 `…/documents/{id}/ocr`
  （`source=reviewer`），伺服器重跑規則引擎。證明文件永遠不送任何模型（SPEC §11、決策 D3）。
- **規則判定卡**：只陳述事實（抽到什麼值、比對結果、辨識信心），**不出現任何建議**——
  判斷是承辦的職權，不是系統的（決策 D2／D3）。`定位` 把 bbox 交給左邊畫框，`覆寫` 寫一列
  `source=reviewer` 的新判定，自動判定保留在歷程裡。
- **決策列**：按鈕全部來自 `allowed_transitions`（後端已濾掉沒有能力的轉移）。
  T3 在 `approval_blockers` 非空時停用，並列出擋住的規則；T2 開補件表單（勾文件 + 退件原因 +
  說明 + 期限，預設今天 + `supplement_days`）；T9／T11 要填理由。

## 開發

```bash
npm run dev:admin           # 5173，API 走 vite proxy 到 :8000
API_URL=http://localhost:8200 npm run dev:admin   # 指到 compose 的 api
```

### 不接後端跑（MSW mocks）

```bash
VITE_USE_MOCKS=1 npm run dev:admin
```

`src/mocks/` 實作案件審核區用得到的端點，資料是三筆假案件（一件可核定、一件有
`approval_blockers`、一件已撥款）。開 mocks 時會自動塞一個假 token，直接進得了後台；
SOP 區的端點不在 mocks 裡，會照常打真後端。瀏覽器端需要 `public/mockServiceWorker.js`
（已在 repo 裡；msw 升版後用 `npx msw init public` 更新）。

## 測試

```bash
npm test -w @maydru/admin-web
```

## 案件頁的資料來源

| 要什麼 | 從哪來 |
|---|---|
| 退件原因（含承辦看的 `staff_label`）、文件類型、補件天數 | `CaseDetail.scheme_settings`，跟案件一起回來；獨立入口是 `GET /api/admin/schemes/{code}/settings` |
| 指派選單的名單 | `GET /api/admin/reviewers`：本機關中帶得到 `case_review` / `case_supervise` 的啟用帳號 |
| 時間軸上「誰做的」 | `events[].actor_name`（承辦才有名字；系統與市民一律 null） |
