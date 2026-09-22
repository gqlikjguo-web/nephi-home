# 房型相簿第一版

## 正式資料路徑

房型卡片 → authenticated operator session／membership → 正式 property + room_types.room_id → metadata PostgreSQL → Cloudflare R2。客人 metadata API 使用既有 resolvePublicProperty 公開 slug authority；只顯示該旅宿啟用房型且 ready 的照片。圖片不參與 AI、房況判定或 LINE 回覆。

每房型最多 10 張，含尚未完成上傳的保留位置。資料庫只有 ID、object keys、排序及完成旗標；沒有圖片 binary。採用正式房型 ID，讀寫都核對房型所屬 property。未新增 room_types 刪除 cascade：既有 provider 存在刪除後重建同 ID 房型的寫入方式，照片不應因此被刪除。移除的房型無法再從公開相簿 API 查到；本版不新增房型刪除或 object 清理排程。

原本其他設定說明圖片的 PostgreSQL binary storage 完全不變。

## 上傳、排序與失敗

沿用既有 sanitizeImage：JPG／PNG、輸入不超過 8 MiB／20M pixels，原圖最多 1600×1600（2 MiB），預覽最多 480×480（256 KiB），轉為 JPEG 並移除輸入 metadata。圖片 ID 為 24 random bytes（192 bits），不含 property／房號；original 和 preview 分開 object。

房型資料列鎖保護張數與完整排序集合；先持久保存待完成 metadata，再寫入 R2。失敗或程序中斷不會遺失 object key。未完成的照片不公開；業者可在原卡片刪除後重傳。刪除先隱藏 metadata，確認兩個 R2 objects 刪除後才移除 metadata；失敗保留刪除重試能力。R2 request 最多 30 秒、SDK 不自動重試。API 限制同時 2 個上傳、每旅宿 10 分鐘 60 次。

第一版經使用者明確批准，可直接使用 Cloudflare HTTPS r2.dev Public Development URL，亦可使用自訂 HTTPS 圖片網域；不用 presigned URL 或 Render binary route。r2.dev 為 Cloudflare 開發用途網域，具流量限制，未來正式 custom domain 另案處理；本階段不要求 DNS 遷移。HTTPS、無 URL credentials／path／query／fragment、拒絕 S3 API endpoint 等既有驗證維持。Object 設定 Cache-Control: no-store，請勿以 CDN 規則強制忽略此標頭，以免刪除後仍由 CDN 提供舊圖。這是公開住宿照片：持有圖片連結的人可查看；跨旅宿 API 管理權限仍拒絕。

## 一次性正式啟用設定

以下全部於網站安全設定，不把 key 貼進對話或 Git。

1. **Cloudflare Dashboard → R2 Object Storage → Overview → Create bucket**：建立專用房型照片 bucket，使用 Standard storage。保留目前 bucket，不把其他用途檔案混入。
2. **該 bucket → Settings → Public Development URL → Enable**：第一版使用已批准的 HTTPS r2.dev origin。自訂網域另案處理，不變更 junzanai.com DNS。
3. **R2 Overview → Manage R2 API Tokens → Create Account API Token**：選 Object Read & Write，僅授權剛建立的 bucket；安全保存生成的 Access Key ID、Secret Access Key 與 account ID。
4. **Render → junzan-ai → Environment**：設定下列五個值，使用 Render 的安全環境變數介面。不要填入 repository 或任何前端檔案。
   - `ROOM_GALLERY_R2_ACCOUNT_ID`：Cloudflare account ID。
   - `ROOM_GALLERY_R2_BUCKET`：bucket 名稱。
   - `ROOM_GALLERY_R2_ACCESS_KEY_ID`：該 bucket 專用 Access Key ID。
   - `ROOM_GALLERY_R2_SECRET_ACCESS_KEY`：相應 Secret Access Key。
   - `ROOM_GALLERY_PUBLIC_BASE_URL`：圖片公開 origin（`https://...`，第一版允許 r2.dev；沒有 path/query/fragment）。
5. 待正式 Gate 通過，依既有流程套用 migration 033／PR／部署。需以已授權業者照片完成真實 R2 上傳、顯示、排序、刪除與前台驗收；隔離測試不代替此驗收。

只有 HTML img 直接讀公開照片；不上傳至瀏覽器 R2 endpoint，因此本版不需開放 bucket CORS 上傳，也不把 R2 credentials 交給客人／業者瀏覽器。

設定未齊全時後台顯示「房間照片尚未啟用」，客人保留無照片原版面。不得宣稱正式 storage 或 production 驗證已 PASS。

R2 Standard 免費額度與超額計價請以官方 pricing 為準，並在 Cloudflare 開啟帳務通知；本功能沒有購買 Cloudflare Images、Workers 或其他付費服務。

官方依據：
- https://developers.cloudflare.com/r2/buckets/public-buckets/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/pricing/

## 驗證與發布界線

`npm run test:room-gallery`：isolated PGlite + real image sanitizer + HTTP + AWS SDK command boundary，R2/session doubles；不呼叫 OpenAI，不用正式資料庫。

`tests/room-gallery-ui-runner.js`：指定 PLAYWRIGHT_MODULE，使用隔離 Chromium 系統依賴；desktop/390/360 actual browser render，API doubles。真實路由整合另見 browser integration runner。

現有 trusted Gate 對 server.js 的任何新內容仍要求 REAL qualification（僅上一版說明圖片有 exact-hash reviewed transition）。本版新增相簿 HTTP 註冊不改 AI；不自行修改 policy、假稱 NOT_REQUIRED 或使用 production OpenAI key。若此發布資格仍未補齊，必須列為發布阻塞。
