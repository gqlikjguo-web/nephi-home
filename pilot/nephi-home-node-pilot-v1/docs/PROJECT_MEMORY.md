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
- 多業者共用 service 的 property-scoped LINE binding 核心與最小 platform-admin API 已完成自動驗證；尚缺總後台 LINE 管理 UI，且本次未部署。

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

## 2026-07-23 V2 final decision 收斂狀態

- Engine 已成為 V2 唯一 `finalDecision` 擁有者；Response Plan、Controlled Composer 與兩條已註冊 LINE transport 的競爭決策能力已移除。
- pending 與 follow-up 不再改寫本輪 Planner task；測試中的 follow-up context 必須由 Planner 輸出明確 candidate，不再依賴 state 覆寫。
- 完整 `npm test` 已自然 exit 0；下一步只剩 test-only 部署驗證與真實 LINE 人工驗收，正式環境仍未授權。

## 2026-07-23 pending canonical 仲裁狀態

- 已證實並修正 pending `availability` 遇到 Planner 候選 `available_dates/new_request` 時，在 canonical slot matching 前被放棄的問題。
- 新順序為 Planner／semantic contract → Temporal／canonical slots → pending arbitration → merge／missing fields recomputation → Engine finalDecision → Resolver／Composer／LINE。
- 單一日期、晚數、人數與房型共用同一 missing-field matching 契約；明確日期範圍搜尋與完整新需求仍可取代 pending。
- 新增 production HTTP route 黑箱回歸與安全日期診斷；完整 `npm test` 已自然 exit 0。下一步是 test-only 部署後由使用者重測原真實訊息順序。

## 2026-07-23 dialogue-act／temporal 最終有限修正狀態

- acknowledgement 與 task／`shouldIgnore` 的矛盾已由 semantic contract 收斂；無可信 substantive task 時不再進 Executor，同句有效住宿問題仍保留。
- Temporal 已將 Planner `kind` 降為候選，建立 absent／resolved／unresolved 的 canonical 日期意圖；明確日期嘗試解析失敗時，state reducer 清除舊 stay 日期且 Resolver gate 不建立預設日期範圍。
- 使用 production Planner output shape 的完整鏈回歸已涵蓋錯標相對日期、舊日期污染、合法房型 follow-up、相對日期與訂房可行性；完整 `npm test` 自然 exit 0。
- 核心修正 commit `34c5faa599fdfdac25a4320248e0963ef6b66d3e` 已部署至 test-only，health 為 HTTP 200／`ready`／`testOnly=true`。
- 第一版仍未完成；下一步由使用者執行最後一次真實 LINE 驗收，正式環境維持未授權。
