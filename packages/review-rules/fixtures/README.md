# 規則引擎共用 fixtures

這個資料夾是 **TypeScript 版（`packages/review-rules`）與 Python 版
（`apps/api/app/services/review.py`）唯一的共同真相**。SPEC §14「規則一致性」要求兩邊
對同一組 fixture 產出相同結果，CI 會跑。

- TS 端：`src/fixtures.test.ts` 會自動掃描這個資料夾的每個 `*.json`。
- Python 端：用同樣的方式載入，逐案比對 `evaluate()` 與 `precheck()` 的輸出。

新增規則行為時**先加 fixture**，兩邊再各自改到綠。

## 檔案格式

每個 `*.json` 是一個案例：

```jsonc
{
  "name": "人看的短標題",
  "description": "這個案例在測什麼、為什麼要這樣判",
  "rules": [ReviewRule, ...],        // 見 SPEC §6.2 review_rules
  "documents": [OcrDocument, ...],   // document_type_code + 該文件的 OCR 結果（可為 null）
  "facts": ApplicationFacts,         // 申請書上的事實
  "expected": {
    "findings": [PartialFinding, ...], // 順序必須等於 evaluate() 的輸出
    "verdict": "PASS" | "FAIL" | "INDETERMINATE"
  }
}
```

### `rules[]`

| 欄位 | 說明 |
|---|---|
| `code` | 規則代碼，`amount_tolerance` 的 `source_rule_code` 指的就是它 |
| `label` | 給人看的名稱，會出現在 `note` 文案裡 |
| `document_type_code` | `null` = 不限文件類型，所有文件一起找 |
| `rule_type` | `keyword_extract` / `regex_extract` / `amount_tolerance` / `required_doc` |
| `config` | 隨 `rule_type` 而異，見 SPEC §8.3 |
| `required` / `severity` | 決定 MISMATCH 是否擋送出（`required && severity === 'error'`） |
| `sort_order` | 輸出順序；同 order 再比 `code` 字典序 |
| `active` | `false` 的規則完全不跑，也不會出現在 findings |

### `documents[]`

```jsonc
{ "document_type_code": "BILLING_STATEMENT", "ocr": { "text": "...", "confidence": 90, "lines": [...] } }
```

`ocr` 為 `null` 代表「檔案已上傳，但還沒辨識」——`required_doc` 仍然算它存在，抽值規則則讀不到東西。
`lines[]` 沿用 `@maydru/ocr` 的格式：`{ text, confidence, bbox: {x0,y0,x1,y1}, words: [{text, bbox, confidence}] }`，
已依 `y0` → `x0` 排序。

### `expected.findings[]`

**部分比對**：只比對 fixture 裡有寫的欄位，沒寫的欄位不檢查。因此 `bbox` 幾乎都省略
（座標是實作細節，寫死會很脆）。`null` 與「欄位不存在」視為相同，所以
`"suggested_supplement": null` 等於「不該有補件建議」。

`findings` 的**長度與順序**一定要對：長度等於 `active` 規則數，順序等於 `sort_order`。

## 兩版一定要一致的細節

1. **關鍵字偏好順序**：含拉丁字母且出現在小寫整行 → 任何出現在小寫整行 → 去掉所有空白後才對上。
   第三種命中時 `indexOf` 會是 -1，取值退回「整行」（見 `03-keyword-compact-fallback`）。
2. **取值**：`regex` 命中取 `match[group ?? 0]`；否則 `value_after_keyword` 時取關鍵字後面、
   去掉開頭 `[\s:：#—–\-/]+` 的字；都拿不到就用整行。空字串一律退回整行。
3. **選行**：分數 `10 + (regex 命中 ? 3 : 0) + line.confidence / 100`，**嚴格大於**才換人，
   所以同分時先出現的贏（文件順序 → 行順序）。
4. **容差**：`tolerance_pct` 是百分比（`5` = 5%）。百分比與絕對值**兩個條件都要成立**，
   比較用 `<=`。`purchase_amount` 為 `0` 一律不成立；為 `null` 回 `PENDING`。
5. **normalize**：
   - `amount`：全形數字轉半形 → 逗號當千分位、點當小數點（歐式 `1.200,50`，即最後一個逗號
     在最後一個點之後，視為看不懂回 `null`）→ 只留 `0-9.-` → 多於一個小數點同樣 `null` →
     輸出 `String(number)`（整數不帶 `.0`）。
   - `date`：依序試「民國年 / ISO / 斜線 / 點 / 八碼」，年 < 1911 加 1911，月 1–12、日 1–31，
     輸出 `YYYY-MM-DD`；一律「年月日」順序，不支援美式 `MM/DD/YYYY`。
   - `last4`：去掉空白與各式連字號 → 遮罩字元（2 個以上）後面的四碼 → 字串結尾的四碼 → 否則 `null`。
   - normalizer 回 `null` 時 status 是 `UNREADABLE`，且 `extracted_value` 保留**原字串**。
6. **評估順序**：先跑 `keyword_extract` / `regex_extract` / `required_doc`，再跑
   `amount_tolerance`，所以 `source_rule_code` 排在後面也讀得到；輸出順序仍依 `sort_order`。
7. **precheck**：`blocking` = `required && severity === 'error'` 的 MISMATCH；
   `warnings` = 其餘 MISMATCH + 所有 UNREADABLE / PENDING。
   `blocking` 非空 → `FAIL`；否則 `warnings` 非空 → `INDETERMINATE`；都空 → `PASS`。

## 案例一覽

| 檔案 | 測什麼 |
|---|---|
| `01-keyword-extract-pass` | 三條規則全命中 → PASS |
| `02-keyword-latin-preference` | 同一行有中英關鍵字時拉丁優先 |
| `03-keyword-compact-fallback` | 去空白才對上時取整行；last4 normalizer 仍救得回來 |
| `04-keyword-unreadable` | 找不到關鍵字 → UNREADABLE → INDETERMINATE |
| `05-regex-extract-amount` | regex 全文抽金額並取 group 1 |
| `06-regex-roc-date` | 民國 115 年 9 月 1 日 → 2026-09-01 |
| `07-date-variants` | 斜線民國年、ISO、八碼三種寫法 |
| `08-masked-card-last4` | `**** **** **** 4826` 與 `xxxx-xxxx-xxxx-4826` |
| `09-last4-unreadable` | 抽到值但轉不成末四碼 → UNREADABLE，保留原字串 |
| `10-amount-tolerance-within` | 差 34 / 2.83%，兩個條件都過 |
| `11-amount-tolerance-pct-edge` | 剛好 5.0%，`<=` 算過 |
| `12-amount-tolerance-abs-edge` | 剛好差 NT$150，`<=` 算過 |
| `13-amount-tolerance-abs-exceeded` | 差 NT$151，百分比過但絕對值不過 → FAIL |
| `14-amount-tolerance-source-unreadable` | 來源沒抽到值 → UNREADABLE，不誤判 MISMATCH |
| `15-amount-tolerance-pending` | 還沒填申報金額 → PENDING |
| `16-required-doc-missing` | 缺兩份 → MISMATCH + suggested_supplement |
| `17-required-doc-from-facts` | config 空陣列 → 改用 facts；OCR 為 null 仍算存在 |
| `18-warning-mismatch` | severity=warning 的 MISMATCH 只降級為 INDETERMINATE |
| `19-inactive-rule-skipped` | 停用的規則不跑；同 sort_order 比 code |
| `20-no-documents` | 一份都沒上傳：缺件 FAIL 蓋過抽值的 UNREADABLE |
| `21-any-document-type` | `document_type_code: null` 跨文件找，信心值高的勝出 |
