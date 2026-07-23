# JunZan AI 重要產品演進

本文件記錄會改變產品核心能力、安全邊界或長期架構的重要演進，不是逐筆 Git Changelog。細部實作仍以 Git history 為準。
目前狀態與閱讀順序見 [專案記憶入口](PROJECT_MEMORY.md)。

## 2026-07-18 — Controlled Composer 與 handoff 信任邊界

- 將 handoff／review／Unknown 固定於 deterministic 安全文案，並以 `allowedFacts`、有效語意及 Claim Validator 阻止符號殘片與無來源主張進入 LINE 回覆。

## 2026-07-18 — Repository 永久記憶系統

- 建立單一專案記憶入口、不可退步產品基準與 Agent 必讀規則，讓決策、教訓、驗收與重要演進可由 Git 永久追溯。

## 2026-07-18 — V2 短日期 deterministic trust boundary

- 省略年份日期改由 rawText、property timezone 與 event timestamp 決定，Planner candidate 不再能以合法 ISO 格式覆蓋 canonical date；commit：`0c74364`。

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

## 2026-07-19 — V2 通用房況與 property-backed knowledge boundary

- `available_dates` 現在可使用空 entity 的正式 Planner schema，並由 task contract 而非字詞補丁啟動日期範圍 resolver。
- 未指定房型、房型 matched set、property settings catalog、價格 task 與多問題回覆順序均有 V2 回歸覆蓋。

## 維護門檻

只有下列變化應加入本文件：

- Conversation Engine 核心世代變更
- Planner、Resolver、State、Composer 或 Claim Validator 的責任邊界改變
- 可信事實、安全或 property 隔離模型改變
- 會影響所有旅宿的 Shared Core 能力改變

單一 bug fix、文案調整、例行重構與一般 commit 不加入本文件。
# 2026-07-19 — V2 preserves partial stay constraints and blocks stale-date reuse

## 2026-07-22 — Planner semantic contract boundary

- Added deterministic semantic-contract enforcement between structural Planner validation and Resolver execution, covering location tuple consistency, base-versus-eligibility detail intent, local safe downgrade, and multi-task preservation.

## 2026-07-23 — Property-scoped multi-Channel LINE binding

- Added one shared multi-tenant LINE webhook transport backed by encrypted property bindings, while preserving the existing test-only legacy route and the single V2 composition root.

## 2026-07-23 — V2 final decision ownership

- Made Engine `finalDecision` the sole production decision boundary; Response Plan, Controlled Composer, coordinator, and both registered V2 LINE transports can no longer create or infer competing traveler-visible outcomes.

## 2026-07-23 — Canonical pending arbitration

- Moved pending arbitration behind Temporal/canonical slot extraction, made Planner discourse non-authoritative, and unified date, nights, guests, and room-preference continuation before property-scoped Resolver execution.
