# JunZan AI New Controlled Reply Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coupled pre-canonical understanding/dialogue core with one per-unit, evidence-validated, lifecycle-independent core while preserving all existing downstream authorities.

**Architecture:** One OpenAI structured response produces immutable semantic units. Dedicated validators establish evidence, semantic, Context, lifecycle, and routing validity; only ANSWER units cross a compatibility adapter into the unchanged `canonicalizeExecutionItem()` boundary. Shadow proves behavior and zero side effects before an atomic composition-root cutover.

**Tech Stack:** Node.js/CommonJS, OpenAI Structured Outputs, existing Conversation Engine V2 contracts, PostgreSQL providers, state-v3 reducer, repository contract runners.

**Spec:** `docs/superpowers/specs/2026-08-28-new-controlled-reply-core-design.md`

## Global Constraints

- OpenAI is the sole natural-language understanding authority; deterministic code never reinterprets raw guest text.
- Do not modify Resolver, PostgreSQL facts authority, Temporal authority, CanonicalRequest semantics, state-v3 persistence schema, FinalDecision, FinalResponse, or LINE transport behavior.
- No keyword, regex, fixed sentence, property-specific patch, second AI call, second classifier, second facts authority, or `automaticPendingRelation` replacement.
- Every runtime task begins with a production-shaped RED and stops on any protected regression.
- REAL_OPENAI variance-sensitive cases run at least five times and require the intended C11 marker.
- Shadow cannot write state/message/review, call Resolver, mutate DB, or send LINE.
- Development occurs only on `test-only/node-pilot-integration`; production integration is a separately approved cutover phase.

---

### Task 1: Lock executable acceptance metadata

**Files:**
- Create: `tests/fixtures/new-core-acceptance-manifest.json`
- Create: `tests/new-core-acceptance-manifest-runner.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: acceptance IDs and classifications from the matrix spec.
- Produces: `loadNewCoreAcceptanceManifest(): AcceptanceManifest` and a gate that rejects duplicate/missing IDs, missing evidence links, and fake-as-real classifications.

- [ ] Write a failing manifest runner asserting all expanded acceptance IDs are unique, every evidence row references existing rule/contract/case IDs, and every test declares its evidence level.
- [ ] Run `node tests/new-core-acceptance-manifest-runner.js`; expect failure because the manifest does not exist.
- [ ] Add the manifest as metadata only; do not copy legacy expected final text or let the fixture define runtime fields.
- [ ] Run the runner and `npm run verify:codex-integrity`; expect PASS at `STRUCTURED_CONTRACT_TEST` level.
- [ ] Commit only the manifest, runner, and package script.

### Task 2: Add C01 and immutable Turn Input Adapter

**Files:**
- Create: `lib/new-core/contracts/understanding-turn-input.js`
- Create: `lib/new-core/turn-input-adapter.js`
- Create: `tests/new-core-turn-input-contract-runner.js`

**Interfaces:**
- Consumes: verified property binding, current normalized source events, bounded recent conversation, state-v3 referenceable snapshot, public catalog metadata.
- Produces: `buildUnderstandingTurnInput(args): UnderstandingTurnInput` and `validateUnderstandingTurnInput(value): ValidationResult`.

- [ ] Write RED cases AC-CON-001..004 and AC-ISO-001..004, including forged query property and cross-property cycle rejection.
- [ ] Run the targeted runner; expect `TURN_INPUT_INVALID`/`PROPERTY_SCOPE_INVALID` assertions to fail before implementation.
- [ ] Implement immutable construction and closed-schema validation; omit facts answers, credentials, private notes, test case IDs, and mutation handles.
- [ ] Run targeted and existing property LINE binding/isolation runners; expect PASS.
- [ ] Commit C01 and its tests.

### Task 3: Add C02-C05 OpenAI wire schema without a provider call change

**Files:**
- Create: `lib/new-core/contracts/understanding-output-v1.js`
- Create: `lib/new-core/contracts/semantic-unit-candidate.js`
- Create: `lib/new-core/contracts/source-evidence.js`
- Create: `lib/new-core/contracts/context-link-candidate.js`
- Create: `tests/new-core-wire-schema-runner.js`

**Interfaces:**
- Consumes: JSON-compatible candidate output.
- Produces: validators for C02-C05 with exact failure codes; no normalization or provider request.

- [ ] Write RED for AC-WIR-001..008, AC-SEM-001..010, and malformed C05 IDs/targets.
- [ ] Run the targeted runner; expect missing modules.
- [ ] Implement closed enums, cardinality, uniqueness, and tuple shape only; keep semantic checks out of wire validation.
- [ ] Apply the approved C03 temporal/slot wire shapes: closed temporal `{rawText,kind,checkInCandidate,checkOutCandidate,nightsCandidate}` and source-bound slot `{slotCandidateId,slot,operation,value,evidenceRefs}`; do not add a second representation.
- [ ] Run targeted plus existing strict-schema tests; expect old tests unchanged and new tests PASS.
- [ ] Commit contract types/validators.

### Task 4: Implement the sole Source Evidence Validator

**Files:**
- Create: `lib/new-core/source-evidence-validator.js`
- Create: `tests/new-core-source-evidence-runner.js`

**Interfaces:**
- Consumes: C01 source events and C04 refs.
- Produces: `validateAndNormalizeSourceEvidence(refs, sourceEvents): EvidenceValidationResult` with immutable validated refs.

- [ ] Write AC-EVD-001..010 RED, including UTF-16, unique exact relocation, ambiguous match, and cross-event conflict.
- [ ] Run targeted RED and record exact failures.
- [ ] Implement only same-source exact-coordinate validation and unique exact quote relocation; never inspect catalog/intent.
- [ ] Run targeted plus current relation/evidence normalizer regressions; expect PASS.
- [ ] Add a static gate proving no other new-core module changes evidence coordinates.
- [ ] Commit evidence authority.

### Task 5: Implement Semantic Unit Validator and property identity checks

**Files:**
- Create: `lib/new-core/semantic-unit-validator.js`
- Create: `lib/new-core/capability-subject-policy.js`
- Create: `tests/new-core-semantic-unit-runner.js`

**Interfaces:**
- Consumes: validated C03/C04, public property catalog identity set, existing capability registry projection.
- Produces: `ValidatedSemanticUnit` or one C03 failure code; fields remain semantically unchanged.

- [ ] Write RED for capability/subject/stay independence, availability+bundle, external place, facts, invalid IDs, and mutation attempts.
- [ ] Run targeted RED.
- [ ] Implement compatibility validation tables that accept/reject tuples but never replace a field.
- [ ] Run semantic, availability, price, property fact, amenity, location, temporal, and canonical affected tests.
- [ ] Commit semantic validation.

### Task 6: Implement Context Link Validator and Lifecycle Manager

**Files:**
- Create: `lib/new-core/context-link-validator.js`
- Create: `lib/new-core/lifecycle-manager.js`
- Create: `lib/new-core/state-v3-lifecycle-adapter.js`
- Create: `tests/new-core-context-lifecycle-runner.js`

**Interfaces:**
- Consumes: validated C03/C05, C01 referenceable state snapshot.
- Produces: C06 and existing reducer-compatible operations; no executable task requirement.

- [ ] Write RED AC-CTX-001..018, AC-LIF-001..018, AC-PND-001..008, including lifecycle-only end and protected pending.
- [ ] Run targeted RED.
- [ ] Implement exact START/CONTINUE/MODIFY/END/NONE invariants and slot provenance; do not call `automaticPendingRelation()`.
- [ ] Apply the approved Task 6 clarification: C06 status is the closed `VALIDATED` decision status; the adapter emits a branded closed `lifecycleOperations[]` input to the sole existing reducer; only existing V3 `guestCount`, lodging-product, and cancellation concepts persist, while transport/unmapped `other_supported` remain turn context and context-only updates may own zero C08.
- [ ] Run targeted plus multi-cycle, dialogue-temporal-state, pending-arbitration, and state-v3 regressions.
- [ ] Prove persisted state schema and DB migrations are byte-identical.
- [ ] Commit Context/lifecycle boundary.

### Task 7: Implement Per-unit Reply Router

**Files:**
- Create: `lib/new-core/unit-reply-router.js`
- Create: `lib/new-core/contracts/unit-routing-decision.js`
- Create: `tests/new-core-unit-routing-runner.js`

**Interfaces:**
- Consumes: validated semantic unit, lifecycle decision, registry readiness policy, explicit operator/risk basis.
- Produces: C07 exactly once per unit.

- [ ] Write RED for AC-NRP-001..012, AC-HOF-001..010, answer/clarify rules, and unknown non-shortcut behavior.
- [ ] Run targeted RED.
- [ ] Implement the route truth table from C07; no raw text access is accepted by the function signature.
- [ ] Run targeted plus acknowledgement, no-reply, pending, high-risk, and planner-failure safety regressions.
- [ ] Commit unit routing.

### Task 8: Implement Unit Aggregator and partial outcomes

**Files:**
- Create: `lib/new-core/unit-aggregator.js`
- Create: `lib/new-core/contracts/unit-aggregation-result.js`
- Create: `tests/new-core-unit-aggregation-runner.js`

**Interfaces:**
- Consumes: validated units and their C06/C07 plus later downstream outcome refs.
- Produces: C09 with exact unit coverage; no text composition.

- [ ] Write RED AC-MUL-001..014 and AC-PAR-001..010, including invalid sibling isolation and answer+handoff.
- [ ] Run targeted RED.
- [ ] Implement stable ordering and 1:1 unit outcome coverage; never promote a turn-level route.
- [ ] Run targeted plus existing multi-question/partial FinalDecision runners without modifying their expected behavior.
- [ ] Commit aggregation.

### Task 9: Implement C08 compatibility adapter

**Files:**
- Create: `lib/new-core/canonical-execution-adapter.js`
- Create: `lib/new-core/contracts/canonicalizer-input-item.js`
- Create: `tests/new-core-canonical-adapter-runner.js`

**Interfaces:**
- Consumes: ANSWER C07, validated C03/C04/C06, property scope.
- Produces: one current `canonicalizeExecutionItem()` argument per unit; adapter-local candidate index.

- [ ] Write RED AC-CAN-001..012 and the availability historical regression.
- [ ] Run targeted RED.
- [ ] Implement field mapping with stable unit evidence; generate candidateIndex only inside invocation scope and discard it afterward.
- [ ] Run canonical, Temporal, readiness, availability, price, facts, and location affected suites.
- [ ] Commit the adapter.

### Task 10: Add C11 diagnostics and ownership/maintainability gates

**Files:**
- Create: `lib/new-core/diagnostic-boundary.js`
- Create: `docs/new-core-contract-ownership.json`
- Create: `tests/new-core-maintainability-gates-runner.js`
- Create: `tests/new-core-observability-runner.js`

**Interfaces:**
- Consumes: bounded layer results.
- Produces: C11 and static one-writer/failure-owner verification.

- [ ] Write RED AC-OBS-001..012 and AC-MNT-001..010.
- [ ] Run targeted RED.
- [ ] Implement closed diagnostic projection and ownership manifest verification.
- [ ] Inject forbidden duplicate writer/god-function/unsafe field mutations in test copies and assert the gates fail.
- [ ] Run integrity and safe trace regressions.
- [ ] Commit observability/maintainability gates.

### Task 11: Build one-call OpenAI adapter on the new wire contract

**Files:**
- Create: `lib/providers/openai-understanding-v1.js`
- Create: `tests/new-core-openai-adapter-contract-runner.js`

**Interfaces:**
- Consumes: C01.
- Produces: one raw C02 response; local provider retry remains transport-category-only and never performs semantic repair.

- [ ] Write provider-shaped schema RED proving C01-C05 required fields and one-call ceiling.
- [ ] Run targeted RED with a fake transport; classify as `FAKE_INTEGRATION`.
- [ ] Implement Structured Outputs request/schema and bounded provider diagnostics; no prompt examples copied from protected acceptance text.
- [ ] Assert valid-but-contract-invalid output is not retried and no second classifier exists.
- [ ] Run current provider failure/timeout/strict-schema suites.
- [ ] Commit provider adapter.

### Task 12: Assemble read-only shadow core

**Files:**
- Create: `lib/new-core/shadow-core.js`
- Create: `lib/new-core/shadow-comparator.js`
- Create: `tests/new-core-shadow-isolation-runner.js`

**Interfaces:**
- Consumes: read-only C01 and old-core safe outcome summary.
- Produces: C10 only.

- [ ] Write RED AC-SHD-001..010 with spies for state/message/review/Resolver/DB/LINE.
- [ ] Run targeted RED.
- [ ] Assemble Tasks 2-11 under dependency injection that has no writer interfaces.
- [ ] Implement safe unit/route/lifecycle/C08/canonical diff projection.
- [ ] Run shadow isolation, property isolation, and integrity gates; every side-effect counter must be zero.
- [ ] Commit shadow assembly.

### Task 13: Run deterministic acceptance and rewrite implementation-bound tests

**Files:**
- Modify: only tests classified `REWRITE_FOR_NEW_CORE` after replacement assertions exist.
- Preserve: existing product-behavior assertions and protected metadata.

**Interfaces:**
- Consumes: new core modules and acceptance manifest.
- Produces: deterministic acceptance report with honest evidence levels.

- [ ] Execute all AC-CON through AC-REG deterministic cases and record exit codes.
- [ ] Map each legacy implementation-bound assertion to a replacement unit/contract assertion before removing the old coupling assertion.
- [ ] Keep fake/fixture tests classified `TEST_ONLY_EVIDENCE`; do not alter product expected outcomes.
- [ ] Run full affected Planner/semantic/Context/lifecycle/pending/multi-cycle/no-reply/canonical/partial suite.
- [ ] Stop and restore the phase on any prior-PASS regression.
- [ ] Commit test rewrites only after replacement coverage is machine-proven.

### Task 14: Run reviewed REAL_OPENAI shadow acceptance

**Files:**
- Create: `scripts/run-new-core-openai-shadow-acceptance.js`
- Create: generated private artifact outside git; no raw prompts/responses in repository.

**Interfaces:**
- Consumes: user-reviewed case set and exact candidate SHA.
- Produces: sanitized per-shape counts, C11 markers, C10 diffs, zero side effects.

- [ ] Present the complete exact question/expected-behavior list for user review before any provider call, per `LESSONS_LEARNED.md` 2026-08-12.
- [ ] After explicit approval, run AC-PRD-001..005 and variance-sensitive controls at least five times each.
- [ ] Verify every target trace contains the expected new-core boundary marker; classify a bypass as sampling drift.
- [ ] Increase samples and report shape distribution if any unit/route/lifecycle varies.
- [ ] Block cutover for over-silence, missing lodging units, excess handoff, property leak, or any shadow side effect.
- [ ] Commit only the reviewed runner and safe metadata, never provider artifacts containing guest text.

### Task 15: Atomic composition-root cutover candidate

**Files:**
- Modify: `lib/v2-composition-root.js`
- Modify: `lib/conversation-engine-v2/engine.js` only at the pre-canonical injection boundary if unavoidable.
- Test: `tests/new-core-cutover-contract-runner.js`

**Interfaces:**
- Consumes: new core C09/C08.
- Produces: unchanged current canonical/downstream input; exactly one active core.

- [ ] Write RED proving old semantic/context/no-reply functions are unreachable in cutover mode and downstream interfaces are unchanged.
- [ ] Run targeted RED.
- [ ] Replace the single pre-canonical factory call; do not retain per-message fallback or dual decision writers.
- [ ] Run all affected regression and full integrity suites.
- [ ] Verify no DB migration/state schema/Resolver/FinalDecision/FinalResponse/LINE diff exists.
- [ ] Commit the cutover candidate on test branch only.

### Task 16: Test-branch deployment, shadow observation, and cutover gate

**Files:**
- No application changes; evidence/report artifacts only where policy permits.

**Interfaces:**
- Consumes: exact committed test candidate.
- Produces: exact-SHA test deployment evidence and explicit go/no-go recommendation.

- [ ] Push only `test-only/node-pilot-integration`; verify branch/SHA and CI.
- [ ] Deploy only the authorized test service after separate deployment approval.
- [ ] Verify health identity, exact SHA, property isolation, and zero-side-effect shadow counters.
- [ ] Run approved REAL_OPENAI, REAL_POSTGRESQL_PROVIDER, and test-only LINE suites with honest classifications.
- [ ] Compare the complete protected baseline and block on any regression or missing 113 artifact coverage.
- [ ] Record the exact pre-cutover rollback SHA.

### Task 17: Production integration and rollback drill

**Files:**
- No new behavior; branch integration/deployment evidence only.

**Interfaces:**
- Consumes: fully approved exact test candidate.
- Produces: production branch candidate with identical tree and a verified rollback point.

- [ ] Obtain explicit production integration/deployment authorization.
- [ ] Integrate without force-push or history rewrite; verify candidate tree matches approved test candidate.
- [ ] Run production preflight and health identity checks.
- [ ] Deploy once; verify exact LIVE_SHA and the approved production acceptance set.
- [ ] On any failure, deploy the exact recorded pre-cutover SHA; no runtime fallback or DB rollback is needed.
- [ ] Delete any temporary branch/worktree after the task, preserving only `production` and `test-only/node-pilot-integration`.

## Test classification map

- **KEEP_BEHAVIOR:** current availability, price, facts, location, Temporal, state-v3, partial response, property isolation, Claim/Final/LINE behavior.
- **REWRITE_FOR_NEW_CORE:** tests asserting `task/candidateIndex/semanticGroundings/contextRelationCandidates/shouldIgnore/automaticPendingRelation` internals. Rewrite only after equivalent product safety assertions exist.
- **TEST_ONLY_EVIDENCE:** fake Planner, recorded replay, fixture migration, isolated PGlite, schema-only tests, and 36-case stored subset of the 113 review.
- **DROP_STALE:** none is authorized by this plan. A separate evidence task must prove no product/safety coverage and an existing replacement before removal.

## Completion condition

Implementation is not complete until all 306 enumerated acceptance IDs (including AC-113-001 and its repository-preserved 113 cases/135 turns) are accounted for, all maintainability and shadow gates pass, REAL_OPENAI repeats exercise the intended new boundaries, the complete protected baseline has zero regressions, and atomic rollback has been verified. Ambiguous state-v3 compatibility or any required downstream modification blocks cutover rather than expanding scope.
