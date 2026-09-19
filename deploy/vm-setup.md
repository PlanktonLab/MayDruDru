# VM 佈署步驟（高層）

對象：OracleCloud VM，Ubuntu 24.04、**aarch64**、4 vCPU、23 GB RAM，已裝 Docker 29 + Compose v5、nginx 1.24、Tailscale（SPEC §13.1）。
這份文件只寫步驟與檢查點，**不放任何密鑰、網域以外的真實值或 SQL**。

## 0. 前提

- DNS 與 Cloudflare origin cert 由產品負責人處理；憑證需涵蓋 `maydru`、`maydru-admin`、`maydru-api` 三個名稱，放在 `/etc/ssl/cloudflare/`。
- 決定 LINE channel 後，在 GitHub repository variables 設 `VITE_LINE_OA_ID`（例如 `@maydru`）再建正式 apply-web 映像；成功頁才會顯示綁定 QR。
- SOP_Tutor 的 stack 仍在跑。MayDru 用不同的 project name（`maydru`）、不同 volume、不同連接埠，兩者可並存到切換確認為止。

## 1. 取得程式與建立 `.env`

1. 在 VM 上 clone 這個 repo（或只放 `docker-compose*.yml`、`docker/`、`deploy/`——prod 用 GHCR 映像，不需要原始碼）。
2. 依 `.env.example` 建立 `.env`，`chmod 600`。必填：
   - `ENV=production`
   - `SECRET_KEY`、`ORIGINAL_ENCRYPTION_KEY`、`PII_ENCRYPTION_KEY`、`RENDERER_TOKEN`
   - `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD`
   - `LINE_SENDER=line` 與 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`
   - `OPENAI_API_KEY`（或 `LLM_PROVIDER=fake` 先離線跑通）
   - `PUBLIC_MEDIA_BASE_URL`、`APPLY_WEB_BASE_URL`、`ADMIN_WEB_BASE_URL`、`CORS_ORIGINS`
   - `BOOTSTRAP_TENANT_NAME`、`BOOTSTRAP_OWNER_EMAIL`、`BOOTSTRAP_OWNER_PASSWORD`（至少 12 字元）
   - `GHCR_OWNER`、`IMAGE_TAG`
3. `ENV=production` 時，API 啟動會自我檢查；任何一項不安全的預設值都會讓它拒絕啟動。

## 2. 拉映像並啟動

- CI 在 main 分支把五個映像（api、worker、renderer、admin-web、apply-web）以 `linux/arm64` + `linux/amd64` 推到 GHCR。
- 在 VM 上先 `docker login ghcr.io`，然後用 `docker-compose.yml` + `docker-compose.prod.yml` 兩個檔一起 `pull` 再 `up -d`。
- prod 覆寫會把 postgres、redis、renderer 的 ports 清空；MinIO S3 API 只綁 `127.0.0.1:9002`，供主機 nginx 代理五分鐘簽章網址，另外留下 `127.0.0.1` 的 8200 / 8201 / 8202。
- `S3_PUBLIC_ENDPOINT` 設為 `maydru-api.xamjiang.com`、`S3_PUBLIC_SECURE=true`；nginx 的 `/maydru-private/` 只轉送到 loopback MinIO，未帶有效 S3 簽章的請求仍會被拒絕。
- migration 由 api 容器啟動時自動跑（`alembic upgrade head`）。

## 3. 主機 nginx

1. 把 `deploy/nginx/maydru.conf` 放到 `/etc/nginx/sites-available/`，在 `sites-enabled/` 建 symlink。
2. `nginx -t` 通過後 `systemctl reload nginx`。
3. 三個網域各打一次首頁確認：apply-web、admin-web 回 HTML，api 回 `/health`。

## 4. 資料搬遷與 smoke test

1. 依 P1 的 `apps/api/scripts/migrate_legacy/` 匯入 youth-line-bot 的 SQLite 與 SOP_Tutor 的 Postgres / MinIO 資料，並比對匯入報表。
2. 在 `apps/api/` 跑 `python scripts/e2e_maydru.py` 驗證送件 → 審核 → 推播 → SOP 的主要路徑；需要實際 renderer/worker 的 SOP 產圖 smoke 另跑 `python scripts/e2e_smoke.py <API_BASE_URL>`。

## 5. 切換 LINE webhook

1. LINE Developers 將 webhook URL 改指 `https://maydru-api.xamjiang.com/line/webhook`。
2. 真機收發驗證。
3. 確認穩定 7 天後，停掉 SOP_Tutor 的 stack 與 `sop*.xamjiang.com` 的 server block。

## 6. 既有環境注意事項

- VM 上有一個獨立的 `redis:8-alpine` 容器綁在 `0.0.0.0:6379`（不屬於 SOP_Tutor），對外暴露。建議關閉或改綁 `127.0.0.1`（SPEC §13.7）。
- MayDru 的 redis 在開發用 6380、prod 完全不開 port，不會與它衝突。

## 7. 備份

- `pgdata` 與 `miniodata` 兩個 volume 是唯一的持久狀態。定期 dump Postgres 並同步 MinIO 的 private bucket；`.env` 另外離線保存（遺失加密金鑰 = 原圖與個資永久無法解密）。
