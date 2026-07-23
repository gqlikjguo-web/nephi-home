# JunZan AI 下一步任務

目前狀態與完成定義見 [專案記憶入口](PROJECT_MEMORY.md)，不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。本文件只保存尚未完成且有明確順序的工作。

## 目前順序

1. 建立 platform-admin LINE binding 管理 UI：安全輸入／輪替 credential、顯示 webhook URL、設定狀態與啟用／停用；不得提供 credential 或密文讀回。
2. 經另行授權後部署 property-scoped LINE binding migration 與 runtime，再以兩個 test-only Channel 驗收隔離；本次不得部署。
3. 部署目前通用 V2 語意修正至 test-only，並以真實 LINE 驗收最近可住、指定日期、房型類別與多問題回覆。
4. 由使用者在後台切換 7/18 的 301：
   - 可售後，下一次 LINE 查詢立即回答有房。
   - 不可售後，下一次 LINE 查詢立即回答無房。
5. 真實 test-only LINE 驗收 `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？`，確認三個 task 都回答且住宿需求優先。
6. 驗收 Conversation State 修改鏈：
   - `兩個人住兩晚，要有浴缸`
   - `改四個人`
   - `不用浴缸了，那多少錢？`
7. test-only 全部通過後建立正式切換前回退點。
8. 只有取得使用者逐次明確授權後，才執行正式 LINE webhook 切換與真實正式驗收。

## 不得提前執行

- test-only 驗收未完成前，不得宣稱第一版完成。
- 未建立回退點前，不得切正式 LINE。
- 未經使用者明確授權，不得修改正式 LINE、Render、環境變數、資料庫、Secret 或 Token。

## 2026-07-23 更新

1. 將已通過完整自動回歸的 V2 final-decision 收斂部署至 `nephi-home-node-pilot-test-only`。
2. 確認 test-only Live commit、health `200`、`status=ready`、`testOnly=true`。
3. 由使用者在 test-only 真實 LINE 驗收 acknowledgement、pending 補值、Unknown、同句多問題與 property-scoped 雙 Channel；正式環境維持不變。

## 2026-07-23 pending canonical 仲裁更新

1. 部署已通過完整回歸的 pending canonical 仲裁至 `nephi-home-node-pilot-test-only`。
2. 確認 Live commit、health `200`、`status=ready`、`testOnly=true`。
3. 由使用者依序重測「房況缺日期 → 下一輪只補日期」，確認執行原 `availability`，不再進入預設 `available_dates` 範圍搜尋。
4. 補測日期、晚數、人數、房型、acknowledgement 加有效問題，以及明確日期範圍搜尋；正式環境維持不變。

## 2026-07-23 dialogue-act／temporal 有限修正更新

1. 部署已通過完整回歸的 dialogue-act semantic contract、canonical Temporal 與 stale-date Resolver gate 至 `nephi-home-node-pilot-test-only`。
2. 確認 Live commit、health `200`、`status=ready`、`testOnly=true`。
3. 由使用者以乾淨對話依序驗收一般社交訊息、相對日期、`7/25` 明確房況、房型 follow-up、訂房可行性與無法解析日期。
4. 真實 LINE 驗收前不得宣稱第一版完成；正式 LINE、正式 credential、正式 webhook 與正式 Render service 維持不變。
