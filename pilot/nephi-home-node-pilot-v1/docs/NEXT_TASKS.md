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

## 2026-07-26 Phase 6 local transport E2E

- 已完成：FinalDecision 與 LINE transport action 對齊；reply／clarification／handoff 的成功與失敗、以及 no_reply 均由 E2E runner 驗證。
- 未完成：真實 test-only LINE 驗收仍依上列既定項目執行；本次未部署、未切換 LINE、未接觸 credentials。

## 2026-07-26 Phase 7 final response authority

- 已完成：唯一 final response renderer 讓 FinalDecision 同時控制 action 與最終內容；reply／clarification／handoff／no_reply、claim rejection 與 Composer exception 均有自動驗證。
- 已完成：signed webhook E2E 經既有 Coordinator、ConversationEngineV2 與 LINE mock 驗證六條路徑；runtime uniqueness 為 28/28，完整 `npm test` exit 0。
- 未完成：真實 test-only LINE 驗收仍依上列既定項目執行；本次未部署、未切換 LINE、未接觸 credentials。

## 不得提前執行

- test-only 驗收未完成前，不得宣稱第一版完成。
- 未建立回退點前，不得切正式 LINE。
- 未經使用者明確授權，不得修改正式 LINE、Render、環境變數、資料庫、Secret 或 Token。
