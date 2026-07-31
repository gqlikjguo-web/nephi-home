# JunZan AI 精簡受控架構：產品與架構規則

## 唯一核心流程

`客人原文 → AIUnderstanding → Validation/Evidence → Context Manager + Temporal → Formal Query Pipeline → Final Decision/Response/Delivery`

AI 是第一個理解人話的單位，理解錯字、省略、改口、多問題與多輪關聯。程式只驗證完整性、原文 evidence、安全邊界、日期、上下文、正式資料與最終處理；不得以固定句型、關鍵字、regex、task type 或特殊分支重新理解原文。

不得新增 route、composition root、雙核心、shadow decision 或第二套事實來源。所有業者共用同一 Shared Core，正式資料依 `propertyId` 完全隔離。

## 六個實質責任

1. **AIUnderstanding**：由原文產生需求候選、社交訊號、不確定處與 evidence；不得產生日期、state action、正式事實、路由或最終決定。
2. **Validation/Evidence**：驗證 schema、evidence 與需求完整性；語意去重只可使用 AI 已產生的候選，不得自行理解客人意圖或新增需求。
3. **Context Manager**：唯一上下文權威。前置只驗證 AI 提供的候選關聯是否唯一、有效、未過期且 scope 正確；後置依日期結果維護需求生命週期。不得自行選擇「最像」的 pending。
4. **Temporal**：唯一日期權威；依本輪日期表達、經核准的既有日期、event timestamp 與 property timezone 產生 canonical 日期。新的非法、模糊或矛盾日期不得沿用舊日期。
5. **Formal Query Pipeline**：將完整需求轉為正式查詢，依已確認 requestKind 與 propertyId 選授權 capability／資料來源。registry 與 entity resolution 只可對應已確認 requestKind／業者實體 ID，不得改變意圖。Unknown 永遠不等於 No。
6. **Final Decision/Response/Delivery**：唯一決定局部回答、必要澄清、局部 handoff 或 no-reply。AI/Composer 只能用核准 fact references 自然回答。

## 產品行為與安全邊界

- 同一回合的多個獨立需求必完整處理；可同時回答、追問及對必要部分 handoff，彼此不得覆寫。
- 缺欄、日期不明或 Unknown 以安全澄清／說明處理，不得猜正式資料或自動轉真人。
- 無關未完成需求保持 dormant：不主動出現在回答、不追問、不阻擋新需求；客人明確回到該需求或本輪明確依賴時才可使用。
- 正式事實只可從 property-scoped PostgreSQL／授權資料來源取得。每個可說 fact 都必有來源；未核准、無來源或 propertyId 不符的 fact 不得回答。
- 房況、最近可住日期與動態價格每輪正式查詢；固定 catalog 可使用集中設定的 5 分鐘 property-bound cache。時間與保存期限只由單一設定來源提供。
- 日期、上下文與最後處理各只有一個權威。Context Manager 可有前置／後置步驟，但仍是同一權威，不得形成第二套 state action。

## 實作限制

- capability registry 一個 requestKind 一筆正式定義，或使用明確 family schema；不得有「視問題而定」的必要欄位。每筆定義 required/optional fields、日期／人數需求、context reuse、capability、source、freshness、result shape、Unknown/No/error 與 handoff eligibility。
- 一個 FormalRequest 在第一版對應一個 operation 與一個結果 item；複合讀取封裝在授權 capability／adapter，不得由 Engine／Executor 臨時追加。
- coordinator 可合併 events 成一個正式處理回合，但每個 event 只 claim/處理一次，所有來源 events 保留 trace。
- 現有程式若不符本規則，只能列差距與實作方案；不得為遷就舊程式弱化本規則。

## 附錄：資料契約與追蹤細節（非決策權）

以下只用於追蹤、隔離、驗證、防重複與可稽核性，不能產生語意判斷：`eventId/messageRef`、`turnRequestId`、`requestCycleId`、`pendingRequestId`、`formalRequestId`、`operationId`、`factId`、trace、source metadata、enum、cache TTL、required fields。

- evidence 必含來源 event/message、offset 與 quote；burst 合併後仍可回驗原訊息。
- cycle 保存已回答與未完成的邏輯需求；pending 僅是缺欄附屬狀態。answered context reuse 使用集中設定的 24 小時；ended/expired 不可承接。
- 欄位資料格式為 value、有效性、來源、原始 turn refs 與必要 rule/derived refs；其目的只在區分 explicit/context/defaulted/derived 與 missing/uncertain/invalid/confirmed。
- 每個 fact 有自己的 property-scoped source metadata；FinalDecision 用 fact refs，ResponsePlan 用 allowed fact refs，Composer 不得越權。
