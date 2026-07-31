# JunZan AI 精簡受控架構：原地替換實作計畫

本文件只對照實作責任；產品規則唯一來源是 [CONTROLLED_ARCHITECTURE_RULES.md](CONTROLLED_ARCHITECTURE_RULES.md)。本輪不改程式、測試、部署或 Git history。

## 原地替換範圍

保留唯一 V2 composition root、coordinator、PostgreSQL、正式 provider、property scope 與 LINE transport。coordinator 只負責 event claim、去重與合併；不做語意、日期、上下文或回答決定。不得新增 route、feature flag 或平行核心。

## 六個實作責任

1. **AI understanding**：把既有 Planner 限縮為原文候選與 evidence；移除所有 AI control 欄位。
2. **Validation/evidence**：驗證 schema、event-level evidence、完整性與候選關聯；不得以 regex、keywords、task type 或特殊分支重做理解。
3. **Context manager**：唯一管理 request cycles、缺欄 pending、scope、期限與可承接 context；只驗證 AI candidate links，不能自行猜最相近需求。
4. **Temporal**：唯一日期 module；在 Context Manager 前置驗證後處理日期，結果再交回同一 Context Manager 定案。
5. **Formal query pipeline**：由已確認 requestKind、propertyId 與 registry 產生 query；registry/entity resolution 只做資料對應。facts 保留逐項來源並只以 fact refs 下游傳遞。
6. **Final decision/response/delivery**：單一 FinalDecision 產生局部 reply/clarification/handoff/no-reply；Composer 只消費核准 facts。

## 接線與驗收 checkpoint

- 先建立資料契約 schema 與 registry completeness 檢查，再接 runtime。
- 接入 AI understanding 後，證明任何 AI 控制欄位、錯誤 evidence 或無來源 fact 均被拒絕。
- 接入 Context/Temporal 後，證明日期、上下文、最終處理都只有一個權威，且無關 pending 不干擾新需求。
- 接入 query pipeline 後，證明 property isolation、Unknown ≠ No、freshness 與 fact provenance。
- 接入 FinalDecision 後，證明多問題局部處理、固定呈現順序與 Composer fact reference 限制。
- 原地移除舊 Planner control、engine 內日期預設／pending branch、task-status 直接決定回答的控制權。

## 舊測試與 legacy

舊 V2 測試分為永久安全護欄、舊實作細節、與新規則衝突三類；只保留第一類，第二類改寫為不變量，第三類以證據淘汰。最終完整 `npm test` 必須 exit 0。

現行 active root 只建立一個 `ConversationEngineV2`；已證實 return 後 legacy construction 不可達，未證實前不列為本輪必要修改。回退只用 test-only deployment commit rollback，不保留 runtime 旁路。
