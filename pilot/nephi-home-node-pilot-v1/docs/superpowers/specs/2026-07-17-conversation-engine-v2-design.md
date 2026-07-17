# JunZan AI Conversation Engine v2 Design

## Goal

在 test-only feature flag 後，以單一版本化流程取代單意圖主導路徑：理解自然語言與多輪修改，但所有房況、價格、容量、設備與政策事實都由 property-scoped deterministic resolver 產生。

## Architecture

`LINE → Planner v2 → validation → state reducer → entity resolution → multi-task executor → response plan → controlled composer → claim validator → reply/scoped review`

- Planner v2 只輸出語意、tasks、候選、歧義及 state operations，不決定事實。
- Property catalog 只含公開資料、canonical ID、公開 alias 與 yes/no/unknown 狀態。
- Temporal resolver 以 LINE event timestamp 和 property timezone 為基準，AI 日期候選仍須驗證。
- Versioned state 保存有效條件與本輪 set/replace/clear/keep；舊 state 無法安全轉換時清空。
- Capability executor 對各 task 獨立回傳 answered、clarification、missing、human 或 failed，支援部分成功及 scoped review。
- Composer 只能使用 response plan facts；claim validator 阻擋無來源事實、越權承諾、跨 property 與內部內容。

## Migration and rollback

- 新引擎僅由 `TEST_ONLY_CONVERSATION_ENGINE_V2` 控制，正式 LINE 不切換。
- 不新增 migration；state v2 使用現有 JSON state 欄位，review/message logs 使用既有 persistence contract。
- 先完成 v2 測試與 test-only 接線，再移除 v2 路徑對舊 intent/substr fallback 的依賴；legacy 路徑只作短期 feature-flag 回滾。
- 任一階段可關閉 flag 或回退至 `62d0cb0`；不需資料回滾。

## Verification

以 understanding、state transition、resolver、end-to-end 四層能力矩陣驗證語意變體、多問、三組指定多輪、partial success、property isolation、prompt injection、forbidden claims、去重及所有正常流程不沉默。真實 test-only LINE 驗收前只回報自動測試狀態，不宣稱端到端正式完成。
