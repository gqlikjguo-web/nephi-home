# JunZan AI 專案記憶入口

Repository 是 JunZan AI 專案唯一可信知識來源。ChatGPT 對話、Memory 與 Codex Session 只是暫時協作介面；未寫入 Repository 的內容，不視為永久專案知識。

## 目前目標

完成 JunZan AI 第一版在尼腓的家正式導入：先讓 test-only LINE 的 Conversation Engine V2 通過真實驗收，再建立回退點；只有取得使用者逐次明確授權後，才能處理正式 LINE 切換。

## 第一版完成定義

第一版完成必須同時符合：

- 尼腓的家既有 `nephi_home` property、房型、包棟、價格、FAQ 與安全知識正確套用且隔離。
- 後台房況是唯一事實來源；開房或關房後，下一次查詢立即讀到最新資料。
- Conversation Engine 能理解日期、房型、人數、多問題與多輪修改，且不受舊 state 污染。
- 回覆只使用 Resolver 與 property 授權資料；Unknown 不得回答成 No。
- 可回答的子問題完整回答；真正需要人工的子問題才 scoped review／轉真人。
- test-only LINE、完整測試、部署與 health 驗收通過。
- 正式 LINE 有明確回退點，且只在使用者明確授權後切換；真實正式 LINE 驗收通過。

詳細不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。

## 必讀文件

1. [本入口](PROJECT_MEMORY.md)
2. [產品基準](PRODUCT_BASELINE.md)
3. [核心產品憲法](JUNZAN_AI_CONSTITUTION.md)
4. [重大決策](DECISIONS.md)
5. [永久安全規則](SECURITY.md)
6. [下一步任務](NEXT_TASKS.md)

需要查事件原因與產品演進時，再讀 [經驗教訓](LESSONS_LEARNED.md) 與 [重要產品演進](CHANGELOG_INTERNAL.md)。

## 目前最高優先

真實 test-only LINE 驗收 V2 短日期與即時房況鏈路：

1. 連續三次詢問 `7/18 的301可以預訂嗎？`，結果必須 deterministic。
2. 後台將 7/18 的 301 設為可售後，下一次 LINE 查詢立即回答有房。
3. 將同一筆改為不可售後，下一次 LINE 查詢立即回答無房。
4. 驗收 `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？` 的 multi-task 完整性。

## 已知 blocker

- 目前沒有已由程式或部署證據確認的 blocker。
- 真實 test-only LINE 人工驗收尚未完成，因此不得宣稱第一版完成或建議切正式 LINE。

## 第一版驗收狀態

- PostgreSQL、multi-property、property 隔離、admin identity、platform admin：完成。
- Onboarding、既有 property 套用、room／bundle mapping、交易與回滾：完成。
- 後台房況、每日／月曆、備註、價格矩陣與手機版：完成。
- LINE 正式／test-only Channel Identity 安全硬隔離：完成。
- Conversation Engine V2 已部署至 test-only；短日期 trust boundary 修正 commit：`0c743642b69c9d671410bb44dc1e8b42735c938a`。
- 完整 `npm test`：最近一次驗證 exit 0（V2 generic availability／available-dates schema、property-backed setting catalog、回覆順序回歸後）。
- 真實 test-only LINE 最終驗收：進行中。
- 正式 LINE 切換與真實正式驗收：未開始，需使用者明確授權。

## 永久知識維護規則

- 同一知識只由一份主要文件負責，其他文件使用連結，不複製全文。
- 重大決策 append 到 `DECISIONS.md`，不得改寫既有決策歷史。
- 已驗收且不得退步的行為更新 `PRODUCT_BASELINE.md`。
- 重要 bug 與可重複避免的事件更新 `LESSONS_LEARNED.md`。
- 核心能力或安全邊界的重要 commit 以一句摘要更新 `CHANGELOG_INTERNAL.md`。
- 每次正式驗收或優先順序改變，同步更新本文件與 `NEXT_TASKS.md`。
