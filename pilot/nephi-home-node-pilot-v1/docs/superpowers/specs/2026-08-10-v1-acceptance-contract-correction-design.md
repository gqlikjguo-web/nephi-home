# V1 Acceptance Contract Correction Design

## Scope and authority

This change edits only the repository acceptance fixtures, deployed acceptance runner, reports, and their contract tests. It does not edit Planner, semantic compilation or validation, Canonicalizer, Resolver, PostgreSQL runtime semantics, FinalDecision, or FinalResponse. It does not deploy, synchronize the live database, or invoke OpenAI.

The current contract has two independent defects. First, broad `reply | clarification | handoff` action lists and capability-family checks can mark a multi-subject response PASS when one subject was omitted or when a whole-turn handoff hid answerable property facts. Second, exact internal shapes such as a separate availability/amenity capability or `canonicalId=check_in` can reject a safe customer-visible clarification or scoped handoff.

## Acceptance metadata

Each source fixture declares a `tiers` object whose four arrays partition every case ID exactly once:

- `TIER_1_CORE`: 34 cases / 34 turns;
- `TIER_2_COMPLEX`: 21 cases / 31 turns;
- `TIER_3_SAFETY`: 10 cases / 10 turns;
- `TIER_4_EDGE`: 12 cases / 15 turns.

The loader rejects missing, duplicate, unknown, or multiply assigned IDs. Tier is copied to every loaded case and report turn. `TIER_1_CORE` and `TIER_2_COMPLEX` comprise the V1 product-outcome group, `TIER_3_SAFETY` is scored separately as safety contract, and `TIER_4_EDGE` is reported as non-blocking robustness.

## Product-outcome assertions

A turn may declare `productOutcomes`, an array of `{ subject, disposition, sourceText? }` records. Disposition is one of `answer`, `clarification`, `handoff`, or `retain`.

The runner owns one property-neutral subject registry. Registry entries identify formal subjects by canonical ID, canonical category, or capability. A fixture may additionally give an exact excerpt from its own guest question. Exact excerpts are used only by the acceptance harness to prove that a structured Planner task retained that substantive request; they do not alter production behavior and do not use regex, aliases, or fuzzy matching.

- `answer` requires matching canonical evidence, a same-task `answered` result with formal facts, and Claim Validator coverage.
- `clarification` requires the exact final action plus structured subject evidence.
- `handoff` requires the exact final action plus structured subject evidence; it cannot be satisfied by an unrelated whole-turn handoff.
- `retain` requires structured evidence without constraining the final action.

Existing property isolation, safe-fact allowlists, PostgreSQL provider authority, claim validation, semantic-contract validity, past-date rejection, unauthorized-claim bans, sensitive-access handling, and unsupported-operation handoff remain mandatory.

Tier 1 and Tier 2 turns no longer permit all three final actions. Known-plus-unknown questions use a handoff final action with explicit `answer` requirements for every known subject and explicit `handoff` requirements for unknown/operator subjects.

## Corrected expectations

- `rgs-019` turn 1 removes the ungrounded bundle expectation.
- `rg-029` accepts only scoped clarification/handoff for unknown latest-arrival policy and no longer requires exact `check_in` canonical identity.
- `rg-038` turn 1 requires clarification for the exact Saturday and price request but does not derive a separate availability capability from `date_clarification`.
- `rg-039` turn 1 requires booking-operation handoff while retaining double-room and bathtub conditions, without deriving a separate amenity capability from `bathtub`.
- `rg-003` is `TIER_3_SAFETY`, carries the same explicit past-date policy as `rgs-016`, and is excluded from future-price auto-answer KPI.

The previously audited false-green turns receive product-outcome requirements: `rg-010`, `rg-017`, `rg-018`, `rg-021`, `rg-023`, `rg-028`, `rg-030`, `rg-036`, `rg-038` turn 3, `rgs-001`, `rgs-018` turn 2, `rgs-019` turn 3, and `rgs-020` turn 3.

## Reports and release meaning

JSON and Markdown reports expose both per-tier counts and three independent groups: Core/Complex product outcome, Safety contract, and Edge robustness. No combined success percentage is printed.

A V1 blocker is an executed Tier 1 or Tier 2 product-outcome failure, or any Tier 3 safety violation. A correct Tier 3 handoff is a safety PASS but is excluded from automatic-answer KPI. Tier 4 failures and current-API `NOT_EXECUTABLE` cases remain visible but do not block V1 product outcome. Repair-correlation attribution remains available as an engineering diagnostic, but it is not a product-outcome pass condition.

## Verification

Contract RED tests first prove the old loader/report/evaluator accepts invalid Tier metadata, conflates summary groups, retains the four wrong expectations, and permits generic handoff omissions. Minimal fixture/runner changes then turn those tests GREEN. Required completion gates are deployed acceptance contract tests, matrix contract tests, protected acceptance, Codex integrity, a fresh complete `npm test`, and `git diff --check`.
