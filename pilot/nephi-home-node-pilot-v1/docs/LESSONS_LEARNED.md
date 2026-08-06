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

## 2026-07-23 — Planner discourse cannot bypass canonical pending matching

- `new_request` is a Planner interpretation, not proof that a turn is independent of an existing request.
- Pending arbitration performed before Temporal resolution can discard a valid date, duration, guest count, or room preference without ever testing it against the missing-field contract.
- Regression tests must reproduce the real failure shape: a conflicting candidate task and `new_request` relation plus a valid canonical slot, then prove the original capability reaches the Resolver.
- Safe diagnostics should expose date-expression shape, Temporal candidates/results, accepted or rejected canonical fields, and reason codes without logging raw guest messages or credentials.

## 2026-07-23 — Cross-field contradictions must fail before state reuse

- Structural schema validity does not make `relation`、task type、`shouldIgnore` or temporal `kind` mutually consistent.
- A dialogue act is substantive only when its task is a real hospitality capability or is grounded in the selected property's catalog; otherwise acknowledgement must not reach the Executor.
- Date intent and date resolution are separate facts. When a guest clearly attempts a date but canonical resolution fails, retaining the previous stay date silently turns an invalid current request into a valid-looking Resolver query.
- Deterministic regressions must use real production Planner output shapes and traverse semantic validation, Temporal, state reduction, Resolver gating and Engine `finalDecision`; isolated Temporal tests cannot prove stale-state safety.
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

## 2026-07-30 — Readiness must not select capability or own context

A missing date is not evidence that a bundle task is Unknown. Selecting a capability only after its required fields are present prevents the system from storing the real pending task and makes the next date-only turn impossible to recover.

Choose capability and lodging product from the canonical entity first, merge trusted context in one reducer, then evaluate readiness through one contract. Use accepted Planner relations for semantic follow-ups, but permit a narrow structural recovery when exactly one pending task is missing exactly the supplied slot. The supplied slot must occupy the whole turn; a guest count plus another question is not structural recovery. Repeated task labels must not become state identity, same-turn duplicate IDs must be rejected before maps can collapse them, end relations must persist cancellation even on a no-reply turn, and entity-resolution failure must produce a contract-valid safe state rather than throwing during persistence.

## 2026-07-31 — Acknowledgement fragments and continuation products need explicit authority handoff

An acknowledgement-only Planner contradiction must be normalized before execution, while an ungrounded social fragment in a mixed substantive request must not create a human handoff that overrides the answerable task. When an accepted continuation supplies a catalog-validated room or bundle, the V3 reducer must combine that current product with approved stay context instead of silently restoring the prior generic product.

Fixtures for these boundaries must bind every claimed date and entity span to the actual guest message. Otherwise evidence validation fails before the intended acknowledgement, temporal, or continuation contract is exercised.

## 2026-07-31 — Observed and valid webhook timestamps are separate writes

Adding provider methods and database columns does not make the production handler call both. Record an admitted webhook observation separately, then update the valid timestamp only after the enabled binding, signature, JSON payload, and bound property have all passed validation. Exercise unknown keys, wrong signatures, and disabled bindings to prove they cannot advance the valid timestamp.

Keep the service argument contract and worker SQL key identical: observed receipts use `webhookKey`, while valid receipts use `propertyId`. A successful RPC returning no row is still a failed state transition and needs an end-to-end persistence assertion. Likewise, defining a credential validator is insufficient unless every setup and admin write path invokes it before encryption or token consumption.

## 2026-08-01 — Compatibility transport fields are not response authority

Coordinator compatibility output may retain a top-level delivery boolean for callers, but an active LINE handler must not use it to infer an action or gate a reply. Both registered transports must read `finalResponse.shouldReply` and `finalResponse.replyText`; `finalDecision` fields are diagnostic and review metadata only. Source contracts must scan the active runtime before the legacy marker so unreachable compatibility code cannot mask a second transport authority.

## 2026-08-01 — Pending recovery fixtures must contain a live V3-compatible task

A legacy pending fixture without a future expiry is already expired when V3 reads it, and an availability fixture that claims guests are required does not match the formal readiness contract. Such fixtures can appear to test arbitration while the runtime actually starts a second task.

Exercise isolated slot recovery with evidence-bound Planner source spans and a capability whose formal readiness genuinely requires the supplied field. The V3 reducer may select the unique pending task structurally; date derivation remains in the temporal resolver. A complete new request must retain its own task identity, and a pure acknowledgement must leave persisted state and Resolver call counts unchanged.

## 2026-08-01 — Constitution source scans must follow the current authority boundary

A source-level integrity runner can become contradictory when an authority API is renamed or moved: requiring a removed FinalDecision factory while also expecting the Composer to mention FinalDecision made the target CI reject the same architecture enforced by the newer runtime-uniqueness gate. Response-planning fixtures that still call a removed Engine decision helper and safe-trace assertions that expect intentionally redacted Planner temporal fields are the same class of stale boundary test.

Keep each scan aligned with the concrete authority contract. The Engine must call the sole `buildFinalDecision` builder, while the Composer may render section `responseMode` but must not import or reference FinalDecision, decide `no_reply`, emit an action, or expose transport `shouldReply`. ResponsePlan fixtures should test their own pre-decision boundary, and temporal integration tests should assert raw Resolver diagnostics plus CanonicalRequest state while proving that safe traces omit guest-derived temporal text and candidates.

## 2026-08-01 — Empty FinalResponse text is not a no-reply decision

Combining a false delivery decision and an empty reply string in one transport condition silently converted a broken `shouldReply=true` FinalResponse into normal `no_reply`; whitespace-only text could instead reach the LINE API.

Gate normal silence only on an explicit `finalResponse.shouldReply === false`. Validate the rendered text separately before transport, retain the original FinalResponse as the sole content authority, and record an empty rendered reply as a review-required contract failure with a stable diagnostic code.

## 2026-08-01 — A compatibility merge can silently become a second data authority

Overlaying a partially populated replacement table on a complete legacy day made row presence determine which value won. The result looked reliable because every room had some value after the merge, even though those values came from conflicting authorities.

When replacing a persistent authority, migrate the complete graph first, make the migration idempotent, and then remove the legacy read from active runtime. Regressions must start from the conflicting pre-migration database shape and verify the first public request, admin view, Resolver, restart, adjacent dates, bundles, and another property without calling a mutation endpoint.

## 2026-08-05 — A merged unknown task must not erase a formal catalog subtask

OpenAI can understand a multi-part message differently across real runs: one run may emit a formal property task plus an unknown remainder, while another merges both into one unknown candidate. Treating that merged candidate as a single handoff erases an independently answerable formal fact.

The contract compiler may isolate a subtask only from a sufficiently specific, unique property-catalog mention in the AI-provided entity candidate and only when its current-event evidence is valid. It must preserve the unknown remainder as fail-closed, avoid duplicating an already represented catalog task, and never infer business intent merely by scanning the whole guest message.

## 2026-08-05 -- A dialogue label must not erase an explicit substantive task

Real OpenAI output can label a payment-state notification as an acknowledgement while simultaneously emitting a task with a verified `new_request` relation. Treating the discourse label alone as silence converted a required controlled handoff into no-reply.

Acknowledgement normalization must also respect the task-level relation candidate: only relation-uncertain generic tasks may use the acknowledgement-only silent path. A verified new-request task must continue through CanonicalRequest and controlled FinalDecision even when its exact business fact is unknown. Unicode-only punctuation remains a separate deterministic safety rule.

## 2026-08-05 -- Formal category must arbitrate incompatible Planner types

Real OpenAI can identify the exact catalog entity while labeling its task with a different hospitality type, especially when a non-general detail intent is present. Preserving that incompatible task type can produce a resolved canonical entity together with capability `unknown`.

For an exact property-scoped catalog resolution, the compiler may retain the Planner type only when its registered capability accepts the formal entity category and remains a low-risk property-catalog answer path. Otherwise the formal category selects the compatible controlled capability; unresolved or ambiguous entities remain fail-closed.

## 2026-08-05 -- Safe evidence must retain the reason that makes an unresolved value valid

A privacy-safe trace can keep dates redacted and still become semantically incomplete. The deployed Temporal Resolver correctly classified past date ranges, while CanonicalRequest trace projection retained only `unresolved` and null dates; acceptance could no longer distinguish deliberate rejection from parser loss.

When an acceptance rule permits a controlled unresolved state, its bounded machine reason and expression class must survive the safe projection. Preserve only deterministic enum-like fields, keep source text and provenance excluded, and test both the required metadata and the privacy boundary.

## 2026-08-05 -- Task-ID repairability depends on downstream authority

A duplicate Planner task ID is not always the same defect. Stateless property-catalog tasks can be renamed deterministically from their candidate indexes without changing their meaning, but stateful availability or pricing IDs can become request-cycle identities.

Normalize only the stateless duplicate group and retain a negative test proving that stateful duplicates still fail closed. A broad duplicate-ID repair can silently turn a validation rejection into unauthorized conversation state.

## 2026-08-05 -- Non-substantive input must survive malformed Planner output safely

A no-reply rule placed only after structural validation cannot protect punctuation-only input when OpenAI returns an invalid task shape. The validator fails first and routes to a generic handoff.

Use a Unicode-category rule after OpenAI but before structural validation to create the smallest evidence-bound unknown contract. Discard all unsupported semantic and state fields, and retain a negative control proving that any letters or numbers stay under Planner authority.

## 2026-08-05 -- A client timeout boundary can masquerade as semantic instability

When multiple real OpenAI attempts end at the exact configured duration with no response body or provider request ID, the earliest failure is the client abort boundary rather than schema validation or the contract compiler.

Keep retries finite and category-gated, but validate the per-attempt budget against deployed latency. A larger bounded attempt window is safer than adding semantic fallback behavior for requests that OpenAI never completed.

## 2026-08-05 -- Temporal repair needs both source grounding and cycle cardinality

OpenAI may correctly understand a date or duration while emitting a normalized span that is not an exact substring of the guest message. Rejecting that span without consulting the deterministic temporal grammar loses a valid task; scanning the entire message for every task instead leaks one room's date into another room's request cycle.

Recover first from the task's verified source. Use the complete current message only for the sole stay-dependent task, preserve ambiguity and past-date failures, and rerun multi-cycle tests whenever shared stay projection changes.

## 2026-08-06 -- A parseable temporal fragment must not erase a broader source constraint

OpenAI can emit a weekday-only temporal span even when the verified task source also contains an explicit month. Accepting the smaller span because it parses successfully converts a constrained calendar request into the next relative weekday and can trigger a real availability query for the wrong date.

Temporal recovery must compare a Planner span with the deterministic grammar's broader source-grounded constraint even when the Planner fragment is independently parseable. If the full constraint still does not identify one date, keep CanonicalRequest and State dates empty, emit no stay-dependent QueryPlan, and ask for an exact date while allowing unrelated ready tasks in the same message to continue.

## 2026-08-06 -- An incidental entity must not erase a controlled task capability

Real Planner variation can keep the correct stateful task type while attaching a catalog entity from a condition in the same clause, or keep the correct requested output while emitting a generic low-risk type. Letting the entity always win can turn a total-price request into an unrelated facility policy; flattening an unresolved explicit property fact to generic unknown loses the Planner's safe semantic classification without making the truth any safer.

Arbitrate only from schema-controlled fields. Preserve an agreeing stateful type, requested output, and stay dependency; let exact formal catalog grounding continue to govern stateless facts; use controlled restriction detail intents for policy shape; and keep missing property truth Unknown through the existing catalog resolver and handoff. Never repair these contradictions from task IDs, case IDs, guest keywords, or whole-message alias scans.

## 2026-08-06 -- Detail intent must be stable across equivalent Planner shapes

OpenAI may classify the same property restriction as availability, amenity, or policy, and may place a formal alias inside a longer entity phrase. Treating candidate type or whole-string entity equality as the sole authority makes policy capability and formal facts disappear across otherwise equivalent outputs.

Use the controlled detail intent before low-risk candidate shape, then require registry compatibility. A longer entity phrase may use catalog grounding only when the Planner phrase itself is source-bound, exactly one formal alias is present, and the task remains within a narrow public detail class. Ambiguous, unbound, or protected tasks must not be promoted.

## 2026-08-06 -- A same-turn supplement still requires a real prior cycle

OpenAI can split one new message into several correct tasks while marking later tasks as `supplement_existing` with an empty cycle-reference array. The relation is structurally impossible, and letting strict validation reject the whole turn loses unrelated grounded tasks.

Normalize only the narrow contradiction in which the turn is explicitly new, a sibling establishes a verified current-source new request, and the supplement has no claimed cycle at all. Keep continuations, modifications, explicit references, and unverified evidence fail closed so relation recovery never invents dialogue history.

## 2026-08-06 -- A strict output schema does not make semantic sampling stable

Structured Outputs guarantees the JSON shape, not that repeated classifications choose the same valid capability fields. When identical inputs alternate between price/policy or amenity/policy despite an explicit prompt, adding more case vocabulary downstream hides the provider-level cause.

Use the provider's supported minimum-variance sampling setting without combining sampling controls, then keep the full deployed matrix as the semantic authority. Lower variance reduces drift; it does not authorize bypassing catalog grounding, readiness, safety, or regression checks.

The complete deployment disproved the first recommendation for this runtime: `temperature: 0` still produced incompatible schema-valid capabilities and regressed three prior PASS cases. Sampling controls are not an acceptable correctness boundary here. Treat Planner output as untrusted semantic input and repair only contradictions that deterministic current-source evidence can prove.

An evidence-bound task source is narrower than the complete guest message and can safely recover a missing time-detail entity only when one formal property fact is uniquely mentioned. The normalized entity must retain that exact source mention; otherwise a correct grounding can still fail the Planner schema because `property_fact` cannot carry an empty raw entity. Do not extend this rule to general empty entities: existing regression coverage proves that would silently infer catalog facts from broad message text.

## 2026-08-06 -- Strict enums need semantic coupling inside generation

A strict schema can require a valid task type and requested-output array while still allowing an internally inconsistent semantic choice. Repeated real OpenAI runs classified one generic lodging-cost intent as either inventory price or an unknown property policy, even though both outputs were structurally valid.

Define capability boundaries at generation time in language-independent domain terms and repeat the essential coupling in the schema descriptions the model uses for Structured Outputs. Require a final task-coverage check, but continue to treat the result as untrusted input: this guidance must not add phrase aliases, decide formal truth, bypass readiness, or replace complete deployed regression evidence.

## 2026-08-06 -- Capability grammar must preserve conditional task shape and risk exclusions

A model can choose the correct price type yet fail the local task contract by combining stay dependency with a null candidate when the guest supplied no dates. Rejecting that task before semantic compilation turns a safe missing-date clarification into a generic handoff. Normalize only the sole-task contradiction to the existing empty top-level stay; never project an unscoped stay across multiple tasks.

Broadening a low-risk policy definition can also absorb credential-disclosure requests unless the high-risk exclusion is equally explicit. Define sensitive access as high-risk inside both instructions and schema, then retain registry-enforced human handoff. Complete deployed comparison is essential because fixing one synonym while regressing another capability or safety route is not progress.

## 2026-08-06 -- Temporal evidence and request capability are independent contracts

A deterministic temporal parser can correctly recover a stay duration while the Planner still emits `unknown`, leaving the request on a generic handoff path. Temporal correctness alone does not establish what the guest is asking the lodging operator to do.

Define the semantic capability at the structured-generation boundary and keep its negative boundary explicit. A lodging reservation arrangement is a booking task, while an unrelated duration is not. Verify both the recovered temporal evidence and the resulting capability, QueryPlan, and FinalResponse in the complete deployed matrix.

## 2026-08-06 -- Booking-process prompt expansion can erase temporal safety

An instruction that makes one duration-only lodging request a booking capability can also absorb date modifications and turn a controlled past-date clarification into a stateless human handoff. It can simultaneously perturb unrelated room-feature and amenity task shapes because the change affects the model's complete capability distribution.

Do not repair this class of residual Planner drift by adding another broad prompt rule. Recover only from verified source and already-structured evidence at a deterministic compiler boundary, and retain negative controls for property facts, policies, context modifications, ambiguity, and past dates. Roll back whenever the complete artifact introduces any prior-PASS regression.

## 2026-08-06 -- Preserving a stateful capability must not erase its stateless subject

A contradictory Planner task can contain two useful controlled signals: a stateful lodging-price output and a stateless property entity. Normalizing the task to a valid price shape by clearing the entity preserves one request but silently discards the other.

Before destructive shape normalization, isolate only a source-bound stateless entity from verified current-event evidence. Keep the original price readiness, deduplicate already represented entities, query only the property catalog for the isolated task, and leave unsupported fees unresolved. This retains coverage without turning an entity mention into a fact or an availability query.

Raw evidence and a Planner canonical candidate can disagree. Ground the isolated subject from raw evidence first, never append both formal entities, and deduplicate unresolved subjects independently of the Planner category; otherwise the repair can manufacture an unsupported second answer.
