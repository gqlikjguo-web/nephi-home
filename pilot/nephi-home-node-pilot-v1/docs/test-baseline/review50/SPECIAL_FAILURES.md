# Review50: direct evidence for changed and failing tests

Baseline: `1d2829417bd99174f3a4c1614992be32cbac244a`. Paths below are relative to the pilot application. Runtime and formal Contracts are unchanged. Evidence level: STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION; no REAL provider conclusion.

## openai-adapter-contract — STALE_EXPECTATION, now PASS

Original runner: `tests/new-core-openai-adapter-contract-runner.js`. The first baseline failure is the purported valid fixture rejected by `schemaAccepts` at baseline line 364. Its `unit()` builder omitted `quantityCandidate`.

The existing provider's `objectSchema()` (`lib/providers/openai-understanding-v1.js:156–163`) requires every declared property. `unitBranchSchema()` at lines 320–333 declares nullable `quantityCandidate`. A missing property and an explicitly null property are different schema inputs. The fixture now supplies null; no schema has changed.

Subsequent old assumptions also predated `quantityAlignedUnitBranches()` (same source, lines 335–348): it partitions subjects into disjoint quantity-eligible and ineligible branches. One capability can legitimately have two branches. The test now verifies supported capabilities, one or two branches, and non-overlapping subject kinds. Generic property/operator representation assertions inspect all branches for that capability; the old first-branch lookup could inspect only the quantity-eligible partition. The strict required-key assertion includes `quantityCandidate`. Existing rejection, grounding, error, privacy and call-budget assertions remain.

Proof: `baseline-19.log` exit 1; `adapter-GREEN.log` and `candidate-17.log` exit 0 in the evidence directory. This is fixture/schema alignment, not a runtime repair or a change to quantity admission.

## start-clarify-state — STALE_EXPECTATION, now PASS

Original responsibility: START + CLARIFY creates one pending task; supplying missing dates continues that exact cycle; invalid identity/scope/forged State fails closed. Baseline fixture chose `price` and expected missing stay dates (first failure at baseline line 149).

Existing `EXECUTION_POLICY` in `lib/new-core/capability-subject-policy.js:31–38` requires no guest dates for price, but does require check-in/out for availability. The scenario now uses availability, preserving the pending creation and same-cycle continuation responsibility and exact State equality assertions. The existing bundle availability projection yields `bundle_availability`, so its expected canonical capability follows that Contract.

Two additional old assumptions were corrected only after tracing existing authority:

- C03 now owns duplicate single-position rejection. `validateSemanticUnit()` (`lib/new-core/semantic-unit-validator.js:190`) calls `validateSemanticPositions()`; `lib/new-core/contracts/semantic-position.js:21–30` enforces `singlePositionConflict`. The prior fixture expected duplicate product slots to pass C03 and fail later in State adaptation, an unreachable trusted-input path. The test now asserts C03 failure, exact `UNIT_MEANING_UNSUPPORTED` / `singlePositionConflict` diagnostics, no trusted value and no State creation. It does not accept ambiguous identity.
- `adaptLifecycleDecisionsToStateV3()` in `lib/new-core/state-v3-lifecycle-adapter.js:242–255` allocates durable START bindings even for ANSWER. The prior empty-binding assertion predated that rule. The new assertion checks the exact unit/action/cycle binding and still rejects clarification task creation for START + ANSWER.

Proof: `baseline-20.log` exit 1; `start-GREEN.log` and `candidate-18.log` exit 0. Scope/copy/canonical-binding negatives remain in the runner. No State runtime or policy changed.

## amenity collection — proven current admission CORE_FAIL; old suite retained

Existing `tests/amenity-list-pipeline-control-runner.js` passes through an injected old Planner/V2 engine. It proves collection preservation after the injected old representation; it does not prove current Understanding can express a whole-property collection request. Therefore it is retained as COVERAGE_MISSING, not deleted as a fully replaced test.

New `tests/new-core-amenity-collection-entry-runner.js` exercises `executeNewCoreTurn()` and the real current provider adapter with an injected model payload and two independent in-memory property catalogs. It never fabricates a property catalog identity and makes no network/DB/LINE calls.

Direct producer/consumer conflict:

1. `CAPABILITY_SUBJECT_POLICY.amenity_list` in `lib/new-core/capability-subject-policy.js:57` explicitly supports collection requests for property, room and bundle. `catalogIdentityRuleFor()` at lines 131–141 requires PUBLIC_CATALOG for the property case (the nullable property exceptions cover other capabilities).
2. `buildC01PublicCatalog()` in `lib/new-core/turn-input-adapter.js:155–188` projects catalog rooms, amenities, policies and matched room sets. It publishes no property subject. The observed current turn input has zero property catalog subjects in both fixtures.
3. Provider `subjectBranchSchema()` in `lib/providers/openai-understanding-v1.js:244–263` derives permitted identities from that catalog and drops a PUBLIC_CATALOG branch with zero identities. The observed amenity-list provider schema has no property branch in either fixture. C03 cannot admit an invented identity to bypass this boundary.
4. The new test fails at the invariant that the policy-supported property collection must have a legal current catalog/provider representation. Observed: `propertySubjects=[]`, `catalogSubjects=[]`; two cases, zero passes. Earliest directly evidenced loss is the C01 catalog projection/admission boundary, before facts lookup/render.

The fixture has amenities but no lodging products, isolating a property collection from room selection. The source projection also has no property-subject branch when rooms exist; the test does not claim a REAL model/production transcript failure. It does not prove which Contract-side remedy is appropriate. The later facts/coverage assertions are not reached and are NOT_PROVEN. No runtime remedy was attempted.

This failing protection is wired into `npm test` and `test:review50-current`; it is not skipped or converted into expected failure. Existing 28-runner deterministic acceptance can still pass, so that result must not be described as complete current-core correctness. See `candidate-82.log`, exit 1.

## data-mover — retained baseline failure; current application attribution NOT_PROVEN

`tests/first-version-data-mover-runner.js:283` fails both baseline and candidate. `data-mover-duplicate-evidence.log` records two normalized task results (`bbq-usage`/bbq and `bbq-fee`/policy), both with general detail intent and the same official property-catalog text. The shared response emits that text twice; FinalDecision covers both task IDs.

The invariant against duplicated answers is valid, so the suite remains unchanged. Its old Planner normalization inputs are not proof that current Understanding produces the same task pair. The shared output failure is observed; attribution to a currently reachable production request and the earliest current-core root cause remain NOT_PROVEN. Do not count this as a cleanup-caused regression or erase it by changing expected text.
