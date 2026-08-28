# JunZan AI 新版精簡受控自動回覆核心設計

**Status:** `DESIGN_FROZEN`（只封版設計；尚未實作、shadow、切換或部署）

**Evidence baseline:** repository `gqlikjguo-web/nephi-home`, production `e4ef9b2d357b0335e683de04362aa114168390c7`, test branch snapshot `377ac1317f6930f37e296a590004f73d51359b80`

**Companion documents:** [Contracts](2026-08-28-new-core-contracts.md), [Evidence crosswalk](2026-08-28-new-core-evidence-crosswalk.md), [Acceptance matrix](2026-08-28-new-core-acceptance-matrix.md), [Implementation plan](../plans/2026-08-28-new-controlled-reply-core.md)

## 1. Scope and invariant

This design replaces only the path from a normalized guest turn through the items accepted by the existing `canonicalizeExecutionItem()` boundary. It does not rename, wrap, or migrate the old Planner/semantic/Context core. The existing LINE identity boundary, property isolation, PostgreSQL facts, state-v3 persistence shape, CanonicalRequest, Temporal authority, FormalRequest/QueryPlan, Resolver, ResponsePlan, Claim Validator, FinalDecision, FinalResponse, and LINE transport remain authoritative.

`RULE-00`: OpenAI is the sole natural-language understanding authority. It understands language once. JunZan validates the resulting contract once, applies a legal Context transition once, routes each unit once, resolves formal data once, decides once, and replies once. Deterministic code may reject contradictions, missing evidence, invalid property scope, invalid Context targets, unsupported capabilities, and unsafe output. It must not infer, repair, translate, or rewrite guest intent.

## 2. Chosen architecture

Three approaches were evaluated from repository evidence:

1. Continue repairing `applyPlannerSemanticContract()` and its coupled ownership. Rejected: it preserves multiple semantic writers and repeats the failure pattern recorded by D-043, D-048, D-050, and D-052.
2. Add another relationship/reply layer beside the old core. Rejected: this creates a second production semantic path and makes rollback and attribution ambiguous.
3. Replace the pre-canonical understanding/dialogue core atomically behind one adapter. **Selected:** it keeps the proven downstream authorities and establishes one writer per new contract.

The new path is:

```text
Guest Turn
  -> Turn Input Adapter
  -> OpenAI Understanding (one provider call)
  -> Wire Schema Validation
  -> Source Evidence Validation
  -> Semantic Unit Validation
  -> Context Link Validation
  -> Lifecycle Manager
  -> Per-unit Reply Router
  -> Unit Aggregator
  -> Canonical Execution Adapter
  -> existing canonicalizeExecutionItem()
  -> existing Temporal / State-v3 / FormalRequest / QueryPlan / Resolver
  -> existing ResponsePlan / Claim Validator / FinalDecision / FinalResponse / LINE
```

No stage may call an earlier stage's authority again. A stage emits an immutable result and a sanitized `C11 DiagnosticBoundaryEvent`.

## 3. Layer responsibilities

| Layer | Sole responsibility | Forbidden responsibility | Output |
|---|---|---|---|
| Turn Input Adapter | Build one bounded, property-scoped turn input from verified event and recent conversation | Intent inference, facts, state mutation | C01 |
| OpenAI Understanding | Split 0..N independent meanings and propose language-derived candidates | Facts, canonical dates, final routing, state mutation | C02/C03/C04/C05 candidates |
| Wire Schema Validator | Reject unknown fields, invalid types/cardinality/IDs | Repair or default semantic meaning | validated C02 |
| Source Evidence Validator | Verify each span against supplied source events with one coordinate authority | Change capability, subject, route, lifecycle | validated C04 |
| Semantic Unit Validator | Check tuple consistency, property catalog identity, capability/subject/stay independence | Reclassify from raw text/catalog aliases | validated C03 |
| Context Link Validator | Validate proposed link against same-scope referenceable state snapshot | Select a “likely” pending cycle | validated C05 |
| Lifecycle Manager | Apply START/CONTINUE/MODIFY/END/NONE and verified slot changes | Guess intent, change capability or reply route | C06 + compatible state-v3 transition |
| Per-unit Reply Router | Validate final ANSWER/CLARIFY/HANDOFF/NO_REPLY conditions per unit | Query facts, use `unknown` as a shortcut | C07 |
| Unit Aggregator | Preserve every unit outcome and compute turn delivery requirements | Let one failed/handoff unit erase siblings | C09 |
| Canonical Execution Adapter | Map only ANSWER units requiring facts into compatibility items | Expose candidateIndex outside adapter; create facts | C08 |

## 4. Semantic unit model

A guest turn contains 0..N `SemanticUnitCandidate` records keyed by stable `unitId`. A unit may be a lodging question, operator request, sensitive/high-risk request, acknowledgement, correction, supplement, cancellation/end, context-only update, social/non-actionable content, or unknown intent. Executability is optional.

Capability, subject, and stay dependency are independent fields. `availability + bundle + stayDependent=true` is valid and cannot be rewritten to `property_fact` because of its subject. `location + external_place + stayDependent=false` is independently valid. A context-only update can carry verified guest count or transport information without producing a CanonicalRequest.

A non-null temporal candidate is a closed `{rawText,kind,checkInCandidate,checkOutCandidate,nightsCandidate}` record; it records OpenAI's source-bound temporal meaning only and cannot establish an implicit year or executable date. For example, a source `10/9住一晚` retains `10/9` as a partial candidate rather than acquiring a year. A slot candidate is a closed `{slotCandidateId,slot,operation,value,evidenceRefs}` record with a turn-wide stable ID. Slot candidates may express `guest_count`, `product`, `transport`, or the syntactically closed `other_supported` label, but they cannot write state, select a Context target, alter capability, or decide reply; formal catalog/registry admission occurs only in the later Semantic validator. Closed wire validation rejects malformed fields, enums, cardinality, duplicate slot IDs, and explicit structured temporal contradictions without repair; source-meaning overlap remains later Evidence/Semantic authority.

Only the OpenAI output may state semantic meaning. Deterministic validation checks whether the tuple is supported by schema, evidence, property catalog, and the capability registry. A conflict fails that unit closed; it never synthesizes a replacement meaning from task type, catalog keywords, aliases, case IDs, or raw text.

## 5. Reply necessity and lifecycle

Every unit has an explicit reply candidate and an independent context link candidate. Final `UnitRoutingDecision` is one of:

- `ANSWER`: an executable lodging need is complete enough to enter formal resolution.
- `CLARIFY`: the guest must supply required input; deterministic readiness names the missing formal fields.
- `HANDOFF`: a verified lodging need requires operator decision/action or a defined safety policy mandates human handling.
- `NO_REPLY`: the unit needs no customer-service response; it may still apply a verified lifecycle or slot update.

`UNKNOWN` is a semantic purpose, not a route. Unknown meaning with insufficient evidence fails understanding closed and does not silently become either handoff or no-reply. Unknown official fact after an executable query follows the existing capability-specific downstream Unknown policy.

Lifecycle is independently `START | CONTINUE | MODIFY | END | NONE`. START has no target. CONTINUE/MODIFY/END require exactly one same-property, same-conversation, active/referenceable target. NONE has no target. Lifecycle-only END/MODIFY/NONE may have no executable item. An invalid target fails that lifecycle decision; code does not invent a relation. Because C01 contains only the bounded referenceable projection, an absent, ended, expired, or otherwise unavailable target uses the single honest `CONTEXT_TARGET_UNAVAILABLE` result unless the snapshot itself proves scope conflict or ambiguity. A protected active lodging continuation remains actionable because its unit is explicitly classified as lodging/operator work, not because a pending heuristic promotes it.

Examples:

- “好的，還有房嗎” -> acknowledgement `NO_REPLY/NONE`; availability `ANSWER or CLARIFY/START`.
- “不是這個，我要問停車” -> correction `NO_REPLY/MODIFY or NONE`; parking `ANSWER/START`.
- “謝謝，取消剛才那個” -> social acknowledgement `NO_REPLY/NONE`; cancellation `NO_REPLY/END` when it cancels only the dialogue cycle, or `HANDOFF` when it requests cancellation of an actual reservation.
- “有開車…我們只有四位” -> context-only verified slot updates `NO_REPLY/MODIFY`; no fake unknown task.

## 6. Temporal, facts, and canonical boundary

OpenAI emits a temporal meaning candidate and its source evidence, never executable dates. The existing canonical Temporal authority parses relative, absolute, range, weekday, cross-month, cross-year, nights, check-in/check-out, and approved context reuse using event time and property timezone. A narrower candidate cannot erase a broader source constraint; ambiguity remains unresolved.

Only `C08 CanonicalizerInputItem` crosses into the existing canonicalizer. It carries a stable `unitId` plus compatibility data required by the current API. Any generated `candidateIndex` exists only inside this adapter call and is never persisted as semantic, reply, evidence, or lifecycle authority.

Resolver/PostgreSQL remains the sole facts authority. No new model output, context record, shadow result, fixture, cache, custom reply, or diagnostic can answer price, availability, policy, equipment, address, or location facts.

## 7. Failure isolation and fail-closed policy

Failures are unit-scoped unless the wire envelope or property identity is invalid. A malformed sibling does not erase a valid sibling. The aggregator records failed units and keeps independently valid ANSWER/CLARIFY/HANDOFF outcomes.

Mandatory fail-closed conditions include duplicate/unknown IDs, overlapping ownership, source-span mismatch, evidence from an unprovided event, property/catalog conflict, unsupported capability tuple, invalid Context target, lifecycle/task conflict, route/executability conflict, cross-property state, canonical adapter mismatch, and any unauthorized writer. Each has one stable failure code owned by one layer.

Envelope/property identity failures abort the turn without querying Resolver. A unit validation failure becomes an explicit non-executable diagnostic outcome; it does not automatically handoff. Whether customer-visible handling is needed must already be justified by another valid unit or an approved top-level safety policy.

## 8. Recent conversation and state-v3 compatibility

The input includes a bounded recent conversation projection with event/message references, sanitized role, timestamp, and previously verified cycle/slot references. It exists only to let OpenAI understand ellipsis, correction, supplement, and reference. It is not a facts source.

The persisted conversation-state-v3 schema does not migrate. C06 uses the closed status `VALIDATED`, which claims only lifecycle/link/slot validation. The Lifecycle Manager adapts validated C06 decisions to one closed, privately validated `lifecycleOperations[]` input on the existing sole reducer. END maps to the existing cancelled status; validated guest count maps to `guestCount`; catalog-validated room/bundle product maps to the existing lodging-product fields. Transport and any `other_supported` value without an existing formal V3/registry mapping remain validated turn context and are not persisted. START, NONE, and unsupported persistence mappings create no reducer operation, and context-only updates may have zero C08/Resolver work. New `unitId` values are trace/request correlation identifiers and need not become DB columns. If implementation proves another required lifecycle cannot be represented without a schema change, cutover stops; the plan does not authorize migration.

## 9. Observability

Every boundary emits C11 with core version, trace ID, unit IDs in/out, validation status, sole-owner failure code, context link, lifecycle result, route, and canonical adapter result. It excludes raw prompts, provider bodies, guest text, credentials, property facts, and arbitrary error messages. Source evidence is represented by bounded IDs and validity outcomes, not quotes, in persisted production traces.

The trace must show that the targeted new rule executed. A target that passes because OpenAI sampled a different shape is sampling drift, not repair proof. Real OpenAI variance-sensitive cases run at least five times; any disagreement increases the run count and is reported by shape and layer.

## 10. Shadow, cutover, and rollback

Shadow reads the same normalized turn, bounded context snapshot, and catalog metadata after verified LINE/property binding and before the existing Planner. It runs the new understanding and validators with all writers disabled. It must not mutate state, call Resolver, create reviews/messages, or send LINE. It compares semantic units, routing, lifecycle, C08 items, and canonical diffs against recorded old-core outcomes. A shadow error cannot affect production.

Cutover replaces the composition-root factory that currently supplies Planner output through pre-canonical Engine processing. The new core must connect to the unchanged `canonicalizeExecutionItem()` input adapter and existing downstream. There is one active core, selected by deployment version—not a per-message fallback or dual writer.

Rollback deploys the exact last verified production SHA `e4ef9b2d357b0335e683de04362aa114168390c7` (or the later explicitly recorded pre-cutover SHA) on branch `production`. Because DB/state/LINE/Resolver/final-layer contracts are unchanged, rollback requires no data rollback. Shadow records remain non-authoritative diagnostics.

## 11. KEEP / REBUILD / FORBIDDEN LEGACY

### KEEP unchanged

Verified LINE binding/property identity, webhook event claim, property/channel/user isolation, PostgreSQL authorities, inventory/price/property facts, canonical Temporal, `CanonicalRequest`, FormalRequest/QueryPlan, Resolver, ResponsePlan/Claim Validator, FinalDecision, FinalResponse, transport no-reply guard, state-v3 persistence, message/review persistence, and sanitized deployment diagnostics.

### REBUILD

OpenAI wire contract and adapter; semantic decomposition; source evidence validation; semantic ownership; context-link proposal/validation; lifecycle decision adapter; per-unit reply necessity; pre-canonical aggregation; compatibility adapter; layer diagnostics.

### DROP after atomic cutover (not before)

The old production consumers of `applyPlannerSemanticContract()`, `compileSemanticCandidates()` synthesis/repair, task-owned `semanticGroundings`, task-owned `contextRelationCandidates`, message-level `shouldIgnore` routing, `automaticPendingRelation()`, and provider semantic repair/retry are removed from the active composition root only after replacement coverage and cutover pass. They are not currently dead code, so this design does not label them safe to delete before cutover. Legacy V2/V3 compatibility code outside this pre-canonical scope is `UNKNOWN` until a consumer audit proves it unreachable.

### Test disposition

- `TEST_KEEP`: tests asserting protected product behavior, facts authority, property isolation, Temporal, canonicalization, state-v3 outcomes, partial response, safety, Claim/Final/LINE behavior.
- `TEST_REWRITE`: assertions coupled to task/candidateIndex/semanticGroundings/contextRelationCandidates/shouldIgnore/automaticPendingRelation internals; product oracle is retained while the implementation assertion is replaced.
- `TEST_ONLY_EVIDENCE`: fake Planner/provider, fixtures, recorded replay, isolated PGlite, schema-only tests, and the persisted 36-case/45-turn subset attributed to the 113 review.
- `TEST_DROP_STALE`: none is authorized by this design. A separate audit must prove no consumer and replacement safety coverage.

### FORBIDDEN_LEGACY

`applyPlannerSemanticContract()`-style semantic repair; `automaticPendingRelation`; task/candidateIndex ownership outside compatibility; message-level `shouldIgnore`; task type -> reply inference; unknown -> handoff/no-reply inference; provider repair/retry for valid-but-unwanted semantics; raw-message alias/keyword/regex routing; property patches; relationshipCandidates, message-level replyDisposition/lifecycleRelations, and prompt-only rollback experiments; fake fixture helpers defining production contracts; duplicate evidence normalization; second state/facts/reply authority.

## 12. Maintainability gates

`MAINTAINABILITY_GATES` pass only when:

1. Each layer has one responsibility, one writer, one validator, named consumers, and owned failure codes.
2. There is exactly one semantic normalization and one evidence normalization authority.
3. Capability, reply, lifecycle, Context, facts, memory, and final action each have exactly one authority.
4. No function both interprets meaning and performs routing/state/canonicalization.
5. Every layer is independently unit-testable with immutable input/output.
6. No production function branches on guest keywords, exact sentences, case IDs, or property identity.
7. No compatibility index escapes C08.
8. Static ownership and mutation gates fail on duplicate writers or shadow side effects.
9. Every C01-C11 contract and failure code has acceptance coverage.
10. No acceptance fixture/mock is classified as real-provider proof.

## 13. Design completion gate

This design is complete only together with the evidence crosswalk, C01-C11 contracts, acceptance matrix, and phased implementation plan. Any row marked `UNKNOWN_EVIDENCE` remains an explicit historical unknown and is covered by a conservative prevention invariant; it is not presented as a proven root cause. Runtime implementation remains prohibited until these documents are reviewed and explicitly approved as a separate task.
