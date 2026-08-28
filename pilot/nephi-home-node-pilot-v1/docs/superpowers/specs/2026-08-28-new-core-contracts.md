# JunZan AI 新核心正式 Contracts

**Status:** `DESIGN_FROZEN`; wire/runtime not implemented.

**Normative design:** [2026-08-28-new-controlled-reply-core-design.md](2026-08-28-new-controlled-reply-core-design.md)

All objects reject unknown fields. IDs are non-empty, bounded opaque strings unique in their envelope. Enums are closed. Writers never mutate their input. Validators return a typed success or an owned failure code; they do not repair semantic values.

## Shared primitives

```ts
type EvidenceRef = {
  eventId: string;
  messageRef: string;
  startOffset: number; // UTF-16 inclusive
  endOffset: number;   // UTF-16 exclusive
  quote: string;
};
type UnitPurpose = "lodging_question" | "operator_request" | "sensitive_request" |
  "acknowledgement" | "correction" | "supplement" | "cancellation" |
  "context_update" | "social" | "off_topic" | "unknown";
type CapabilityCandidate = "availability" | "available_dates" | "price" | "total_price" |
  "capacity" | "property_fact" | "amenity" | "policy" | "location" |
  "booking_operator_request" | "high_risk" | "unsupported" | null;
type SubjectKind = "property" | "room" | "bundle" | "matched_room_set" |
  "amenity" | "policy" | "external_place" | "other_verified" | null;
type LifecycleAction = "START" | "CONTINUE" | "MODIFY" | "END" | "NONE";
type ReplyDisposition = "ANSWER" | "CLARIFY" | "HANDOFF" | "NO_REPLY";
```

## C01 UnderstandingTurnInput

- **Responsibility:** immutable, bounded input visible to the sole NL-understanding call.
- **Required fields:** `schemaVersion`, `coreVersion`, `traceId`, `turnId`, verified `propertyScope`, `sourceEvents[]` (`eventId`, `messageRef`, `role`, `timestamp`, `messageKind`, `messageText|null`), bounded `recentConversation[]`, `referenceableCycles[]`, property timezone, capability catalog, public subject catalog.
- **Forbidden:** prices, availability answers, private notes, credentials, unbounded history, expected test answers, case IDs, state mutation handles.
- **Writer:** Turn Input Adapter.
- **Validator:** `validateUnderstandingTurnInput`.
- **Consumer:** OpenAI Understanding only; shadow receives a read-only copy.
- **Failure:** `TURN_INPUT_INVALID`, `PROPERTY_SCOPE_INVALID`, `SOURCE_EVENT_DUPLICATE`, `CONTEXT_WINDOW_INVALID`.
- **Coverage:** AC-CON-001..004, AC-ISO-001..004, AC-SHD-001..004.

## C02 UnderstandingOutputV1

- **Responsibility:** one provider response containing 0..N independent semantic units.
- **Required fields:** `schemaVersion=1`, `turnId`, `units[]`; provider metadata stays outside semantic payload.
- **Forbidden:** formal facts, canonical dates, resolver IDs, QueryPlans, final text, state mutations, candidateIndex, `shouldIgnore`, message-level reply disposition.
- **Writer:** one OpenAI structured response.
- **Validator:** Wire Schema Validator.
- **Consumer:** Source Evidence Validator.
- **Failure:** `UNDERSTANDING_SCHEMA_INVALID`, `UNIT_ID_DUPLICATE`, `UNKNOWN_WIRE_FIELD`, `UNDERSTANDING_CARDINALITY_INVALID`.
- **Coverage:** AC-WIR-001..008, AC-MNT-001..005.

## C03 SemanticUnitCandidate

- **Responsibility:** represent exactly one independent source meaning.
- **Required fields:** `unitId`, `evidenceRefs`, `purpose`, `capability`, `subject:{kind,catalogIdentity}`, `stayDependent:boolean`, `temporalCandidate|null`, `contextLinkCandidateId`, `replyCandidate:{disposition,reasonClass}`, `slotCandidates[]`, `confidenceBand`.
- **Forbidden:** executable dates/facts, resolver selection, candidateIndex, task ownership, inferred catalog aliases, lifecycle mutation, final reply.
- **Writer:** OpenAI Understanding.
- **Validator:** Semantic Unit Validator, using only structured tuple, validated evidence, catalog IDs, and registry compatibility.
- **Consumer:** Context Link Validator and Per-unit Reply Router.
- **Failure:** `SEMANTIC_UNIT_INVALID`, `CAPABILITY_SUBJECT_CONFLICT`, `STAY_DEPENDENCY_CONFLICT`, `CATALOG_IDENTITY_INVALID`, `UNIT_EVIDENCE_MISSING`, `UNIT_MEANING_UNSUPPORTED`.
- **Coverage:** AC-SEM-001..015, AC-AVL-001..010, AC-FCT-001..014, AC-LOC-001..006.

## C04 SourceEvidence

- **Responsibility:** prove a unit meaning is anchored in supplied guest source.
- **Required fields:** one or more `EvidenceRef`; each resolves to one C01 source item and `quote === messageText.slice(startOffset,endOffset)`.
- **Forbidden:** semantic repair, span guessing from aliases, capability/route/lifecycle change, cross-event fallback.
- **Writer:** OpenAI supplies coordinates; Source Evidence Validator emits immutable validity records.
- **Validator:** the sole `validateAndNormalizeSourceEvidence` authority; normalization may replace coordinates only after one unique exact quote match within the same source item.
- **Consumer:** Semantic Unit Validator, Context Link Validator, diagnostics.
- **Failure:** `EVIDENCE_SOURCE_UNKNOWN`, `EVIDENCE_RANGE_INVALID`, `EVIDENCE_QUOTE_MISMATCH`, `EVIDENCE_MATCH_AMBIGUOUS`, `EVIDENCE_SCOPE_CONFLICT`.
- **Coverage:** AC-EVD-001..010, AC-MUT-001..004.

## C05 ContextLinkCandidate

- **Responsibility:** OpenAI's language-derived proposal for a unit's relationship to conversation history.
- **Required fields:** `contextLinkCandidateId`, `unitId`, `actionCandidate`, `targetRequestCycleId|null`, `evidenceRefs`.
- **Forbidden:** selecting a likely pending target, state writes, capability rewrite, reply decision.
- **Writer:** OpenAI Understanding.
- **Validator:** Context Link Validator against C01 referenceable snapshot and C04 evidence.
- **Consumer:** Lifecycle Manager.
- **Failure:** `CONTEXT_LINK_DUPLICATE`, `CONTEXT_TARGET_UNKNOWN`, `CONTEXT_TARGET_ENDED`, `CONTEXT_TARGET_EXPIRED`, `CONTEXT_TARGET_SCOPE_CONFLICT`, `CONTEXT_TARGET_AMBIGUOUS`, `CONTEXT_LINK_EVIDENCE_INVALID`.
- **Coverage:** AC-CTX-001..018, AC-PND-001..008.

## C06 LifecycleDecision

- **Responsibility:** validated state transition independent of reply and executability.
- **Required fields:** `lifecycleDecisionId`, `unitId`, `action`, `targetRequestCycleId|null`, `verifiedSlotOperations[]`, `status`.
- **Forbidden:** guest-intent inference, capability/reply rewrite, Resolver query, final action.
- **Writer:** Lifecycle Manager (sole lifecycle authority).
- **Validator:** lifecycle invariant validator plus existing state-v3 adapter preconditions.
- **Consumer:** state-v3 transition adapter and Unit Aggregator.
- **Failure:** `LIFECYCLE_TARGET_REQUIRED`, `LIFECYCLE_START_TARGET_FORBIDDEN`, `LIFECYCLE_SLOT_UNVERIFIED`, `LIFECYCLE_TRANSITION_INVALID`, `LIFECYCLE_PROPERTY_CONFLICT`.
- **Coverage:** AC-LIF-001..018, AC-CTX-001..018.

## C07 UnitRoutingDecision

- **Responsibility:** final routing for one unit, independent of lifecycle and facts result.
- **Required fields:** `unitId`, `disposition`, `reasonClass`, `requiresCanonicalExecution`, `missingGuestFields[]`, `operatorActionClass|null`, `riskClass|null`.
- **Forbidden:** raw-text routing, unknown shortcuts, facts, final copy, lifecycle mutation.
- **Writer:** Per-unit Reply Router (sole pre-execution reply authority).
- **Validator:** route invariant validator.
- **Consumer:** Unit Aggregator and C08 adapter.
- **Failure:** `ANSWER_NOT_EXECUTABLE`, `CLARIFY_WITHOUT_GUEST_FIELD`, `HANDOFF_WITHOUT_OPERATOR_OR_RISK`, `NO_REPLY_EXECUTABLE_CONFLICT`, `ROUTE_PURPOSE_CONFLICT`.
- **Coverage:** AC-RTE-001..020, AC-NRP-001..012, AC-HOF-001..010.

## C08 CanonicalizerInputItem

- **Responsibility:** compatibility input for exactly one executable ANSWER unit.
- **Required fields:** `unitId`, capability candidate, subject candidate, stay dependency, temporal candidate reference, verified slot inputs, evidence binding, property scope; adapter-local `candidateIndex` only if current signature requires it.
- **Forbidden:** lifecycle-only/no-reply units, facts, route inference, raw-text semantic repair, cross-unit slot merging.
- **Writer:** Canonical Execution Adapter.
- **Validator:** adapter contract validator, then existing `canonicalizeExecutionItem()`.
- **Consumer:** existing canonicalizer only.
- **Failure:** `CANONICAL_INPUT_NOT_ANSWER`, `CANONICAL_INPUT_INCOMPLETE`, `CANONICAL_ADAPTER_OWNERSHIP_CONFLICT`, existing canonical rejection codes.
- **Coverage:** AC-CAN-001..012, AC-AVL-001..010, AC-PRI-001..008.

## C09 UnitAggregationResult

- **Responsibility:** lossless turn-level collection of per-unit lifecycle, route, canonical status, and downstream outcome references.
- **Required fields:** `turnId`, ordered `unitOutcomes[]`, `canonicalItems[]`, `hasReplyWork`, `hasClarification`, `hasHandoff`, `allNoReply`, `failedUnits[]`.
- **Forbidden:** changing any unit route, dropping valid siblings, composing text, querying facts.
- **Writer:** Unit Aggregator.
- **Validator:** coverage/ownership validator: every validated unit exactly once; every C08 owned by one ANSWER unit.
- **Consumer:** existing execution orchestration and FinalDecision input adapter.
- **Failure:** `UNIT_OUTCOME_ORPHAN`, `UNIT_OUTCOME_DUPLICATE`, `UNIT_COVERAGE_INCOMPLETE`, `CANONICAL_ITEM_ORPHAN`, `AGGREGATION_ROUTE_CONFLICT`.
- **Coverage:** AC-MUL-001..014, AC-PAR-001..010.

## C10 ShadowComparisonRecord

- **Responsibility:** non-authoritative comparison between old and new pre-canonical outputs.
- **Required fields:** version/SHA, trace hash, unit summaries, route/lifecycle summaries, C08 summaries, canonical diff, validation/failure codes, side-effect counters all zero.
- **Forbidden:** raw guest text, facts, state/review/message writes, Resolver calls, LINE calls, product decisions.
- **Writer:** shadow comparator only.
- **Validator:** shadow isolation and privacy validators.
- **Consumer:** offline acceptance/reporting only.
- **Failure:** `SHADOW_SIDE_EFFECT_ATTEMPT`, `SHADOW_RECORD_UNSAFE`, `SHADOW_COMPARISON_INCOMPLETE`.
- **Coverage:** AC-SHD-001..010, AC-OBS-001..008.

## C11 DiagnosticBoundaryEvent

- **Responsibility:** sanitized earliest-failure observability for one layer.
- **Required fields:** `coreVersion`, `traceId`, `boundary`, `inputUnitIds`, `outputUnitIds`, `status`, `failureCode|null`, bounded context/lifecycle/route/canonical result enums, timestamp.
- **Forbidden:** raw prompts/responses, guest text, evidence quote, facts, credentials, headers, stack, arbitrary exception message.
- **Writer:** exactly one emitter at each named boundary; failure code has one owner.
- **Validator:** safe trace formatter/allowlist.
- **Consumer:** existing safe diagnostic persistence and acceptance attribution.
- **Failure:** `DIAGNOSTIC_FIELD_FORBIDDEN`, `DIAGNOSTIC_CODE_UNOWNED`, `DIAGNOSTIC_BOUNDARY_UNKNOWN` (diagnostic failure cannot change behavior).
- **Coverage:** AC-OBS-001..012, AC-INT-001..006.

## Cross-contract ownership invariants

1. `unitId` is the only semantic ownership key from C03 through C09.
2. Every C03 owns exactly one C05 and produces exactly one C06 and C07 outcome; a no-context unit uses `NONE`.
3. Only C07 ANSWER may own one C08. CLARIFY/HANDOFF/NO_REPLY own none.
4. C06 may exist without C08. This is required for lifecycle-only END/MODIFY/NONE.
5. C04 evidence belongs to units/links, never tasks or adapter indexes.
6. Capability, subject, stay dependency, reply disposition, and lifecycle action are never inferred from one another.
7. Candidate index is generated and destroyed inside C08 compatibility code.
8. The existing canonicalizer may reject C08 but may not feed a new semantic value back into C03/C07.

## Route truth table

| Disposition | Executable item | Guest data missing | Operator/risk basis | Lifecycle allowed |
|---|---:|---:|---:|---|
| ANSWER | exactly 1 | no | optional | START/CONTINUE/MODIFY |
| CLARIFY | 0 | at least 1 | no | START/CONTINUE/MODIFY |
| HANDOFF | 0 | optional | required | START/CONTINUE/MODIFY |
| NO_REPLY | 0 | no independent executable need | no | START/CONTINUE/MODIFY/END/NONE |

END never owns an executable item. A reservation cancellation request is a separate HANDOFF operator unit plus any dialogue-cycle END unit; ending a conversation cycle is not proof that a booking was cancelled.
