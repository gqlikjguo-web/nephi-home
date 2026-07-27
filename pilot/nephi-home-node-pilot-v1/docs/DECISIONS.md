# JunZan AI 重大產品決策

本文件只記錄跨版本仍有效、會約束後續產品與架構的重大決策。最高原則以 [JunZan AI 核心產品憲法](JUNZAN_AI_CONSTITUTION.md) 為準。

## D-001：AI 負責理解，不負責創造事實

**決策：** AI 負責理解自然語言、上下文、修改、取消、多問題與任務規劃，並在受控範圍內自然組句。

**理由：** 自然語言具有大量口語與語意變體，適合由 AI 理解；房況、價格、設備與政策則需要可驗證、可追溯的確定性。

**長期後果：** AI 輸出必須先結構化並接受 deterministic validation，不能直接成為旅宿事實或承諾。

## D-002：Resolver 是唯一可信事實來源

**決策：** 所有對客事實與可執行結果都必須由 Resolver 根據業者授權資料產生。

**理由：** 將理解與事實判定分開，才能避免模型猜測、確保 property 隔離，並讓每個回答可測試與追溯。

**長期後果：** Composer 只能使用 Resolver 經 Response Plan 提供的可信結果；Model 不得繞過 Resolver。

## D-003：Unknown 不等於 No

**決策：** 缺少資料、低信心或無法安全解析時，結果必須是 Unknown，不能轉換成否定答案。

**理由：** 「不知道」與「沒有」是不同事實；錯誤否定會誤導客人並替業者做出未授權承諾。

**長期後果：** Unknown 必須觸發安全說明、必要補問或局部真人處理，不得被 Composer 改寫成確定結論。

## D-004：不以 regex／keyword patch 擴充自然語言能力

**決策：** 不為個別說法持續加入 regex、keyword、substring 或單句特殊 case。

**理由：** 逐句補丁無法覆蓋自然語言變體，會造成規則衝突、維護成本上升及不可預測的 routing。

**長期後果：** 語意變體由 Planner 的通用理解承接；程式規則只負責格式驗證、安全邊界與確定性解析。

## D-005：Shared Core 不因單一業者修改

**決策：** 所有旅宿共用同一套 Conversation Engine；單一旅宿差異只能存在於 property、房型、設備、規則與 alias 資料。

**理由：** 業者專用分支會破壞 SaaS 通用性、增加交叉污染風險，並讓核心能力無法一致驗證。

**長期後果：** 新業者導入不得新增專用 if／else；若需求不能以通用能力或 property 資料表達，必須先重新檢查模型邊界。

## D-006：Planner candidate 不是 canonical fact

**決策：** Planner 提取的日期、房型、人數與其他 entity 都只是候選理解；只有通過 deterministic validation、property entity resolution 與 Resolver 查詢後，才能進入 canonical request 或成為對客事實。

**理由：** 結構格式合法不代表語意正確。真實 Planner 曾把省略年份的 `7/18` 產生為 `2056-07-18`；若直接信任 candidate，會查錯資料範圍並把可回答問題錯誤轉真人。

**長期後果：** 邊界層必須以原始語意、property timezone、事件時間與允許範圍交叉驗證 candidate；無法驗證時使用 clarification 或 Unknown，不得靜默採用。

## D-007：Repository 是專案唯一永久記憶

**決策：** 專案現況、已驗收基準、重大決策、安全規則、經驗教訓與重要演進必須保存在 Repository；聊天與 Agent session 不構成專案事實。

**理由：** 對話會分散、壓縮或失去上下文，且無法像 Git 一樣審查、追溯與共同維護。

**長期後果：** 每個 Agent 任務先讀 `AGENTS.md` 指定的核心文件；重大決策、重要 bug 與正式驗收必須在同一工作流程中更新對應文件。

## D-008：Controlled Composer 只能表達可信結果

**決策：** Controlled Composer 只負責自然表達 Response Plan 已提供的 `allowedFacts`；handoff、review、Unknown 與不可靠結果一律使用 deterministic 安全文案。任何語意、grounding、handoff 或 claim validation 失敗都必須退回 deterministic 回覆。

**理由：** JSON schema 合法且文字非空，不代表內容有意義或可信。模型曾在正常回覆後產生符號殘片及無來源的技術身分文字，現有 coverage 檢查無法阻止這類污染。

**長期後果：** AI 不得覆蓋安全邊界、引入 Response Plan 以外的事實或替真人轉接自由造句；trace 只能記錄安全的驗證結果與原因碼，不記錄客人內容或敏感資料。

## D-009：通用房況不以詞彙判斷，最近可住由 Planner task 表達

**決策：** Planner 對未指定房型的房況需求輸出空 entity；對最近可住需求輸出 `available_dates` task。Executor 只根據 task type、entity category 與 property metadata 執行，不以「空房」等字詞清單判斷語意。

**理由：** 詞彙清單會把 Shared Core 退化成關鍵字補丁，且無法承接不同說法。`available_dates` 是明確能力，應由 Planner 表達後經 schema、state 與 property-scoped resolver 完整執行。

**長期後果：** 空 entity 對 `availability` 與 `available_dates` 是合法 schema；模糊房型不會變成單一房號，類別房型仍由 property metadata 解析為完整 matched set。

## D-010：LINE Channel binding 是 property 的可信邊界

**決策：** 多業者 LINE webhook 先以不可猜測的 webhook key 找到唯一 binding，再使用該 binding 的 Channel Secret 驗證原始 request body；只有驗簽成功後，runtime 才能信任 binding 綁定的 property，並以同一 binding 的 Access Token 回覆。

**理由：** query string、request body 與 LINE destination 在驗簽前都不是可信 property 身分。service-wide credential 也無法在同一 service 中安全隔離多個 Channel。

**長期後果：** 新業者不需要獨立 Render service；credential 必須以環境金鑰加密後 property-scoped 保存，管理 API 不得回傳明文或密文。legacy test-only route 僅保留既有尼腓相容性，不得供新業者使用。

## D-011：FinalDecision 是最終回覆 action 與內容的共同權威

**決策：** Claim Validator 完成候選文字安全檢查後，所有對客文字必須經唯一的 final response renderer。renderer 只能消費既有 FinalDecision、Response Plan、已驗證候選文字與 Claim Validation 結果，輸出的 action 必須等於 `finalDecision.action`；不得建立第二套 action 判斷。

**理由：** FinalDecision 若只控制 transport action，而 transport 仍直接沿用更早產生的候選文字，claim rejection、handoff、clarification 或 no_reply 可能送出與最終決策不一致的內容。

**長期後果：** reply 只可送出已驗證候選；clarification 只保留安全回答並依 `missingFields` 追問；handoff 只保留安全回答與 deterministic fallback；no_reply 固定空字串且不呼叫 Composer。LINE transport 只消費 Engine 的 final response，不得再次 render 或改寫。
## D-012 — Planner failure diagnostics are allowlisted and behavior-neutral

**Decision:** A Planner exception may emit one structured `planner_error` diagnostic containing only an allowlisted error name, fixed code, normalized HTTP status, timeout flag, safe category, model, provider, and sanitized OpenAI `error.type`, `error.code`, and `error.param` fields.

**Reason:** The previous catch converted every exception to `planner_parse_failed` without preserving enough safe evidence to distinguish authentication, rate-limit, provider, timeout, parse, empty-response, configuration, and unknown failures.

**Constraint:** Diagnostics must never include messages, prompts, source events, catalogs, response bodies, headers, stacks, tokens, or credentials. The three provider fields are string-only, character-allowlisted, length-limited, and empty when invalid or unavailable. Diagnostic failures are isolated and must not alter the existing `planner_parse_failed` handoff, final response, persistence, or LINE delivery.

## D-013 — Canonical Temporal Authority owns executable dates

**Decision:** Planner temporal fields are candidates only. One `resolveCanonicalTemporal()` boundary receives the guest message, Planner temporal candidate, event timestamp, property timezone, and applicable task IDs, and emits the only executable temporal result with status `absent`, `resolved`, or `unresolved`.

**Reason:** Planner labels and candidate dates can be inconsistent, while State and FormalRequest previously had fallback paths that could preserve or reintroduce stale executable dates. This allowed identical relative-date requests to diverge after planning.

**Constraint:** State may persist but not reinterpret the canonical result. FormalRequest, QueryPlan, pending-state logic, and Executor may only consume it. An unresolved current temporal intent expires prior stay dates. Relative days, relative weekdays, weekends, absolute dates, ranges, and night counts use the same property-timezone-aware grammar and injectable clock.
