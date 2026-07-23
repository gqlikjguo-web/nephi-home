# JunZan AI 已驗收產品基準

本文件記錄已驗收、後續版本不得退步的第一版行為。它描述外部可觀察結果，不重複架構原理；產品原則見 [核心產品憲法](JUNZAN_AI_CONSTITUTION.md)，原因見 [重大決策](DECISIONS.md)。

## 房況與後台一致性

- 後台房況資料庫是唯一事實來源；AI 不得猜測房況。
- 每次查房都必須讀取該 property 最新房況，不得沿用舊回答、state、cache 或 snapshot。
- 後台把某日某房型設為可售後，下一次查詢立即反映有房。
- 將同一筆設為不可售後，下一次查詢立即反映無房。
- 相同 DB 狀態與相同條件必須得到 deterministic 結果。
- 缺列或資料不可靠是 Unknown，不得回答成無房。

## 日期與住宿條件

- 單一日期房況詢問預設一晚，checkout 由 deterministic code 推導為隔日。
- 省略年份的月日依 property timezone、LINE event timestamp 與最近合理未來日期解析。
- Planner 日期 candidate 只是候選值；canonical 日期必須由 deterministic validation 確認。
- 明確提供的合法年份不得被擅自改成年份省略規則。
- 跨月、跨年與多晚日期範圍必須保持一致且可驗證。
- 補充、修改或取消日期、人數與房型後，Conversation State 必須重新整合有效條件。

## 房型、容量與包棟

- 明確房型如 `301` 必須解析到該 property 的同一個 room type，不得隨機轉人工。
- 房型語意可對應多個符合房型；雙人房、四人房與包棟不得互相混入。
- 回覆使用業者設定的公開名稱，不得暴露 room ID、bundle ID 或內部備註。
- 人數與容量篩選必須使用 property 資料；AI 不得自行判定容量事實。

## Conversation Engine

- 一句多問必須建立多個 task，主要住宿需求優先，但所有 task 都要有結果。
- 多輪補充、修改與清除必須經 versioned state reducer，舊 state 不得污染新需求。
- 相同輸入與相同事實來源不得因 Planner 或 Composer 變異而漏答、沉默或改變事實。
- 回覆只能使用 Response Plan 的可信 facts；Claim Validator 必須阻止未覆蓋或無來源的主張。
- pending 仲裁必須發生在 Temporal 與 canonical slot extraction 之後；Planner `discourse.relation` 不得單獨決定延續或取代 pending。
- 本輪有效日期、晚數、人數或房型若可填入 pending missing fields，必須保留原 capability、重算剩餘欄位，並在補齊後重新查詢 property-scoped Resolver。
- pending `availability` 缺入住日時，單一 canonical 日期不得因候選 task 為 `available_dates` 而啟動預設 31 天搜尋；只有明確日期範圍搜尋才能取代。
- 無有效補值且無有效新需求時不得重播舊 clarification；acknowledgement 仍由 Engine 決定 `no_reply`。

## Unknown 與真人轉接

- Unknown 不等於 No；未設定、低信心或資料不完整不得被編造成肯定或否定答案。
- 只有真正需要人工處理的子問題進 scoped review／真人轉接。
- 同一句中已能安全回答的其他子問題仍須回答，不得被單一 handoff 覆蓋。
- 任一流程不得沉默；若無法安全回答，必須有受控補問或安全退路。
- handoff、review、Unknown、房況不可靠與房型無法解析的對客文案必須由 deterministic 安全邊界產生，不得由模型自由改寫。
- 最終回覆不得包含無意義的標點／表情殘片，亦不得加入 Response Plan `allowedFacts` 以外的技術、身分、設備、政策或其他事實。
- Controlled Composer 任一驗證失敗時必須完整退回 deterministic 回覆，不得把部分污染內容送至 LINE。
- Engine 的結構化 `finalDecision` 是 V2 唯一使用者可見行為來源，且只允許 `reply`、`clarification`、`human_handoff`、`no_reply`。
- `no_reply` 不得建立 Response Plan、呼叫 Composer或送出 LINE；Response Plan 與 Composer 均不得從 task status、coverage gap、空內容或生成失敗另行推導行為。
- clarification 只能使用 Engine 核准的缺少欄位，human handoff 只能使用 Engine 核准的原因，reply 只能使用 Engine 核准的正式 facts。

## Property 與安全隔離

- 所有資料查詢、state、message log、review 與 LINE routing 都必須以 property scope 隔離。
- 不得建立第二個 `nephi_home` 來完成既有旅宿導入。
- `propertyId` query parameter 不是 LINE Channel 身分證明。
- 正式與 test-only Channel、Secret、Token、route 與 environment 必須硬隔離；錯配時 fail fast。

## Baseline 變更門檻

只有通過自動回歸與真實驗收的行為才能加入本文件。若產品決策要改變既有基準，必須先 append 一筆重大決策，說明相容性、風險與回退方式。
