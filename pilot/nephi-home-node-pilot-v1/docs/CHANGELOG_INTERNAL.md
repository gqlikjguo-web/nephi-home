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

## 2026-07-23 — Dialogue-act and temporal state boundary

- Added cross-field acknowledgement normalization, canonical temporal intent validation, and a current-turn state boundary that blocks unresolved date attempts from reusing an earlier stay date.
## 2026-07-26 — Phase 6 transport final-decision alignment

- Test-only LINE transport diagnostics now report reply failures through the injected server-factory seam with the stable `reply_failed` outcome, matching the FinalDecision action without exposing request or credential data.
- The transport seam now preserves safe logging, isolates callback exceptions, and keeps the main event record aligned with FinalDecision through delivery failures.

## 2026-07-26 — Phase 7 FinalDecision response-content authority

- Added one final response renderer after Claim Validator so reply, clarification, handoff, claim-rejection fallback, Composer-exception fallback, and no_reply content remain aligned with the existing FinalDecision without adding a second action authority.

## 2026-07-26 — Safe Planner failure diagnostics

- Added allowlisted `planner_error` traces for authentication, model/provider, rate-limit, timeout, parse, empty-response, configuration, and unknown failures without changing Planner fallback or LINE delivery.
- Added sanitized OpenAI invalid-request `type`, `code`, and `param` diagnostics; provider messages and raw response bodies remain excluded.

## 2026-07-26 — OpenAI strict Planner schema compatibility

- Required both `eventId` and `messageRef` in every evidence reference, with the unused identifier represented by an empty string, and added a recursive strict-schema contract runner without changing relation/evidence semantics.

## 2026-07-26 — Safe context-validation diagnostics

- Added a test-only `context_validation` trace projection with allowlisted rejection paths, candidate index, relation kind, cycle/evidence counts, and per-evidence source-match booleans.
- Raw quotes, guest text, evidence identifiers, property data, and credentials remain excluded; Planner, validator, relation, and fallback behavior are unchanged.

## 2026-07-26 — Canonical Planner evidence coordinates

- Added deterministic exact-match normalization between semantic validation and context validation so a uniquely present task `sourceText` receives canonical event/message identifiers, offsets, and quote without weakening the evidence validator.
- Missing, empty, repeated, ambiguous, or unidentifiable sources remain unchanged and continue to the existing safe rejection path.

## 2026-07-27 — Canonical parking route and scoped mixed results

- Canonical parking questions now use the property-scoped fact catalog without stay dates or availability resolution, and mixed answer plus incomplete sections preserve safe per-task output without weakening Claim Validator or mandatory high-risk handoff.

## 2026-07-27 — Deterministic Composer claim contract

- The test-only OpenAI Composer now returns only strict-schema-enumerated deterministic task sections, while Claim Validator additionally rejects answered sections with no fact source; coverage and fabricated-claim defenses remain unchanged.

## 2026-07-27 — Canonical Temporal Authority

- Added one deterministic temporal authority for relative days, weekdays, weekends, absolute dates, ranges, and night counts, using the property timezone and an injectable clock.
- State and FormalRequest now consume the canonical result without restoring stale dates; fixed-clock unit, state, signed-webhook, mixed-capability, and runtime-uniqueness gates prevent a second active temporal writer.

## 2026-07-27 — Persistent safe Planner provider diagnostics

- Test-only application logs now retain an allowlisted, trace-ID-addressable Planner provider failure record covering attempt count, HTTP/timeout state, sanitized provider fields, safe category, retryability, and response/output presence.
- Added timeout, 400/429/5xx, empty-response, JSON-parse, structured-output, network, no-retry, fallback-isolation, and sensitive-data-exclusion coverage without changing Planner requests or business behavior.

## 2026-07-27 — Bounded transient Planner retry

- Added one category-gated retry at the OpenAI Planner request boundary for timeout, network, rate-limit, and provider-5xx failures, with a hard two-attempt cap and bounded delay.
- Added allowlisted retry outcome diagnostics plus retry/no-retry, exhausted fallback, callback isolation, local-contract, and sensitive-data-exclusion coverage.

## 2026-07-27 — Canonical Request semantic authority

- Added one property-neutral Canonicalizer that freezes capability, entity, canonical temporal, dependency, required fields, resolver, risk, response mode, and evidence binding.
- Cut the active State → FormalRequest → QueryPlan → Executor → ResponsePlan path over to immutable `CanonicalRequest`, with safe canonical diagnostics and mutation guards against duplicate writers.

## 2026-07-28 — Property-neutral support runtime

- Replaced hardcoded onboarding property scope, room slots, bundle membership, availability imports, and PostgreSQL seed guards with authenticated scope and property-scoped inventory relations.
- Added a permanent property-neutral runtime regression covering two-property authorization, distinct bundle members, missing mappings, explicit idempotent seed input, and forbidden runtime identifiers.

## 2026-07-29 — Invitation-scoped onboarding submissions

- Added platform-admin-issued onboarding invitations with expiry and revocation, partial draft persistence, safe read-back, idempotent submission, and admin review visibility on the existing staging workflow.
- Rejected unauthenticated draft creation and added permanent isolation, rollback, invalid-field, frontend-preservation, and formal-data non-pollution coverage.

## 2026-07-29 — Test-only onboarding deployment contract

- Removed automatic PostgreSQL seeding from the test-only Blueprint start command and bound test-only onboarding URLs to the dedicated Render host.
- Added a permanent deployment contract gate for start command, public base URL, and invite/resume/admin-setup URL generation.
- Made the runtime uniqueness source scanner portable across LF and CRLF worktrees without changing any uniqueness assertion.

## 2026-07-29 — Property-scoped LINE connection setup

- Added platform-admin-issued one-time LINE setup links, fragment-only token delivery, atomic encrypted credential redemption, safe status APIs, mobile Chinese management/operator pages, best-effort webhook-observed status, and permanent isolation/duplicate-request/lock-contract/post-upsert rollback/non-disclosure tests without changing the conversation core or legacy test-only LINE binding.

## 2026-07-29 — Limited core fixes from the 90-run validation

- FinalDecision now uses the Claim Validator result for the final deterministic fallback instead of stale rejection state from a discarded Composer candidate.
- Added unique exact property-catalog grounding for missing/conflicting low-risk canonical candidates and normalized canonical pool requests to the property-catalog amenity route.
- Added permanent fallback, pool isolation/routing, and location-stage regressions while preserving real claim rejection and mandatory safety handoff.

## 2026-07-29 — Provider-shaped pool and parking routing guard

- Accepted provider `policy` records for the registered pool capability and constrained entity-specific canonical routing to one catalog-backed capability definition.
- Added unique exact catalog grounding for missing pool/parking Planner entities, with two-property isolation plus ambiguous, unregistered-alias, detail-intent, and real-category fixture regressions.

## 2026-07-29 — Exact parking recovery and broad property-map contract

- Extended safe catalog grounding to real provider tasks whose non-empty raw entity is unresolvable, while rejecting conflicting registered entities, ambiguous sources, unregistered aliases, and unregistered capabilities.
- Unified direct and property-to-place location semantics on the existing property-scoped `location` capability, returning only the current property's approved Google Maps URL and preserving other mixed tasks.

## 2026-07-30 — Operator console and property-scoped controlled replies

- Reordered the operator console around availability, room/pricing, bundles, and custom replies; moved existing profile and formal fact controls into collapsed other settings.
- Added a cross-month recent-15-day availability view while preserving the existing monthly calendar and inventory operations.
- Retained guest-facing room highlights as optional room features, documented that they are not AI facts, and kept blank-value normalization.
- Added a five-rule property-scoped custom-reply store, authenticated CRUD UI/API, PostgreSQL migration, overlap and data validation, active-state calculation, and two-property isolation.
- Added a post-Resolver unique-match boundary that consumes Planner/CanonicalRequest semantics without keyword FAQ matching, preserves mixed Resolver tasks, and safely rejects ambiguity or formal pricing conflict.

## 2026-07-30 — Conversation State V3 runtime authority

- Cut ConversationEngineV2 over to one V3 reducer and compatibility-only V2 reads.
- Added deterministic single-pending slot recovery, isolated repeated task IDs, and mixed-task preservation.
- Standardized lodging products and Resolver inputs, including pending and executable bundle availability.
- Unified active and legacy FormalRequest readiness on the Phase 1 readiness contract.
- Added explicit end-state cancellation, same-turn duplicate task-ID rejection, unresolved-product safe state, and persisted event-replay coverage across coordinator restart.

## 2026-07-31 — Unique core convergence

- Removed legacy full-source alias recovery and canonical-ID-specific parking, pool, and location task repairs.
- Made V3 reducer transitions authoritative for continuation topic/product and catalog-validated for new room/bundle products; Canonicalizer now consumes that approved result.
- Replaced stale semantic expectations with data-driven resolved/unresolved, property isolation, mixed-result, follow-up, and forged-product regressions.
- Normalized ungrounded acknowledgement fragments before execution and preserved catalog-validated current products when V3 continuations reuse approved stay dates.
- Wired the production property-scoped LINE webhook to record valid receipts separately from observed receipts after binding, signature, JSON, and property validation.
- Aligned the PostgreSQL valid-webhook RPC with its property-ID contract and enforced existing LINE credential format validation before setup-token redemption.
- Removed active LINE transport reads of compatibility `result.shouldReply` and `result.replyText`; both registered handlers now consume only the rendered `finalResponse` delivery fields.
- Restored structural V3 pending arbitration for isolated date, nights, guest-count, and room slots while preserving complete new requests as separate tasks; temporal context now derives check-out from an approved check-in plus current-turn nights inside the sole temporal resolver.
- Realigned constitution, response-planning, and safe temporal trace fixtures with the unique FinalDecision/Composer/CanonicalRequest boundaries so test-only CI checks active authority instead of obsolete symbols or intentionally redacted fields.

## 2026-08-01 — FinalResponse empty-reply guard

- Split legal `shouldReply=false` silence from invalid blank rendered replies in both active LINE handlers.
- Added test-only and property-scoped transport regressions proving blank replies are not sent or recorded as `no_reply`, and are persisted with `final_response_empty_reply` for review.

## 2026-08-01 PostgreSQL availability authority repair

- Added migration 020 to convert complete legacy availability days into normalized property-scoped room and formal bundle inventory, and removed the active PostgreSQL legacy-table overlay.
- Added a true PGlite regression for untouched first-query frontend/admin/LINE consistency, adjacent dates, restart persistence, bundle relations, idempotence, and cross-property isolation.
- Removed the temporary test-only startup diagnostic, its fixed scope, and its provider RPC after deployment logs established the root cause and corrected data chain; retained only the permanent authority regression.

## 2026-08-01 Test-only dual-user LINE trace

- Added a test-only, property- and message-hash-scoped 72-hour PostgreSQL trace for `state_before`, pending state, Planner, validation, CanonicalRequest, temporal resolution, availability Resolver request/response, FinalDecision, FinalResponse, and actual LINE transport text.
- Added existing-admin-authenticated, property-scoped read access and fail-closed gates for non-test, unauthenticated, unconfigured, unrelated-message, and cross-property requests.
- Stored only hashed LINE user/channel identifiers and allowlisted diagnostic fields; raw identities, source/evidence text, credentials, cookies, database URLs, and personal data are excluded.

## 2026-08-04 Deployed test-only conversation acceptance

- Added a dual-gated test-only acceptance route contract with existing platform-admin authorization plus commit-bound GitHub Actions OIDC verification.
- Added allowlisted FinalResponse, FinalDecision, Claim Validator, task source/fact, and safe trace evidence without returning prompts, provider objects, or credentials.
- Added a health-pinned, no-retry deployed conversation matrix job that runs only after the existing test-only CI verification succeeds.
