# JunZan AI 專案記憶入口

Repository 是 JunZan AI 專案唯一可信知識來源。ChatGPT 對話、Memory 與 Codex Session 只是暫時協作介面；未寫入 Repository 的內容，不視為永久專案知識。

## 目前目標

完成 JunZan AI 第一版在尼腓的家正式導入：先讓 test-only LINE 的 Conversation Engine V2 通過真實驗收，再建立回退點；只有取得使用者逐次明確授權後，才能處理正式 LINE 切換。

## 第一版完成定義

第一版完成必須同時符合：

- 尼腓的家既有 `nephi_home` property、房型、包棟、價格、FAQ 與安全知識正確套用且隔離。
- 後台房況是唯一事實來源；開房或關房後，下一次查詢立即讀到最新資料。
- Conversation Engine 能理解日期、房型、人數、多問題與多輪修改，且不受舊 state 污染。
- 回覆只使用 Resolver 與 property 授權資料；Unknown 不得回答成 No。
- 可回答的子問題完整回答；真正需要人工的子問題才 scoped review／轉真人。
- test-only LINE、完整測試、部署與 health 驗收通過。
- 正式 LINE 有明確回退點，且只在使用者明確授權後切換；真實正式 LINE 驗收通過。

詳細不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。

## 必讀文件

1. [本入口](PROJECT_MEMORY.md)
2. [產品基準](PRODUCT_BASELINE.md)
3. [核心產品憲法](JUNZAN_AI_CONSTITUTION.md)
4. [重大決策](DECISIONS.md)
5. [永久安全規則](SECURITY.md)
6. [下一步任務](NEXT_TASKS.md)

需要查事件原因與產品演進時，再讀 [經驗教訓](LESSONS_LEARNED.md) 與 [重要產品演進](CHANGELOG_INTERNAL.md)。

## 目前最高優先

真實 test-only LINE 驗收 V2 短日期與即時房況鏈路：

1. 連續三次詢問 `7/18 的301可以預訂嗎？`，結果必須 deterministic。
2. 後台將 7/18 的 301 設為可售後，下一次 LINE 查詢立即回答有房。
3. 將同一筆改為不可售後，下一次 LINE 查詢立即回答無房。
4. 驗收 `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？` 的 multi-task 完整性。

## 已知 blocker

- 目前沒有已由程式或部署證據確認的 blocker。
- 真實 test-only LINE 人工驗收尚未完成，因此不得宣稱第一版完成或建議切正式 LINE。
- 多業者共用 service 的 property-scoped LINE binding 核心與最小 platform-admin API 已完成自動驗證；尚缺總後台 LINE 管理 UI，且本次未部署。

## 第一版驗收狀態

- PostgreSQL、multi-property、property 隔離、admin identity、platform admin：完成。
- Onboarding、既有 property 套用、room／bundle mapping、交易與回滾：完成。
- 後台房況、每日／月曆、備註、價格矩陣與手機版：完成。
- LINE 正式／test-only Channel Identity 安全硬隔離：完成。
- Conversation Engine V2 已部署至 test-only；短日期 trust boundary 修正 commit：`0c743642b69c9d671410bb44dc1e8b42735c938a`。
- 完整 `npm test`：最近一次驗證 exit 0（V2 generic availability／available-dates schema、property-backed setting catalog、回覆順序回歸後）。
- Phase 6 local transport E2E：完成（reply／clarification／handoff success+failure、no_reply，以及 FinalDecision/transport alignment）。
- Phase 7 local final response authority：完成（單一 renderer、11-case unit matrix、6-path signed webhook E2E、runtime uniqueness 28/28；完整 `npm test` exit 0）。
- 真實 test-only LINE 最終驗收：進行中。
- 正式 LINE 切換與真實正式驗收：未開始，需使用者明確授權。

## 永久知識維護規則

- 同一知識只由一份主要文件負責，其他文件使用連結，不複製全文。
- 重大決策 append 到 `DECISIONS.md`，不得改寫既有決策歷史。
- 已驗收且不得退步的行為更新 `PRODUCT_BASELINE.md`。
- 重要 bug 與可重複避免的事件更新 `LESSONS_LEARNED.md`。
- 核心能力或安全邊界的重要 commit 以一句摘要更新 `CHANGELOG_INTERNAL.md`。
- 每次正式驗收或優先順序改變，同步更新本文件與 `NEXT_TASKS.md`。
## 2026-07-26 Planner failure diagnostics

- The safe Planner failure diagnostic checkpoint is on `phase1-4-authoritative` at `5f862ff2be3c45c8383efcec2b502f8886a775ac`. It extracts only sanitized OpenAI `error.type`, `error.code`, and `error.param` from non-2xx JSON responses; non-JSON responses retain the original HTTP failure with empty provider fields.
- Targeted safety coverage includes 400 JSON and non-JSON responses, field allowlisting/truncation, 401, 404, 429, 5xx, timeout, empty response, parse, configuration, generic failure, sensitive-field exclusion, callback isolation, FinalDecision stability, and signed webhook LINE delivery.
- Phase 6/7 regressions and runtime uniqueness pass; the completed full `npm.cmd test` returned OS exit 0, reached the final runner, and produced empty stderr.
- The diagnostic extension has been pushed; deployment and operational Render/LINE verification remain separately authorized work.

## 2026-07-26 OpenAI strict Planner schema compatibility

- The confirmed OpenAI `invalid_json_schema` at `text.format.schema` traced to `contextRelationCandidates[].evidenceRefs[]`: `eventId` and `messageRef` were declared properties but absent from `required`.
- The local fix requires both fields while retaining empty-string support, relation/evidence validation, offsets, quote rules, strict mode, and all Planner semantics.
- The recursive schema audit, targeted contracts, Phase 6/7 regressions, runtime uniqueness, and one complete `npm.cmd test` all pass with exit 0 and empty stderr.
- The strict-schema fix remains local for review; no push, deployment, Render operation, LINE operation, model, credential, or environment change is part of this task.

## 2026-07-26 Safe context-validation diagnostics

- Test-only traces now expose allowlisted `context_validation` rejection paths and candidate summaries: index, relation kind, request-cycle reference count, evidence count, and per-evidence source-match booleans.
- Integration coverage includes accepted evidence, real validator rejection, hostile sensitive payload exclusion, and unchanged `context_relation_invalid` handoff behavior.
- Relation/evidence, Planner-failure, Phase 6/7 transport, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0 and empty stderr.
- The safe diagnostic checkpoint `35acec8d070726df1029d324028f665d76e8493f` is pushed; no deployment, Render operation, LINE operation, or credential change occurred.

## 2026-07-26 Canonical Planner evidence coordinates

- A production-equivalent replay of `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？` reproduced three source mismatches and `context_relation_invalid` before the fix.
- Deterministic normalization now replaces Planner coordinates only for a unique exact task `sourceText` occurrence in a uniquely identifiable source event, immediately before the unchanged context validator.
- The replay now produces three successful evidence source matches and continues through temporal, FormalRequest, QueryPlan, and executor without a parking classification change.
- Exact-match edge cases, relation/evidence defenses, Planner semantics/fallback, Phase 6/7, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0 and empty stderr.
- The fix remains local pending review; no push, deployment, Render operation, LINE operation, model, credential, or environment change occurred.

## 2026-07-27 Parking routing and mixed results

- A real test-only replay proved that canonical `parking` was structurally valid but incorrectly retained the `availability` capability, so it requested stay dates instead of reading the property-scoped parking fact.
- The local fix deterministically maps canonical `parking` to the shared property-catalog amenity capability and prevents the availability Resolver from running for parking questions.
- Mixed answer plus clarification/review plans now preserve deterministic per-task sections; a scoped unknown no longer converts safe answered sections into `claim_validation_failed`, while high-risk tasks still require handoff.
- The real three-question regression, single parking variants, Phase 6/7 regressions, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0. No push, deployment, Render operation, LINE operation, or credential change is authorized here.

## 2026-07-27 Deterministic Composer claim contract

- Production-equivalent signed-webhook RED replay proved that availability, parking, BBQ, and pool all reached `answered` with correct sources, but the Composer was asked to paraphrase while the validator required the exact deterministic section. Every case failed first at `ungrounded_section_text` and ended in `claim_validation_failed`.
- The local fix supplies exact per-task text to the Composer and constrains strict structured output to those values. Claim Validator remains active and now explicitly rejects answered sections lacking a fact source.
- The four single-answer cases and the room/parking/BBQ mixed case now produce accepted composition, complete coverage, `claimValidation.ok=true`, and `FinalDecision=reply`.
- Safety gates, Phase 6/7, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0 and empty stderr. The fix remains local; no push, deployment, Render, LINE, or credential operation is authorized.

## 2026-07-27 Canonical Temporal Authority

- One local `resolveCanonicalTemporal()` boundary now converts Planner candidates into the only executable temporal result, with `absent`, `resolved`, and `unresolved` as the complete status set.
- Relative days, weekdays, weekends, absolute dates, ranges, and night counts use a fixed property timezone and injectable clock. State clears stale stay dates on unresolved current intent, and FormalRequest no longer restores dates from state.
- Fixed-clock signed-webhook regressions cover availability plus parking, BBQ, and pool, with Composer acceptance, Claim Validator pass, FinalDecision reply, and one LINE mock call.
- Targeted gates and one complete `npm.cmd test` pass with OS exit 0 and empty stderr. The real-provider 20-run stability matrix was not rerun because this local environment has no test OpenAI key or model setting.
- The fix remains local; no push, deployment, Render operation, LINE operation, credential change, or environment change occurred.

## 2026-07-27 Persistent safe Planner provider diagnostics

- Test-only `planner_error` application logs now persist the trace ID plus attempt count, normalized HTTP status, timeout, sanitized provider type/code/param, safe category, retryability, response-body presence, and parsed-output presence.
- Failure categories distinguish timeout, rate limit, provider 5xx, invalid request, empty response, JSON parse, structured output, network, and unknown without retaining raw provider content.
- At this diagnostic checkpoint the provider still performed exactly one request. Planner failure still followed `planner_parse_failed` to the existing safe handoff and LINE delivery path.
- Targeted Planner, Phase 6/7, runtime-uniqueness tests and one complete `npm.cmd test` pass with exit 0 and empty stderr.
- The diagnostics remain local pending review; no push, deployment, Render operation, LINE operation, credential read, or environment change occurred.

## 2026-07-27 Bounded Planner provider retry

- A real test-only stability replay completed 139/140 requests; the only failure was a first-attempt OpenAI Planner timeout classified as retryable before downstream processing began.
- The OpenAI Planner provider now retries exactly once after `timeout`, `network`, `rate_limit`, or `provider_5xx`, with a 100 ms default delay bounded to at most 1000 ms and a hard total limit of two attempts.
- Invalid requests, non-429 4xx responses, empty responses, JSON parse failures, structured-output failures, unknown/configuration failures, and local Planner contract failures remain single-attempt failures.
- Retry success resumes the unchanged validation and conversation pipeline. A second failure retains `planner_parse_failed`, the existing safe handoff, and existing LINE delivery behavior.
- Targeted regressions and one complete `npm.cmd test` pass locally. The change remains local pending review; no push, deployment, Render, LINE, credential, or environment operation occurred.

## 2026-07-27 Canonical Request core convergence

- Five local stop gates established the permanent golden suite, property data roundtrip contract, immutable CanonicalRequest/capability registry, compact date-range grammar, and sole semantic-writer cutover.
- The active Engine now invokes one `canonicalizeExecutionItem()` boundary. CanonicalRequest-backed consumers preserve mixed availability/property-fact routing, stale-date protection, claim validation, FinalDecision safety, and signed-webhook transport behavior.
- The change remains local pending review. The three draft Canonical Request planning files and all historical verification artifacts remain untracked and excluded.

## 2026-07-28 Property-neutral runtime cleanup

- Onboarding authorization now comes from authenticated account/session membership or the existing platform-admin grant, with no runtime property allowlist.
- JSON/PostgreSQL availability and bundle updates now derive inventory and members from property-scoped records. Shared import and seed code no longer assumes a room count, room number, bundle ID, or property ID.
- Historical Nephi initialization identifiers remain only in explicit fixtures/migrations; they are not imported as routing rules.
- The implementation remains local pending final verification and review. The three draft Canonical Request documents and historical verification artifacts remain untracked and excluded.

## 2026-07-29 Friendly operator onboarding intake

- The unrestricted public draft-creation boundary was replaced with platform-admin-issued, expiring, revocable invitation links.
- Existing onboarding staging tables remain authoritative for drafts and submissions; formal property data is unchanged until the existing approval workflow runs.
- The targeted gate covers partial draft save, refresh/read-back, idempotent submit, invalid/expired/revoked tokens, Alpha/Beta isolation, transaction rollback, admin visibility, frontend preservation, and formal-data non-pollution.
- The permanent test-only Blueprint now uses migration-only startup and the dedicated Render host for invite, resume, and admin-setup URLs.
- One wrong-host fake Alpha application was uniquely identified by its original invitation authority and removed as a single staging-only transaction after proving it was submitted, unapproved, and unrelated to any formal property, LINE binding, or formal fact.

## 2026-07-29 Property-scoped LINE connection setup

- Platform administrators can create and revoke expiring, one-time setup links for an existing formal property. Only the token hash is stored; API lists never return either the raw token or its hash.
- The public setup token is the sole property authority. Credential submission ignores any frontend property ID and atomically revalidates the locked token, upserts the existing AES-256-GCM property binding, and marks the token used.
- Invalid, expired, revoked, and used links are rejected distinctly. Missing encryption configuration or any binding transaction failure leaves the token unused and no partial binding.
- Raw setup authority stays in the URL fragment, is removed from history before the first request, and reaches resolve/redeem only in a POST body under a no-referrer policy. Query-string resolution is rejected.
- The platform page exposes safe binding status and the property webhook URL. The operator page accepts only Channel Secret and Channel Access Token, clears them after success, never persists them in browser storage, and never reads them back.
- Webhook-observed status is best-effort telemetry: its storage failure cannot turn a valid signed webhook into a failed delivery.
- The targeted setup runner, existing LINE binding runners, authorization/onboarding gates, runtime uniqueness, and one complete `npm.cmd test` pass locally. The branch is pending review and was not deployed; no Render, LINE, database, credential, or formal-environment operation occurred.

## 2026-07-29 Limited core fixes from the 90-run validation

- The 90-run evidence exposed a stale Composer-rejection flag: a rejected OpenAI candidate was replaced by a valid deterministic reply, but FinalDecision still received `claimValidation.ok=false`. FinalDecision now consumes only the Claim Validator result for the final candidate.
- Pool routing now repairs a missing or conflicting Planner canonical candidate only when the entity raw text resolves uniquely to an existing low-risk property-catalog capability. Canonical `pool` is normalized to the property-catalog amenity route without stay-date readiness.
- The minimal `民宿在哪裡？` replay passes Planner, semantic/context validation, CanonicalRequest, FormalRequest, and the property-catalog executor. Its prior final handoff is reproduced only when the Composer candidate is rejected, proving it shares the stale fallback-state defect rather than an independent location defect.
- The new three-case regression, related property-fact/location/Planner/Claim/FinalDecision/signed-webhook/runtime gates, Canonical Request golden gate, and one complete `npm.cmd test` pass with exit 0.
- The branch remains pending review. The 90-run real-provider matrix was not rerun, and no deployment, Render, LINE, database, credential, onboarding, or formal-data operation occurred.

## 2026-07-29 Provider-shaped pool and parking routing follow-up

- The remaining pool failure was reproduced with the real provider shape: canonical `pool` is stored under catalog `policies` with `category=policy`. The previous amenity fixture did not exercise that contract.
- The pool capability now accepts the provider policy category. Entity-specific canonical routes require their own registered candidate type, preventing a resolved or generic policy from falling through to `bbq`, `parking`, or another capability.
- When Planner omits entity text, grounding may recover pool or parking only from one unique exact alias in the current property's catalog. Conflicting non-empty text, ambiguous aliases, and unregistered aliases remain on the safe unresolved path.
- Two-property fixtures verify distinct answers and category fidelity. Targeted and related canonical/property-routing/Planner contracts plus one complete `npm.cmd test` pass locally with exit 0 and empty stderr.
- No date, availability, Temporal, Composer, Claim Validator, FinalDecision, onboarding, LINE setup, credential, formal-data, Render, or production behavior was changed. The real-provider 90-run matrix was not rerun.

## 2026-07-29 Final parking recovery and shared location contract

- The remaining 90-run parking shape was reproduced with `type=availability`, `canonicalCandidate=null`, non-empty unresolvable raw entity text, and both `room_feature` and `amenity` categories.
- Complete task source grounding now runs only after raw resolution returns not-found and finds one exact alias in the current property catalog. Registered low-risk `property_catalog` policy remains mandatory; conflicting resolved entities, ambiguous sources, unregistered aliases, and unregistered capabilities stay unresolved.
- Direct location/address/map/navigation and every property-to-place nearby, distance, duration, or directions request share the existing location capability. The runtime returns only the current property's approved Google Maps URL, never searches or estimates external facts, and keeps other valid mixed tasks.
- Targeted and related canonical/property-routing/location/Planner/runtime gates pass locally. One complete `npm.cmd test` passed with exit 0 and empty stderr; this change has not been deployed and the 90-run real-provider matrix has not been rerun.

## 2026-07-30 Operator console convergence and controlled custom replies

- The operator console now leads with availability, room/pricing, bundle offers, and custom replies. Profile and formal property-fact settings remain intact under a collapsed `其他必要設定` section.
- Availability defaults to 15 consecutive local dates starting today and loads every involved month, while the existing monthly calendar and all room/bundle status and note operations remain available.
- Room highlights are used by the guest availability page but are not consumed by the conversation runtime. The operator label is now `房型特色（選填，最多3項）`; blank entries continue to be normalized out.
- Each property may keep at most five controlled custom replies. Rules are property-scoped, date/status/scope validated, reject overlapping enabled definitions, and are stored in JSON or PostgreSQL through the same provider boundary.
- Planner and CanonicalRequest still determine each task first. Only after formal Resolver execution may one unique active rule match the understood topic, stay date, and room/bundle scope. The approved text is additive to that task; all unmatched mixed tasks retain their original Resolver outcomes.
- Formal pricing facts cannot be replaced by a `價格尚未公告` rule. A structural conflict or multiple matches safely becomes Unknown/review rather than asking AI to choose.
- No public unauthenticated test API, property-specific branch, deployment, Render operation, LINE operation, credential access, or formal-data mutation was introduced.

## 2026-07-30 Conversation State V3 runtime cutover

- ConversationEngineV2 now reads and writes the Phase 1 Conversation State V3 contract. Property, channel, and user remain the persistence scope; V2 cycles and pending requests are compatibility-read inputs only.
- One V3 reducer performs the only state write after CanonicalRequest, unified readiness, QueryPlan, and execution outcomes are available. A unique pending lodging task may consume a date or guest-count-only turn even when Planner labels it as a new request.
- Lodging queries now carry `any`, `room_type`, or `bundle` through CanonicalRequest and a normalized Resolver task. Bundle capability selection is independent of readiness, so an undated bundle question remains pending instead of becoming Unknown.
- Repeated Planner task IDs start isolated V3 tasks unless an accepted context relation explicitly continues an existing task. Mixed tasks remain independently stored and expired tasks are excluded from context reuse.
- Same-turn duplicate task IDs fail at the Planner schema boundary. Accepted end relations persist `cancelled` on only the referenced task, including silent no-reply turns; unresolved lodging products persist `needs_human` instead of failing the V3 write.
- Event replay coverage uses the real Engine plus the persisted atomic event claim: a concurrent duplicate and a replay after coordinator restart do not perform a second state write.
- Phase 1 contracts, provider-shaped two-property fixtures, runtime incident regressions, event replay, existing core/LINE/onboarding/admin gates, and the complete repository test suite pass locally. The branch is pending review and was not deployed.

## 2026-07-31 Unique core convergence

- Local convergence is in final verification: V3 reducer owns task/product/context transitions, new products require exact property-catalog resolution, and Canonicalizer consumes only the approved transition result.
- Planner entities that are empty, ambiguous, unregistered, or forged remain unresolved; no full-source alias scan or capability-ID-specific repair is allowed.
- Before release review, require the complete `npm.cmd test` result from the final worktree state. Do not deploy, merge, operate Render/LINE, or access credentials/formal data.
