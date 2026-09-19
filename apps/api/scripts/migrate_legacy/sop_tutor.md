# SOP_Tutor → MayDru 搬遷程序

MayDru 的後端就是 SOP_Tutor 的後端長出來的：資料表沒有改名、沒有搬家，只是多了
SPEC §6.2–§6.4 那一批新表。所以這裡不需要轉換腳本——整份資料庫接手過來，再跑一次
新的 alembic migration 就會自己長出新表（SPEC 決策 D9）。

同樣的理由，兩個 MinIO bucket 也是整份鏡像過去：step card 的檔名是內容雜湊，
published snapshot 存的是物件 key 而不是絕對網址（migration 0010 已經改過），
所以換了網域也不用改資料。

## 先決條件

- 新舊 stack 同時活著。舊的照常服務，新的只是把資料接過去，隨時可以退回去（D9）。
- 新 stack 的 `.env` 已經設好，而且 `SECRET_KEY` **沿用舊的**——JWT 與 API key 的
  hash 都綁在它身上，換掉等於把所有人登出、所有 API key 作廢。
- `ORIGINAL_ENCRYPTION_KEY` 也必須沿用，否則鏡像過去的承辦人原圖一張都解不開。

## 一、Postgres

1. 舊 stack 停止寫入（把 api 與 worker 停掉，資料庫留著）。
2. 對舊資料庫做一份 custom-format 的完整 dump，存到搬遷主機上。
3. 在新 stack 的空資料庫上先建好 `vector` extension（pgvector 映像已內建，
   但 extension 要在目標資料庫裡建），再把 dump 還原進去。
4. 還原完成後在 `apps/api/` 跑 `alembic upgrade head`。它會從 0010 接著跑
   0011–0014：新表、角色改名、事件表的不可變 trigger、新的向量索引。
5. 用 `alembic current` 確認停在 head，並抽查 `users.role` 已經是
   `sop_editor` / `sop_reviewer`（migration 0012 的資料搬遷）。

> 注意順序：**先還原、後 migrate**。反過來做會讓 0011 建好的表被 dump 蓋掉，
> 而 alembic 的版本號還停在 head，之後就再也對不齊了。

## 二、MinIO

兩個 bucket 各鏡像一次：private（承辦人原圖、replica、eval 影像）與
public（step card、預覽、縮圖）。用 `mc alias` 分別設定新舊端點，再對每個 bucket
執行一次 `mc mirror --overwrite`。

鏡像完成後的驗收：

- 兩邊的物件數量一致。
- 新 stack 的 admin 打得開任一張 step card（走 `PUBLIC_MEDIA_BASE_URL`）。
- 任一張承辦人原圖解得開——解不開就是 `ORIGINAL_ENCRYPTION_KEY` 沒沿用。

## 三、youth-line-bot 的資料

那是另一條路：`youth.py`（同目錄）讀 SQLite，把罐頭訊息、方案、FAQ、知識文件、
案件與 LINE 綁定搬進新資料庫。它與本文件互不相干，可以先後任意順序執行，
唯一的要求是 `scripts/seed.py` 要先跑過（方案的子設定表由它補齊）。

## 四、驗收與回退

- `GET /health` 通、admin 登得進去、SOP Canvas 讀得到既有 flow。
- `scripts/e2e_smoke.py` 通過。
- 案件佇列看得到 seed 的五筆示範案件與搬遷過來的舊案件。

回退就是把流量切回舊 stack：整個過程沒有對舊資料庫或舊 MinIO 寫過任何東西
（dump 與 mirror 都是唯讀操作），所以舊 stack 隨時是可用的那一份。
