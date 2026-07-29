# JunZan AI 經驗教訓

目前專案狀態見 [專案記憶入口](PROJECT_MEMORY.md)；已形成不可退步行為的教訓應同步納入 [產品基準](PRODUCT_BASELINE.md)。

## 正式 LINE Webhook 事件

- 尼腓的家正式 LINE Channel 曾被指向 test-only endpoint。
- 因 Channel Secret 不對應，造成 `INVALID_LINE_SIGNATURE`／HTTP 401，正式帳號無法自動回覆。
- 使用者將 Webhook 改回正式網址後，正式帳號立即恢復。
- 現有證據無法證明是 Codex 或使用者修改。
- 已確認 repository、部署流程與專案腳本沒有自動修改 LINE Webhook 的能力。
- 真正的流程問題是正式與 test-only 缺少權限、帳號及環境的硬隔離。
- 未來不得只靠人工辨識 LINE Channel 頁面，必須建立技術與權限防線。

## Planner candidate 與 canonical contract

- Planner 輸出欄位名稱與 normalization contract 不一致時，即使測試使用理想化 fake schema 全部通過，真實 LINE 仍可能遺失日期或條件。
- 回歸測試必須包含真實 Planner operation schema，覆蓋 Planner → normalization → state → executor 的完整鏈路。
- 未允許的 operation path 不得靜默忽略；必須拒絕或留下可觀測的 validation 結果。

## Temporal trust boundary

- 合法 ISO 格式不等於正確日期。Planner 曾把 `7/18` 產生為 `2056-07-18`，使 executor 查不到房況並錯誤轉真人。
- 年份省略時，canonical 日期必須由 property timezone、event timestamp 與 raw date expression deterministic 解析。
- AI candidate 只能協助理解；若與 rawText 或 deterministic 結果不一致，不得覆蓋 canonical date。

## 安全硬隔離與 property routing

- LINE payload `destination` 是 Bot User ID，不是數字 Channel ID；不同身分類型不得混用同一欄位比對。
- Channel identity 必須同時綁定 environment、route、Secret fingerprint、數字 Channel ID 與 destination ID，錯配時 fail fast。
- `propertyId` 只負責 tenant routing，不能證明 LINE Channel 身分；routing 與 channel authentication 必須分開驗證。

## Controlled Composer 信任邊界

- schema 合法、字串非空與 task coverage 完整，都不代表模型輸出具有語意或受到可信事實約束；標點殘片、表情符號及無來源的技術身分仍可能通過表面檢查。
- handoff、review、Unknown 與資料不可靠結果是安全決策，不是文案創作空間；模型不得改寫或覆蓋 deterministic 結果。
- Composer 採用模型輸出前，必須逐 section 驗證回覆模式、最低有效語意、`allowedFacts` grounding 與 Claim Validator；任一步驟失敗都使用 deterministic fallback。
- 可觀測性應記錄 composer 來源、驗證結果、拒絕原因與是否 fallback，不得把完整客人訊息、模型內容、Secret 或 Token 寫入 trace。
## 2026-07-19 — Task schema must represent generic availability explicitly

- A schema that forbids an empty entity for `available_dates` forces the Planner to invent a generic inventory entity, which later becomes `inventory_entity_unknown` despite a valid date range.
- Preserve generic availability as an empty entity and resolve room class only from current property metadata. Do not repair this with a phrase list in the executor.
# 2026-07-19 — Explicit guest constraints must not be discarded by a missing companion field

When a guest states duration or guest count without a date, preserve the confirmed constraint and clarify only the missing date. An explicit invalid/past date must clear any prior stay date instead of reusing state from an earlier request.

## 2026-07-22 — Compare raw Planner tasks with validated tasks safely

When fixture-driven acceptance tests disagree with a real model-backed runtime, capture the Planner task contract before normalization and the accepted, rejected, and final task sets after validation under one trace ID. The trace must be allowlisted field by field so diagnostic evidence never includes the guest message, user/event identifiers, credentials, signatures, or full location URLs.

## 2026-07-22 — Structural validity does not prove semantic validity

A Planner task can satisfy the strict JSON schema while carrying contradictory meaning, such as a transport fact without the canonical location ID or a base facility question marked as an eligibility detail. The runtime must enforce controlled relationships between task type, category, canonical candidate, detail intent, and requested outputs before the Resolver; safely repair only contract-determined cases and locally downgrade anything that cannot be repaired without guessing.

## 2026-07-23 — Property identity must follow verified Channel credentials

A webhook URL parameter or unverified payload cannot establish tenant identity. Multi-Channel LINE handling must first select one opaque binding candidate, verify the raw body with that binding's Secret, and only then use the binding's property and Access Token. Tests must attempt query/body tampering and cross-signing, not only exercise two successful Channels.

## 2026-07-26 — Transport diagnostics must use the injected test seam

When a test-only transport diagnostic callback is provided, every transport outcome, including reply failures, must use that callback. Do not bypass it with the production-safe logger; doing so makes E2E observability diverge from the actual transport result. Keep external trace reason codes stable (`reply_attempt`, `reply_succeeded`, `reply_failed`) and preserve detailed HTTP error codes only in persisted delivery metadata.

The safe logger remains mandatory even when the test callback exists, and callback exceptions must be swallowed so they cannot alter reply delivery. Persist the FinalDecision fields on the main event before transport so delivery success or failure never changes `needsReview`, `humanHandoff`, or `decisionReason`.

## 2026-07-26 — Preserve failure class, never raw provider error content

Collapsing every Planner exception to one fallback reason protects behavior but makes operations blind. Preserve only fixed, classifiable metadata at the provider boundary—normalized status, category, timeout, model, and provider—then discard raw messages and response bodies. Apply a second allowlist in the trace formatter, and isolate the diagnostic callback so observability can never become a new failure path.

For OpenAI non-2xx responses, parse the body only transiently and retain only sanitized `error.type`, `error.code`, and `error.param`; discard every other field. A non-JSON body must leave these fields empty while preserving the original HTTP failure classification.

## 2026-07-26 — Strict Structured Outputs require every object property

For OpenAI strict Structured Outputs, `additionalProperties: false` is not sufficient: every key declared in an object's `properties` must also appear in `required`. Represent semantically optional identifiers as required nullable or empty-capable fields, then preserve the real domain invariant in deterministic validation. Audit the complete generated schema recursively so one deeply nested omission cannot disable the Planner.

## 2026-07-26 — Evidence diagnostics should report outcomes, not evidence

When diagnosing context-relation rejection, emit only controlled structural paths, counts, relation kinds, and source-match booleans. Never copy evidence quotes, guest text, event/message identifiers, property data, or credentials into an operational trace. Derive the diagnostic booleans with the existing validator predicate so observability does not create a second relation rule.

## 2026-07-26 — Canonicalize coordinates only from unique exact source text

Model-generated evidence coordinates are not trustworthy merely because the task meaning is valid. Before context validation, coordinates may be rebuilt only when one task maps to one candidate and its unchanged `sourceText` has exactly one occurrence in one uniquely identifiable source event. Otherwise preserve the Planner evidence and let the unchanged validator reject it; never use fuzzy matching or relax event, offset, or quote checks.

## 2026-07-27 — Route canonical facts before readiness and isolate mixed sections

A canonical property fact can pass Planner schema validation while carrying the wrong capability. Correct the controlled canonical tuple before FormalRequest readiness so parking never inherits stay-date requirements or invokes the availability Resolver.

For mixed execution results, validate and render each deterministic section from its own outcome. Do not ask a free-form Composer to reconcile answered sections with clarification or review sections, because rejection of one incomplete section can incorrectly poison grounded answers. Keep mandatory high-risk handoff in FinalDecision and retain scoped review records for ordinary unknown facts.

## 2026-07-27 — Composer producers must match the validation contract

Do not instruct a Composer to paraphrase when its consumer permits only the exact deterministic section. That producer/consumer contradiction turns grounded answers into `ungrounded_section_text`, and a safe fallback can then be incorrectly treated as a failed claim.

Constrain structured Composer output to the exact per-task text already produced from trusted facts, then keep the existing coverage, source, and exact-text validators active. A deterministic answer is still invalid when its fact source is absent, and fabricated or modified text must still be rejected.

## 2026-07-27 — Temporal candidates must never become executable dates directly

Planner temporal output can contain a useful raw expression while its kind or proposed dates are wrong. Binding normalization to the Planner's classification, or letting downstream state/readiness code fall back to prior dates, creates multiple temporal authorities and makes relative-date behavior nondeterministic.

Resolve the unchanged guest temporal span once with an injectable clock and property timezone, then make every later stage read that canonical result. Test fixtures must obey the same source contract: a claimed temporal span must actually occur in the guest message.

## 2026-07-27 — Retry provider transport failures, not invalid Planner content

A single timeout among otherwise healthy stability replays is evidence for a narrow provider-boundary retry, not for changing Planner semantics or downstream fallback rules. Retry only error classes known to be transient, cap the complete classification at two attempts, and add a bounded delay so the second request does not immediately repeat the same transient condition.

Never retry invalid requests, parsing or structured-output failures, empty responses, unknown failures, or local contract validation. Those failures contain no evidence that sending the same request again is safe or useful. When the second transient attempt also fails, retain the original `planner_parse_failed` handoff and record only allowlisted categories and booleans.

## 2026-07-27 — Candidate validation is not executable authority

Validating or repairing a Planner candidate does not make it safe for State, FormalRequest, QueryPlan, or Executor to interpret that candidate independently. Multiple individually reasonable fallbacks can still disagree on capability, entity, temporal meaning, or resolver and produce cross-stage regressions.

Create one immutable canonical object before executable state and make each downstream layer fail when that authority is missing or rewritten. Mutation tests must inject duplicate writers, not merely count files, because a second writer can hide inside an otherwise legitimate consumer module.

## 2026-07-28 — Property-neutral behavior must cover support paths

Removing property-specific routing from the active conversation Engine is insufficient when onboarding, import, JSON fallback, PostgreSQL compatibility, or seed utilities still assume one property or a fixed room list. Those support paths can silently reintroduce the same coupling.

Test both source neutrality and behavior with two properties that use different room and bundle IDs. Keep historical values in explicit fixtures or migrations, and make production code derive authorization and inventory only from authenticated scope and formal property data.

## 2026-07-29 — A working fresh form is not proof of a safe intake boundary

A fresh browser could save and submit the existing onboarding form, but that success bypassed the required invitation authority because the page silently created an unrestricted draft. Reproducing only the happy path would have hidden expiry, revocation, cross-operator isolation, and stale-link behavior.

Treat invitation resolution and draft persistence as separate contracts: issue one unguessable token from authenticated platform scope, store only its hash, bind it to one staging application, and test invalid, expired, revoked, and cross-application use before testing field persistence.

## 2026-07-29 — Blueprint configuration must match the running test-only service

A manual Render setting can make one deployment healthy while the repository Blueprint still contains an unsafe start command or wrong public URL. The next Blueprint sync can silently restore the obsolete behavior.

Keep a repository-level deployment contract that selects the exact test-only service and asserts both the migration-only start command and the dedicated public host. Exercise every externally returned onboarding URL field through the same environment-derived base URL.

## 2026-07-29 — Rejection belongs to the discarded candidate

A Composer rejection proves only that one proposed candidate is unusable. If a deterministic fallback replaces it, validate that replacement independently and pass only the final validation result to FinalDecision. Carrying the discarded candidate's rejection flag forward creates false handoffs while making trace output disagree with the actual text being sent.

When repairing a Planner entity, do not infer from a property ID or a hardcoded answer. Use only a unique exact match in the current property's catalog, require a registered low-risk property-catalog capability, and leave ambiguous or ungrounded input on the existing safe path.

## 2026-07-29 — Routing fixtures must preserve provider category shape

A fixture that labels a real provider policy as an amenity can make capability acceptance look correct while production canonicalization rejects the entity and chooses an unrelated policy-compatible capability. Regression fixtures must pass through the same catalog builder and assert the resulting provider category before asserting routing.

For entity-specific routing, derive capability, entity, resolver, and answer from one registered definition. Recover a missing Planner entity only from a unique exact alias in the current property catalog; conflicting, ambiguous, or unregistered text must not trigger a source-wide guess.

## 2026-07-29 — Non-empty Planner entity text is not necessarily resolvable

The real provider can emit a non-empty entity containing the whole question while leaving `canonicalCandidate` null. Treating non-empty as equivalent to grounded skipped the only exact parking alias in the task `sourceText` and produced an avoidable Unknown.

Recovery must distinguish resolved, ambiguous, and not-found states. Only not-found text may fall back to one exact current-property source match; a resolved entity that conflicts with the source must be rejected, and ambiguity or missing capability registration must never be guessed. Provider-shaped fixtures must include both the Planner's category and its complete raw entity text.

Broad location behavior belongs in the Planner's semantic contract and the existing property-scoped location resolver, not in deterministic phrase lists. The runtime may return only the current property's approved map and must preserve non-location tasks in the same message.
