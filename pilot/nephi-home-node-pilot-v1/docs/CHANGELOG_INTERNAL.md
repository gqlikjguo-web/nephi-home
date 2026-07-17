# JunZan AI 重要產品演進

本文件記錄會改變產品核心能力、安全邊界或長期架構的重要演進，不是逐筆 Git Changelog。細部實作仍以 Git history 為準。

## 2026-07-18 — LINE 正式／test-only 安全硬隔離

- 建立 Channel Identity、Environment、Secret fingerprint 與 Webhook route 的一致性驗證。
- 錯配時在服務啟動階段 fail fast。
- Webhook payload destination 必須符合設定的 Channel Identity，不再以 `propertyId` 作為 Channel 身分證明。
- 參考 commit：`dd90aa1`

## 2026-07-17～2026-07-18 — Conversation Engine V2

- 建立 Planner V2、deterministic validation、versioned state reducer、property entity resolution、multi-task capability executor、Response Plan、Controlled Composer 與 Claim Validator 的完整鏈路。
- 將一句多問題由單一 intent 處理提升為多 task 規劃與覆蓋驗證。
- 補強主要住宿需求優先排序、所有 task 完整合成，以及缺失 task 不得送出的 coverage 規則。
- 統一房型群組房況解析與省略年份的未來日期解析。
- 參考 commits：`f28f6e4`、`8ec5e3e`、`0e7ab8b`、`97aa504`、`6822516`

## 維護門檻

只有下列變化應加入本文件：

- Conversation Engine 核心世代變更
- Planner、Resolver、State、Composer 或 Claim Validator 的責任邊界改變
- 可信事實、安全或 property 隔離模型改變
- 會影響所有旅宿的 Shared Core 能力改變

單一 bug fix、文案調整、例行重構與一般 commit 不加入本文件。
