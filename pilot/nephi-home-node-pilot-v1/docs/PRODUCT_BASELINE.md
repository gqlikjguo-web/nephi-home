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
- Claim Validator 後只能有一個 final response renderer；其 action 必須與 FinalDecision 完整一致，LINE transport 不得再次決策或改寫內容。
- reply 只能使用已通過 Claim Validator 的候選回答；clarification 只能保留安全回答並依 FinalDecision `missingFields` 追問；handoff 只能保留安全回答與 deterministic 安全文案。
- Claim Validator rejection 或 Composer exception 不得讓被拒候選流入最終回覆；no_reply 必須是空字串、不得呼叫 Composer、不得呼叫 LINE。

## Unknown 與真人轉接

- Unknown 不等於 No；未設定、低信心或資料不完整不得被編造成肯定或否定答案。
- 只有真正需要人工處理的子問題進 scoped review／真人轉接。
- 同一句中已能安全回答的其他子問題仍須回答，不得被單一 handoff 覆蓋。
- 任一流程不得沉默；若無法安全回答，必須有受控補問或安全退路。
- handoff、review、Unknown、房況不可靠與房型無法解析的對客文案必須由 deterministic 安全邊界產生，不得由模型自由改寫。
- 最終回覆不得包含無意義的標點／表情殘片，亦不得加入 Response Plan `allowedFacts` 以外的技術、身分、設備、政策或其他事實。
- Controlled Composer 任一驗證失敗時必須完整退回 deterministic 回覆，不得把部分污染內容送至 LINE。

## Property 與安全隔離

- 所有資料查詢、state、message log、review 與 LINE routing 都必須以 property scope 隔離。
- 不得建立第二個 `nephi_home` 來完成既有旅宿導入。
- `propertyId` query parameter 不是 LINE Channel 身分證明。
- 正式與 test-only Channel、Secret、Token、route 與 environment 必須硬隔離；錯配時 fail fast。

## Baseline 變更門檻

只有通過自動回歸與真實驗收的行為才能加入本文件。若產品決策要改變既有基準，必須先 append 一筆重大決策，說明相容性、風險與回退方式。
## Planner failure diagnostic boundary

- Planner exceptions retain the existing `planner_parse_failed` → FinalDecision handoff → safe fallback → LINE delivery behavior.
- Test-only diagnostics may emit `planner_error` only through an allowlisted schema: error name, fixed code, normalized HTTP status, timeout, safe category, model, provider, and sanitized OpenAI `error.type`, `error.code`, and `error.param`.
- Diagnostic callbacks and loggers are non-authoritative; their exceptions cannot change conversation fallback or delivery.
- Secrets, authorization data, guest content, prompts, source events, property catalogs, provider error messages, raw provider bodies, stacks, request headers, and credentials never enter the safe trace.

## Canonical Temporal Authority

- Planner temporal fields are non-authoritative candidates. Only `resolveCanonicalTemporal()` may produce executable stay dates.
- Canonical temporal status is exactly `absent`, `resolved`, or `unresolved`; a resolved result records the raw expression, expression type, check-in/check-out, property timezone, resolution source, repair reason, and applicable task IDs.
- Relative days, relative weekdays, weekends, absolute dates, ranges, and night counts share one deterministic grammar with an injectable clock and property timezone.
- A current unresolved date intent clears stale stay dates. Prior dates may be reused only through an explicit approved context-reuse path.
- State, FormalRequest, QueryPlan, pending logic, and Executor must not parse, repair, infer, or replace canonical temporal meaning.

## Persistent Planner provider diagnostic boundary

- Test-only `planner_error` records persist only trace ID plus bounded provider attempt/status values, timeout, sanitized provider type/code/param, a fixed safe category, retryability, response-body presence, and parsed-output presence.
- Safe categories are limited to `timeout`, `rate_limit`, `provider_5xx`, `invalid_request`, `empty_response`, `json_parse`, `structured_output`, `network`, and `unknown`.
- Transient provider failures are retried only for `timeout`, `network`, `rate_limit`, and `provider_5xx`, at most once after a short bounded delay. All other failure categories and local contract failures are not retried.
- A successful retry resumes the same Planner validation and runtime pipeline. An exhausted retry does not change the existing `planner_parse_failed` handoff, safe fallback, or LINE delivery behavior.
- Raw provider bodies and messages, prompts, guest content, source identifiers, property data, headers, stacks, API keys, tokens, and credentials never enter the persisted trace.

## Canonical Request authority

- Planner capability, entity, temporal, dependency, and output fields are candidates only.
- `canonicalizeExecutionItem()` is the single active boundary that creates an immutable `CanonicalRequest`.
- The capability registry supplies property-neutral stay dependency, required fields, resolver, risk, and response-mode policy.
- State, FormalRequest, QueryPlan, Executor, ResponsePlan, Claim Validator, and FinalDecision consume canonical values or canonical execution outcomes without selecting a second capability, entity, date, or resolver.
- Property facts remain scoped by `propertyId`; canonical routing never embeds a property name, property ID, price, rule, room number, date, or fixed guest answer.
- Runtime mutation gates reject a second Canonicalizer or a second temporal, capability, entity, or resolver writer.

## Property-neutral onboarding and inventory

- Onboarding property lists and existing-property approvals are restricted by authenticated property membership unless the existing platform-admin grant authorizes platform-wide review.
- Shared JSON and PostgreSQL availability paths accept property-scoped room IDs and formal bundle IDs without assuming a property name, room count, room number, or bundle identifier.
- Updating a formal bundle applies only to its stored member-room relation. A missing bundle relation is rejected rather than inferred.
- Shared PostgreSQL seed logic is explicit, idempotent, and property-parameterized; representative operator fixtures may retain real identifiers but are not runtime routing rules.
- New friendly-operator intake starts only from a platform-admin-issued, expiring and revocable invitation. One token authorizes one staging application; invalid, expired, revoked, or cross-application tokens are rejected.
- Draft save/read-back, idempotent submit, and admin review continue to use the existing onboarding staging and review workflow. No unapproved submission becomes a formal property, guest-facing fact, LINE binding, or automatic-reply source.
