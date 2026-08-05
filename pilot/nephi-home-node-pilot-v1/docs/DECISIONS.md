# JunZan AI 重大產品決策

本文件只記錄跨版本仍有效、會約束後續產品與架構的重大決策。最高原則以 [JunZan AI 核心產品憲法](JUNZAN_AI_CONSTITUTION.md) 為準。

## 現行決策狀態

下表是目前唯一的 ID／狀態索引。`active` 表示決策仍有效；`refined by` 只增加後續約束，不代表原決策被取代。原始決策正文保留在下方；重複舊編號與未編號舊標題依 crosswalk 改用唯一新 ID，但同時逐字保存原始標題以供追溯。

| ID | Status | Relationship |
|---|---|---|
| D-001 | active | — |
| D-002 | active | — |
| D-003 | active | — |
| D-004 | active | — |
| D-005 | active | — |
| D-006 | active | — |
| D-007 | active | — |
| D-008 | active | — |
| D-009 | active | — |
| D-010 | active | — |
| D-011 | active | refined by D-025 |
| D-012 | active | — |
| D-013 | active | refined by D-027 |
| D-014 | active | — |
| D-015 | active | — |
| D-016 | active | — |
| D-017 | active | — |
| D-018 | active | — |
| D-019 | active | — |
| D-020 | active | — |
| D-021 | active | — |
| D-022 | active | — |
| D-023 | active | — |
| D-024 | active | — |
| D-025 | active | refines D-011 |
| D-026 | active | — |
| D-027 | active | refines D-013 |
| D-028 | active | — |
| D-029 | active | — |
| D-030 | active | — |
| D-031 | active | — |
| D-032 | active | — |
| D-033 | active | — |

## 舊標題到唯一 ID crosswalk

| 原始標題／日期（verbatim） | 唯一 ID | Status / relationship |
|---|---|---|
| `D-011：FinalDecision 是最終回覆 action 與內容的共同權威` | D-025 | active; refines D-011 |
| `D-012 — Planner failure diagnostics are allowlisted and behavior-neutral` | D-026 | active |
| `D-013 — Canonical Temporal Authority owns executable dates` | D-027 | active; refines D-013 |
| `2026-07-28 — Property-neutral runtime data authority` | D-028 | active |
| `2026-07-29 — Onboarding intake starts from a scoped invitation` | D-029 | active |
| `2026-07-29 — Test-only onboarding URLs are deployment-scoped` | D-030 | active |
| `2026-07-29 — One-time property-scoped LINE setup authority` | D-031 | active |

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

## D-011：Engine 是 V2 唯一 final decision 擁有者

**決策：** V2 Engine 必須明確產生 `reply`、`clarification`、`human_handoff` 或 `no_reply` 其中一種結構化 `finalDecision`。Response Plan 只能整理 Engine 核准的 task results、facts、clarification fields 與 handoff reason；Controlled Composer 只能表達這些核准內容；LINE transport 只執行 `finalDecision`。

**理由：** task status、coverage gap、空 section、Composer failure 或 transport exception 若各自能改變旅客結果，會形成互相競爭的決策出口，讓 pending、Unknown 與安全 fallback 的行為無法追溯。

**長期後果：** `no_reply` 不建立 Response Plan、不呼叫 Composer且不送 LINE；Response Plan 不得合成缺漏 task 或升級 fallback；Composer 不得自行追問、轉真人或產生全域 fallback；Composer 失敗只由 Engine 決定是否採用已核准的 deterministic 表達。新能力不得新增平行 Decision 層。

## D-012：本輪候選語意與 pending 必須由 canonical slot 仲裁

**決策：** Planner 的 task 與 discourse 只構成本輪候選語意。受控核心必須先完成 Temporal 與 canonical slot extraction，再依 pending capability、missing fields、已驗證 slots，以及本輪是否形成獨立完整需求，決定延續、取代、保留 pending 或 `no_reply`。`discourse.relation` 不得單獨否決有效補值。

**理由：** 真實 runtime 曾在 pending `availability` 缺 `stay.checkIn` 時，把下一輪日期候選分類成 `available_dates/new_request`；舊流程在 slot matching 前直接放棄 pending，造成有效日期完全未被檢查並錯誤執行 31 天日期搜尋。

**長期後果：** 日期、晚數、人數與房型共用同一 canonical matching 契約；單一日期若能填入 pending `stay.checkIn`，不得只因候選 task 是 `available_dates` 而取代原 capability。只有明確日期範圍搜尋或其他完整新需求可取代 pending；無有效補值且無有效新需求時不得重播舊 clarification。

## D-013：Dialogue act 與日期意圖必須先通過跨欄位 semantic contract

**決策：** Planner 的 `discourse.relation`、task、`shouldIgnore` 與日期 `kind` 都只是彼此需要交叉驗證的候選。acknowledgement 沒有可由 property catalog 或住宿 capability 證實的 substantive task 時，不得進 Executor；日期則必須形成 canonical temporal input，並明確區分本輪無日期意圖、已解析及解析失敗。

**理由：** 真實 Planner 曾把一般社交訊息同時標成 acknowledgement 與 `unknown`／`property_fact`，也曾把相對日期標為 `absolute` 且不提供 candidate。若 routing 信任任一單欄位，會把社交訊息錯誤轉真人，或在日期解析失敗後沿用舊 state 查詢錯誤日期。

**長期後果：** 純 acknowledgement 由 Engine 形成安全 `no_reply`，同句有效住宿問題仍保留；Temporal 以 LINE event timestamp 與 property timezone 解析受驗證的 canonical input。任何明確日期嘗試若 unresolved，不得取得預設日期範圍、不得承接舊 stay 日期，也不得呼叫房況 Resolver；無日期意圖的合法 follow-up 才能沿用既有住宿日期。
## D-025：FinalDecision 是最終回覆 action 與內容的共同權威

**原始標題（verbatim）：** `D-011：FinalDecision 是最終回覆 action 與內容的共同權威`

**決策：** Claim Validator 完成候選文字安全檢查後，所有對客文字必須經唯一的 final response renderer。renderer 只能消費既有 FinalDecision、Response Plan、已驗證候選文字與 Claim Validation 結果，輸出的 action 必須等於 `finalDecision.action`；不得建立第二套 action 判斷。

**理由：** FinalDecision 若只控制 transport action，而 transport 仍直接沿用更早產生的候選文字，claim rejection、handoff、clarification 或 no_reply 可能送出與最終決策不一致的內容。

**長期後果：** reply 只可送出已驗證候選；clarification 只保留安全回答並依 `missingFields` 追問；handoff 只保留安全回答與 deterministic fallback；no_reply 固定空字串且不呼叫 Composer。LINE transport 只消費 Engine 的 final response，不得再次 render 或改寫。
## D-026 — Planner failure diagnostics are allowlisted and behavior-neutral

**原始標題（verbatim）：** `D-012 — Planner failure diagnostics are allowlisted and behavior-neutral`

**Decision:** A Planner exception may emit one structured `planner_error` diagnostic containing only an allowlisted error name, fixed code, normalized HTTP status, timeout flag, safe category, model, provider, and sanitized OpenAI `error.type`, `error.code`, and `error.param` fields.

**Reason:** The previous catch converted every exception to `planner_parse_failed` without preserving enough safe evidence to distinguish authentication, rate-limit, provider, timeout, parse, empty-response, configuration, and unknown failures.

**Constraint:** Diagnostics must never include messages, prompts, source events, catalogs, response bodies, headers, stacks, tokens, or credentials. The three provider fields are string-only, character-allowlisted, length-limited, and empty when invalid or unavailable. Diagnostic failures are isolated and must not alter the existing `planner_parse_failed` handoff, final response, persistence, or LINE delivery.

## D-027 — Canonical Temporal Authority owns executable dates

**原始標題（verbatim）：** `D-013 — Canonical Temporal Authority owns executable dates`

**Decision:** Planner temporal fields are candidates only. One `resolveCanonicalTemporal()` boundary receives the guest message, Planner temporal candidate, event timestamp, property timezone, and applicable task IDs, and emits the only executable temporal result with status `absent`, `resolved`, or `unresolved`.

**Reason:** Planner labels and candidate dates can be inconsistent, while State and FormalRequest previously had fallback paths that could preserve or reintroduce stale executable dates. This allowed identical relative-date requests to diverge after planning.

**Constraint:** State may persist but not reinterpret the canonical result. FormalRequest, QueryPlan, pending-state logic, and Executor may only consume it. An unresolved current temporal intent expires prior stay dates. Relative days, relative weekdays, weekends, absolute dates, ranges, and night counts use the same property-timezone-aware grammar and injectable clock.

## D-014 — Planner provider failure diagnostics are persistent and allowlisted

**Decision:** Test-only application logs may persist a `planner_error` record keyed by trace ID with only the approved provider-attempt, HTTP, timeout, sanitized provider error, category, retryability, response-body-presence, and parsed-output-presence fields.

**Reason:** A generic `planner_parse_failed` outcome did not distinguish transient provider failures from invalid requests, empty responses, parse failures, structured-output failures, or network failures after the original exception boundary completed.

**Constraint:** The diagnostic boundary performs no retry and changes no Planner request or fallback behavior. Raw bodies, provider messages, prompts, guest text, source identifiers, headers, secrets, credentials, property data, and stacks must not enter the error object or persisted trace.

## D-015 — Planner provider retry is finite and category-gated

**Decision:** One Planner classification may make at most two provider requests. Attempt two is allowed only when attempt one is safely classified as `timeout`, `network`, `rate_limit`, or `provider_5xx`, and follows a short bounded delay.

**Reason:** A real stability replay showed one isolated retryable timeout while the other 139 executions and every downstream contract remained healthy. Treating that transient provider failure as immediately final caused an avoidable safe handoff.

**Constraint:** Invalid requests, non-429 4xx responses, empty responses, JSON parse failures, structured-output failures, configuration/unknown failures, and local schema or contract failures are never retried. A successful second attempt uses only its valid output. A failed second attempt preserves `planner_parse_failed`, safe handoff, and existing delivery. Diagnostics remain allowlisted and must not retain prompts, guest content, raw provider responses, headers, secrets, property data, or stacks.

## D-016 — Canonicalizer is the sole executable semantic writer

**Decision:** Planner output remains candidate input. One `canonicalizeExecutionItem()` boundary creates an immutable `CanonicalRequest` whose capability, entity, temporal state, stay dependency, required fields, resolver, risk, response mode, and evidence binding are authoritative for execution.

**Reason:** State, readiness, query construction, and dispatch previously retained independent semantic repairs or routing choices. Those duplicates allowed a Planner type, stale state, or consumer fallback to disagree with the accepted temporal, entity, or capability.

**Constraint:** State may persist canonical values but may not rewrite them. FormalRequest and QueryPlan derive readiness and operations only from `CanonicalRequest`. The canonical executor rejects resolver mismatches. ResponsePlan, Claim Validator, and FinalDecision consume canonical outcomes without reclassifying Planner semantics. Capability policy remains property-neutral; property-specific facts come only from the scoped catalog and resolver.

## D-028 — Property-neutral runtime data authority

**原始標題（verbatim）：** `2026-07-28 — Property-neutral runtime data authority`

**Decision:** Authenticated account/session scope, together with the existing platform-admin grant provider, is the only authority for which properties onboarding may list or update. Room and bundle availability are keyed only by property-scoped inventory records and formal bundle-member relations.

**Reason:** Base-era onboarding, JSON fallback, availability import, PostgreSQL compatibility, and seed helpers still embedded one property and a fixed room set even though the active conversation Engine was property-neutral.

**Constraint:** Missing authorization or bundle relations are rejected rather than inferred. Shared seed code accepts an explicit property graph; property-specific initialization values may exist only in explicitly selected fixtures or historical migrations, never as runtime branches.

## D-029 — Onboarding intake starts from a scoped invitation

**原始標題（verbatim）：** `2026-07-29 — Onboarding intake starts from a scoped invitation`

**Decision:** A new operator onboarding submission may be created only by a platform administrator issuing an expiring, revocable invitation. The invitation token hash is attached to one staging application and is the only authority for that application's draft read/write operations.

**Reason:** The former public form created an unrestricted draft on first save. Although fresh save and submit worked, that path could not prove invite expiry, revocation, or operator-to-operator isolation and therefore was not a safe friendly-operator intake boundary.

**Constraint:** The browser-supplied property ID is never authorization. Drafts, rooms, bundles, pricing, rules, location, and contact details remain in existing onboarding staging tables until an existing admin approval transaction promotes them. Tokens, cookies, personal data, and credentials must not enter logs.

## D-030 — Test-only onboarding URLs are deployment-scoped

**原始標題（verbatim）：** `2026-07-29 — Test-only onboarding URLs are deployment-scoped`

**Decision:** The `nephi-home-node-pilot-test-only` service starts with migrations only and uses its explicit `onrender.com` host as `PUBLIC_BASE_URL`. Test-only deploys never run a seed automatically and never generate operator invitation, resume, or admin-setup URLs on `app.junzanai.com`.

**Reason:** The repository Blueprint still contained an obsolete seed command and production-looking public base URL even after the running test-only service had been corrected manually. That mismatch could be restored by the next Blueprint deploy and sent fake staging traffic to a different test-only service.

**Constraint:** URL generation continues through the existing `publicBrand.publicBaseUrl` boundary. No route, token format, onboarding workflow, formal property data, or LINE behavior changes.

## D-031 — One-time property-scoped LINE setup authority

**原始標題（verbatim）：** `2026-07-29 — One-time property-scoped LINE setup authority`

**Decision:** A platform administrator may issue an expiring, revocable, one-time LINE setup link for one existing property. The raw token is returned only in the newly created URL; PostgreSQL stores its SHA-256 hash. The public setup token, not any browser-supplied property ID, is the sole property authority.

**Reason:** The existing property-scoped binding and webhook runtime safely encrypted and routed credentials, but credential entry still required a platform-admin API and had no operator-safe handoff boundary.

**Constraint:** The raw token is carried only in the URL fragment, removed from browser history before any network request, and submitted to resolve/redeem endpoints in a POST body under `Referrer-Policy: no-referrer`. Redemption locks and revalidates the token, encrypts both credentials through the existing AES-256-GCM binding service, preserves the property's webhook key, upserts the binding, and sets `used_at` in one transaction. Failure rolls back both binding and token state. Raw credentials, raw token, token hash, and encryption key never enter request URLs, Referer headers, logs, status APIs, HTML, persistent browser storage, or read-back responses.

## D-017 — Final-candidate validation is the only Composer claim state

**Decision:** A rejected or failed Composer attempt is diagnostic history, not FinalDecision input. When the Engine replaces it with the deterministic response and that final candidate passes the unchanged Claim Validator, FinalDecision receives the successful final validation.

**Reason:** Retaining rejection state from a discarded Composer candidate converted valid property-backed deterministic answers into `claim_validation_failed` handoffs, including location replies that had already passed every earlier stage.

**Constraint:** Every final candidate still passes Claim Validator. If deterministic fallback validation fails, the existing `claim_validation_failed` handoff remains mandatory. Composer text rejection, exception details, and fallback selection cannot weaken Claim Validator, Resolver authority, high-risk handoff, or property isolation.

## D-018 — Entity-specific property capabilities require one catalog-backed definition

**Decision:** When a property catalog uniquely resolves an entity such as `pool` or `parking`, capability, canonical entity, accepted category, resolver, and answer must all come from that entity's single capability definition. The pool definition accepts the provider's real `policy` category in addition to its existing categories.

**Reason:** The real pool record is a policy. Rejecting that category caused Canonicalizer to select another policy-compatible capability such as `bbq`, while an amenity-shaped test fixture concealed the mismatch. Separately, a missing Planner candidate could discard a uniquely named catalog fact before canonicalization.

**Constraint:** Source-text grounding is allowed only when Planner leaves entity text empty and exactly one registered low-risk property-catalog entity resolves through an exact alias in the current property's catalog. Non-empty conflicting entity text, ambiguous aliases, and unregistered aliases remain unresolved; generic candidate matching cannot manufacture an entity-specific capability.

## D-019 — Broad location requests resolve only to the current property's approved map

**Decision:** Direct property location, address, map, and navigation requests, together with every property-to-external-place proximity, nearby, distance, duration, or directions request, use the existing `location` capability and `property_catalog` resolver. The only answerable location fact is the current property's approved Google Maps URL.

**Reason:** Nearby shops, transit, attractions, routes, distances, and travel times are open-ended external facts. Searching for or estimating them would bypass operator approval, while the existing property-scoped map gives the guest a safe way to inspect both the property and its surroundings.

**Constraint:** Planner must express the semantic relation as `location`; deterministic code must not add per-question keyword rules. Runtime must not search, recommend, identify, invent, or estimate an external place, distance, or duration. Missing or invalid map data remains Unknown. Mixed requests retain every other valid task. A missing canonical candidate may recover a catalog entity from complete task `sourceText` only after an unresolvable raw entity and one unique exact current-property alias; the capability must be registered, low-risk, non-stay-dependent, answer-mode, and resolved by `property_catalog`. A resolved conflicting entity, ambiguous source, unregistered alias, or unregistered capability remains unresolved.

## D-020 — Controlled replies are post-Resolver, property-scoped supplements

**Decision:** Operator-approved custom replies are selected only after Planner interpretation, CanonicalRequest construction, and formal Resolver execution. Deterministic matching may use only the current property, canonical capability/entity, resolved stay dates, room/bundle scope, rule state, and one unique match.

**Reason:** Temporary operating notices must follow the guest's understood task and property authority without turning into keyword FAQ routing, exposing all rule text to Planner, or allowing AI to choose among competing facts.

**Constraint:** Each property may store at most five rules. Disabled, pending, expired, overlapping enabled, ambiguous, cross-property, invalid-date, blank-reply, and nonexistent-room definitions cannot produce an answer. Approved text may supplement only the matching task; other mixed tasks retain formal Resolver outcomes. A rule never asserts availability, price, reservation completion, or another formal fact, and a structural conflict with formal pricing becomes Unknown/review. Composer may only connect allowed facts, while Claim Validator and FinalDecision remain unchanged.

## D-021 — Conversation State V3 is the sole runtime state writer

**Decision:** ConversationEngineV2 persists only Conversation State V3 through one reducer invocation per processed message. V2 request cycles and pending requests may be projected into V3 on read, but no active runtime path writes or independently resumes V2 state.

**Reason:** Planner relation output, V2 cycle mutation, pending-request mutation, and readiness checks previously made separate decisions. That allowed a date-only answer to lose its pricing task and allowed missing bundle dates to influence capability selection before clarification could occur.

**Constraint:** Planner remains the semantic interpreter, but a structurally isolated date or guest-count slot may continue exactly one unexpired pending lodging task. A guest-count recovery must contain only the normalized count expression; additional semantics disable automatic recovery. Every lodging request uses `any`, `room_type`, or `bundle`; active Resolver calls receive only the normalized property/task/product/date/guest contract. Capability selection cannot depend on readiness. Same-turn duplicate task IDs are rejected, an accepted `end_existing` relation cancels only its referenced V3 task, unresolved products remain safe state rather than causing a write failure, new or ambiguous work must not inherit stale state, mixed tasks remain independent, Unknown is never converted to No, and Claim Validator and FinalDecision remain unchanged.

## D-022 — Reducer-approved transitions and catalog-validated products

**Decision:** The V3 reducer is the sole authority for whether an execution item starts a task or continues an existing task, and for the product attached to that transition. New room or bundle products are approved only after exact resolution against the current property catalog; Canonicalizer consumes the reducer-approved product and does not promote raw Planner candidates.

**Reason:** Directly copying a Planner `canonicalCandidate` into a product admitted forged IDs even when the catalog resolved a different room. Conversely, allowing a continuation to reuse its raw Planner entity could lose the persisted topic for a controlled detail follow-up.

**Constraint:** A `continue` transition preserves the V3 task topic and product. A new task may use only a catalog-resolved room or bundle; unknown, ambiguous, or forged candidates become `any` rather than a product selection. Exact catalog grounding remains data-driven; no full-source alias scan or parking/pool/location-specific transition is permitted.

## D-023 — Normalized PostgreSQL inventory is the sole active availability authority

**Decision:** `inventory_availability_days`, scoped by property, inventory, and stay date, is the only table read by the active PostgreSQL availability provider. Migration 020 performs the one-time conversion of legacy room rows and derives formal bundle rows from stored bundle-member relations.

**Reason:** The compatibility reader merged `availability_days` with partially populated normalized rows and allowed the normalized fragment to overwrite the legacy day. Real test-only evidence showed legacy rooms as available while normalized rows said closed or were absent, causing the first frontend and LINE Resolver query to return no rooms until a toggle created more normalized rows.

**Constraint:** The migration is property-, room-, bundle-, and date-neutral, idempotent, and does not infer bundle members. Runtime reads never merge legacy or bundle-legacy tables. Missing normalized dates remain explicit missing data, and every backend, frontend, and LINE caller consumes the same Resolver result.

## D-024 — Test-only dual-user LINE trace is bounded and non-authoritative

**Decision:** A temporary per-message trace may run only in the test-only environment, behind the existing authenticated admin property scope, for one explicitly configured property and one SHA-256-selected message. It stores only allowlisted structured stages and hashed LINE user/channel identifiers for 72 hours.

**Reason:** Two real LINE users received different answers to the same availability question, while the earlier connection check did not preserve enough original per-event evidence to locate the first divergent layer without replaying or clearing conversation state.

**Constraint:** The trace cannot change Planner, CanonicalRequest, V3 state, temporal resolution, Resolver, FinalDecision, FinalResponse, or transport authority. Unknown fields, source/evidence text, credentials, tokens, cookies, database URLs, raw LINE identities, and guest personal data are excluded. Diagnostic failures cannot affect delivery. The table and wiring must be removed after the two real traces are compared and the incident is resolved.

## D-025 — Deployed test-only acceptance uses commit-bound GitHub OIDC

**Decision:** The deployed conversation-acceptance route exists only when both the test-only environment and its dedicated acceptance flag are enabled. It retains platform-admin session authorization and additionally accepts GitHub Actions OIDC only after official-signature verification and exact audience, repository, branch, workflow, and deployed-commit checks.

**Reason:** Post-deployment acceptance must exercise the real test-only Planner, PostgreSQL providers, Engine, Claim Validator, and FinalResponse without storing a user password, LINE credential, Render credential, or reusable acceptance secret in GitHub Actions.

**Constraint:** Request data cannot select identity claims or the deployment SHA. Failed OIDC verification is fail-closed, tokens are never logged or returned, and the response exposes only the Engine's unique FinalResponse plus allowlisted task facts and safe trace evidence. The deployed runner may poll health for the exact commit but never retries a failed conversation case.

## D-032 -- Acknowledgement discourse is not sole silence authority

**Decision:** The contract compiler may normalize an acknowledgement-only Planner result to silence only when every generic unknown task has one relation-uncertain candidate with no request-cycle reference. A task with a verified new-request relation remains substantive and proceeds through the controlled pipeline.

**Reason:** Real OpenAI classified a payment-state notification as acknowledgement but also emitted a new-request task. The previous compiler overwrote that task-level relation and produced no-reply.

**Constraint:** This rule cannot infer payment or any other business intent from guest keywords. Pure acknowledgement cases remain silent through their relation-uncertain task evidence, and Unicode-only punctuation remains governed by the separate deterministic non-substantive rule.

## D-033 -- Formal catalog category arbitrates incompatible task types

**Decision:** After an exact property-scoped entity resolution, a non-general Planner task type is retained only when its registered capability accepts the resolved formal category and is a low-risk property-catalog answer path. Otherwise the resolved formal category selects the compatible controlled capability.

**Reason:** Real OpenAI emitted an amenity-shaped eligibility task with the exact `pets` candidate, while the formal catalog resolved that entity as policy. Preserving the incompatible amenity type produced CanonicalRequest capability `unknown` despite available formal data.

**Constraint:** This rule cannot infer an entity or intent from guest keywords. Ambiguous and unresolved candidates remain fail-closed; high-risk, human-help, stay-dependent, and non-property resolvers cannot be promoted through this compatibility rule.

## D-034 -- Safe CanonicalRequest trace retains controlled temporal disposition

**Decision:** The deployed test-only CanonicalRequest trace includes the deterministic `expressionType` and `repairReasonCode` fields from Temporal Resolver alongside its existing resolved dates, nights, status, and timezone.

**Reason:** Real deployed cases correctly rejected past date ranges, but the safe trace formatter discarded the two fields that distinguish a recognized past range from a missing date. The acceptance contract therefore reported `expected_date_range_missing` even when FinalDecision and FinalResponse had already enforced the past-date policy.

**Constraint:** This changes evidence projection only. Raw guest text, Planner date candidates, temporal provenance, source evidence, identities, and secrets remain excluded; the projected strings are bounded and cannot become Resolver, decision, response, or data authority.

## D-035 -- Duplicate task IDs are repaired only for stateless catalog tasks

**Decision:** When all Planner tasks sharing an ID are stateless property-catalog tasks, the contract compiler keeps the first ID and deterministically gives later duplicates bounded candidate-index suffixes. The repair is recorded in semantic validation.

**Reason:** Real OpenAI produced valid capacity, breakfast-policy, and cleaning-fee tasks but reused `policy` for the latter two. Rejecting the whole Planner output erased every task even though the duplicate catalog-task IDs were safely distinguishable by candidate index.

**Constraint:** Availability, pricing, capacity, booking, human-help, high-risk, and unknown task-ID duplicates are not repaired. Their IDs can become state or request-cycle authority and therefore remain fail-closed. No task content, relation, evidence, capability, or catalog fact is inferred by this normalization.

## D-036 -- Pure Unicode punctuation is normalized after OpenAI

**Decision:** When every loaded source message contains only Unicode punctuation, symbols, or whitespace, the contract compiler discards the Planner's unsupported task, stay, relation, and state claims and emits one evidence-bound unknown acknowledgement contract for the no-reply gate.

**Reason:** Real OpenAI classified a full-width question mark as a new request whose unknown task was structurally invalid. Structural validation then produced a customer-visible handoff even though the source contained no substantive language.

**Constraint:** The rule runs after OpenAI and decides no hospitality intent or fact. Any source containing a Unicode letter or number remains Planner-controlled. The normalized contract cannot execute a resolver, mutate a request cycle, create a review, or produce a reply.

## D-037 -- Test-only Planner attempts use a bounded 30-second timeout

**Decision:** The live test-only OpenAI Planner allows 30 seconds per provider attempt. A Planner round remains capped at two attempts with a finite deadline and the existing bounded retry delay.

**Reason:** Deployed run `31008310498` recorded five OpenAI attempts that reached the exact 15-second client boundary: both attempts for `rg-009`, both attempts for turn 1 of `rgs-020`, and the first attempt for `rg-028`. No response body or provider request ID was available before those local aborts, while `rg-028` succeeded on its second request.

**Constraint:** Only timeout, network, rate-limit, and provider-5xx failures may reach attempt two. Invalid requests, schema failures, parsing failures, structured-output failures, and non-429 4xx responses remain single-attempt fail-closed outcomes. This change does not alter Planner prompts, semantic compilation, formal facts, or FinalResponse behavior.

## D-038 -- Temporal recovery is source-grounded and task-isolated

**Decision:** When OpenAI supplies a temporal span that is absent, not present in the source message, or unparseable, Temporal Resolver may recover a uniquely parseable date range or stay duration from the task's verified source. It may inspect the complete current message only when the compiler is processing the sole stay-dependent task in that turn.

**Reason:** Real deployed Planner output preserved the booking task and date semantics but synthesized a normalized date span that was not source-bound, causing `planner_temporal_span_invalid`; another run emitted `兩天` although the deterministic grammar requires the source-bound `住兩天` form. Blindly scanning the whole message for every stay task caused one candidate's date to leak into another request cycle.

**Constraint:** Recovery uses only canonical temporal grammar and current-message evidence. Multiple distinct temporal meanings remain ambiguous, invalid ranges remain invalid, past dates remain `past_date`, property facts receive no stay projection, and multiple stay-dependent tasks cannot borrow an unscoped date from the whole message.

## D-039 -- Controlled Planner fields arbitrate contradictory capability shapes

**Decision:** The semantic compiler preserves a stateful `price` or `total_price` capability when its task type, sole requested output, and stay dependency agree, discarding an incompatible incidental property-fact entity instead of demoting the task. For an ungrounded low-risk general task, a sole controlled inventory output may repair the capability; a controlled policy-restriction detail may repair an availability-shaped property task to `policy`. An explicit unresolved `property_fact` retains that semantic capability while its truth remains Unknown.

**Reason:** Real OpenAI output changed across deployed runs without changing the guest request. It emitted a valid stateful total-price task whose attached pool entity caused the compiler to erase the price capability, availability-shaped usage restrictions that became an amenity, generic price requests labeled as policy, and an explicit property-fact task that the compiler flattened to generic unknown. These changes produced four prior-PASS regressions before Temporal Resolver ran.

**Constraint:** This arbitration uses only schema-controlled Planner fields and exact current-property catalog resolution. It cannot scan guest text, add aliases, infer facts, override a resolved stateless catalog entity, change `booking_request`, `human_help`, or `high_risk`, bypass date readiness, execute an availability query before required stay fields exist, or convert an unresolved property fact into an answer. Ambiguous and missing formal data remain controlled clarification or handoff paths.

## D-040 -- Controlled detail intent precedes low-risk candidate shape

**Decision:** A controlled policy-restriction detail emitted as either `availability` or `amenity` is compiled to `policy`; if its entity category is not accepted by the policy registry, the compiler retains the source-bound entity text but replaces only the incompatible category. For an `availability` or `amenity` time-detail task, a longer Planner entity phrase may resolve one formal amenity or FAQ only when the entire phrase is present in verified new-request evidence and contains exactly one property-scoped catalog alias.

**Reason:** Deployed run `31037333449` showed the same policy questions arriving as `availability + room_or_bundle_restriction`, `amenity + usage_restrictions`, and catalog-grounded amenity restrictions. It also showed a KTV time task whose source-bound entity was `ktv 使用時間`; exact whole-string entity matching missed the formal `singing` FAQ and incorrectly hid its 08:00-22:00 answer behind handoff.

**Constraint:** The compiler does not scan the complete guest message, add aliases, or use task IDs, case IDs, or acceptance text. Phrase grounding is limited to verified `new_request` evidence, time-detail tasks, low-risk `availability`/`amenity` candidates, current-property amenity/FAQ facts, and one uniquely owned alias. Ambiguous aliases, unbound Planner entity text, unresolved facts, acknowledgements, inventory readiness, `booking_request`, `human_help`, and `high_risk` remain fail closed.

## D-041 -- Unreferenced same-turn supplements remain new requests

**Decision:** When the Planner declares the turn itself to be a `new_request`, at least one task has a verified current-source `new_request` relation, and another task from the same source is labeled `supplement_existing` with no request-cycle reference, the semantic compiler normalizes only that unreferenced relation to `new_request`.

**Reason:** Deployed run `31040750260` produced three independent tasks from one new guest message but labeled the latter two as supplements without a cycle reference. The strict context validator correctly rejected those impossible relations and discarded an otherwise grounded infant-supplies task, turning the complete turn into a generic handoff.

**Constraint:** The repair requires source evidence to match the current event and does not apply to `continue`, `modify`, acknowledgement, `modify_existing`, `end_existing`, a relation carrying any request-cycle reference, or unverified evidence. It does not invent or select a prior cycle and does not change task capability, entity, temporal state, facts, or readiness.

## D-042 -- Test-only Planner uses minimum-variance supported sampling

**Decision:** The real OpenAI test-only Planner sends `temperature: 0` on every Responses API request and does not set `top_p`.

**Reason:** Repeated complete deployed runs sent identical fixed guest inputs and the same strict schema to the same model, yet alternated among incompatible price, policy, amenity, room, and bundle task shapes. The existing prompt already explicitly distinguishes these capabilities. The official Responses API defines lower temperature as more focused and deterministic, and GPT-4.1 mini supports both Responses and Structured Outputs.

**Constraint:** This does not change the model, prompt, schema, property catalog, formal data, retry count, retry categories, timeout, expected results, or downstream safety gates. Provider failures still follow the existing bounded retry and fail-closed path; lower variance is not treated as proof of semantic correctness, so every deployment still runs the complete real acceptance matrix.

## D-043 -- Roll back the minimum-variance Planner sampling override

**Decision:** Remove the test-only Planner's explicit `temperature: 0` override and restore the prior provider request while deterministic shared compiler boundaries are developed.

**Reason:** Complete deployed run `31045656667` on commit `cca314b339b061628efbd54e58121af93bab9695` fell from 66 PASS to 63 PASS. Prior-PASS `rg-001`, `rg-006`, and `rg-037` regressed at the Planner layer into incompatible but schema-valid capability shapes. The private artifact therefore disproved the proposed override as a safe release repair.

**Constraint:** The rollback does not treat provider defaults as semantically stable. It restores the last code baseline, keeps every regression visible, and requires future repairs to normalize only source-evidenced contradictions in the controlled compiler without Case IDs, exact guest sentences, expected changes, or relaxed acceptance.

## D-044 -- Verified task-source time detail may recover one formal fact

**Decision:** A low-risk `availability` or `amenity` time-detail task with an empty entity may use its own verified current-event `sourceText` to resolve exactly one current-property formal fact. The exact catalog mention is retained in the normalized entity so the semantic output remains schema-valid and auditable.

**Reason:** Rollback run `31047883614` emitted the KTV-hours task as stateless `availability + time` with an empty entity even though its source span contained the property-scoped singing alias. The compiler therefore discarded the formal 08:00-22:00 answer and returned only the unrelated soundproofing handoff.

**Constraint:** This applies only to `time`, `start_time`, or `end_time`, verified `new_request` evidence, one uniquely owned formal fact, no stay dependency, and no inventory output. General empty entities, multiple facts, unverified evidence, unrelated non-empty entities, price, booking, human-help, high-risk, continuation, and acknowledgement remain fail closed. It does not scan the complete guest message or add aliases.

## D-045 -- Price capability grammar is part of structured Planner generation

**Decision:** The real OpenAI Planner receives one shared semantic definition for monetary lodging requests in both its system instructions and the strict task schema. Generic or scoped monetary lodging amounts remain `price` with `requestedOutputs: ["price"]` and stay dependency; property rules and conditions remain `policy`. Before returning, the Planner must verify that every substantive request and stated subject has a matching task whose type and requested output agree.

**Reason:** Five complete deployed artifacts showed the same fixed generic lodging-cost request produce `price` once and then `policy` four consecutive times. The runtime already handled the `price` shape correctly, while the strict schema only enumerated task types and therefore constrained JSON shape without defining the price-versus-policy semantics inside structured generation.

**Constraint:** This is capability grammar, not a question-word lexicon. It adds no Chinese wording, alias, Case ID, expected value, catalog fact, deterministic answer, availability result, or downstream repair. Missing dates still fail closed through the existing Temporal Resolver and readiness boundary; OpenAI still cannot decide price, availability, policy truth, or customer-visible wording. Complete deployed acceptance remains required because prompt and schema guidance are not proof of semantic correctness.

## D-046 -- Structured Planner regression repair preserves readiness and high risk

**Decision:** Before structural validation, a sole task that explicitly declares stay dependency but supplies a null task stay candidate receives the top-level structured stay candidate, including its all-empty form. The Planner instructions and strict schema also require stay-dependent tasks to emit the structured object and classify disclosure of access credentials or authentication secrets as `high_risk`, never low-risk policy.

**Reason:** Deployed artifact `8949414624` fixed the generic lodging-cost capability but regressed two prior PASS cases. One price task was rejected before semantic compilation because `dependsOnStayContext:true` and `stayCandidate:null` contradicted the local contract even though all dates were simply missing. A sensitive access request was classified as a low-risk unknown policy after the policy grammar was expanded.

**Constraint:** Empty stay projection applies only to one explicitly stay-dependent task; it never copies one candidate across multiple tasks, and stateless null candidates remain null. The result still has empty dates, creates no availability QueryPlan, and reaches ordinary clarification. Sensitive access remains human handoff and cannot query the property catalog for a secret. The repair uses no Case ID, guest sentence, Chinese term, catalog alias, expected change, or formal answer.

## D-047 -- Lodging arrangement intent remains a booking capability

**Decision:** The real OpenAI Planner instructions and strict task schema define a request about how to arrange, proceed with, or make a lodging reservation as `booking_request`. The task remains stateless human handoff; stated dates, duration, guests, room, and bundle remain source evidence for deterministic canonical validation, but the booking task cannot query availability.

**Reason:** Deployed artifact `8950072765` regressed a prior-PASS duration-only lodging-arrangement request from `availability` to `unknown`, even though Temporal Resolver recovered the verified two-night duration. The missing capability was therefore a Planner semantic-grammar gap, not a temporal parsing failure.

**Constraint:** Duration alone never implies `booking_request`; semantic lodging-reservation intent is required. This rule adds no guest-language phrase, alias, Case ID, expected value, formal fact, or downstream answer. `availability` remains required for an inventory question, and non-lodging duration, property facts, policies, high-risk requests, ambiguity, past dates, and multi-cycle relations retain their existing boundaries.
