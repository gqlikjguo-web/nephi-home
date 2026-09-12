# Test baseline cleanup — 2026-09-12

This is test maintenance against deployed commit `ddc7a7e7156165a2f5d9571f55f2678dc502e4da`. It changes no runtime, official Contract, database schema, protected gate or deployment configuration. It does not report the user's concurrent REAL LINE observations or claim a REAL provider run.

## Inventory and evidence boundaries

`2026-09-12-inventory.json` enumerates **237 tracked runner files before cleanup**, including the gateway test. It reuses the Sep 11 audit's file-specific scope and source anchors, refreshes membership and hashes, and marks source drift. Historical whole-file labels alone do not authorize deletion. Non-runner helpers and fixtures are not counted as runners. Each original runner has a preservation disposition; unexecuted files say NOT_RUN_IN_THIS_TASK.

The main categories remain distinct: current-core Contracts/regressions; shared valid regression; old-core candidates retained for review; test-only legacy; maintenance checks; grouping wrapper. Production-equivalent local entry tests additionally carry FAKE_INTEGRATION/RUNTIME_COMPONENT_TEST tags. Existing protected/integrity/acceptance files remain present and byte-identical. A manifest ID count is not an executed test count; a local fake provider is not REAL OpenAI/PostgreSQL/LINE.

## Itemized retirements and changes

| Test/change | Original responsibility | Direct stale/duplicate evidence | Current protection and remaining gap |
|---|---|---|---|
| Remove non-actionable-planner-instructions-contract-runner | Six exact prose requirements for old Planner actionability, discourse, shouldIgnore, generic unknown task, relation_uncertain and lifecycle human_help instructions | Entire file imports only test-only Planner instructions and checks string inclusion. Old Planner is the retained legacy seam; production server selects Understanding admission. The exact prose/old wire fields are not current C02/C03/C07 authority. No package, CI or test imports this runner. Baseline itself PASS; deletion is not motivated by failure. | Current wire-schema/semantic-unit test non-actionable representation, unit-routing tests NO_REPLY/operator responsibility, request-responsibility tests final outcomes. Retain all their positive and negative controls. REAL model actionability interpretation remains a separate acceptance boundary, never established by prompt string checks. |
| Remove planner-amenity-list-instructions-contract-runner | Two exact old Planner prose strings for collection versus distinct named-subject questions | Entire file imports only test-only Planner instructions. No package, CI or test imports it. Baseline PASS. Current Understanding/C03 capability policy owns collection admission and per-unit identity. | semantic-unit runner admits catalog-grounded amenity_list and rejects conflicting subjects; unit-aggregation preserves separate units and rejects coverage/orphan conflicts. No local invariant removed; real natural-language distinction remains REAL acceptance, not old prompt wording. |
| Update new-core-relative-semantics-runner | Reject typed relative representation on explicit absolute-date source even when canonical meaning agrees | Old test line22 contradicts approved deployed canonical interval equivalence: relative-temporal-semantics.js canonicalTemporalValue/compareCanonicalTemporalSemantics and temporal-resolver.js parseRelativeSemantics. Baseline resolved Sep12–13 while old expected unresolved. | Keep suite and duration/range safety. Replace label-only rejection with exact Sep12–13/one-night positive plus differing-offset interval negative asserting conflict and cleared dates. Permanent 48-case temporal runner remains unchanged. |
| Update new-core-epistemic-claim-runner | Official Unknown validates; missing/forged provenance and missing factual source reject | Helper hardcodes plan.propertyId=fixture, while run() returns a random real fixture scope. claim-validator.js:53 correctly rejects unknown_property_scope_mismatch. This makes three supposed positive prerequisites invalid. | Pass original observed ResponsePlan input's propertyId into helper. Keep provenance/factual-source failures, and add a distinct cross-property negative. No validator relaxation or guessed scope. |
| Remove 43 duplicate npm lifecycle invocations | Same 43 runners were invoked in pretest then again in test | Exact same command, arguments and cwd; first invocation must pass for later stage to start. npm stage metadata differs, but no test/lib source consumes npm lifecycle event/script/command variables; these are not distinct parameterized cases. `2026-09-12-duplicate-invocations.json` records every removed invocation and retained stage. | All 77 original unique commands remain; ordering of first invocation remains. New cleanup runner rejects missing original commands, duplicates and lost retained/replacement files. No distinct mutation/negative-probe invocation removed. |

The phase1 wrapper remains: `junzan-ai-constitution-contract-runner.js` requires it, and its five children own separate invariants. Broad old-core files remain because they mix surviving shared contracts. No protected artifact was retired and no golden/acceptance expected data was changed.

## Entries and scope

- `npm run test:baseline-cleanup`: local coverage conservation check, with negative controls for duplicate execution, missing command, missing retained file and missing replacement entry.
- `npm run test:baseline-replacements`: five current semantic/admission/routing/aggregation/responsibility runners backing the two prompt-test retirements.
- Normal `npm test` still runs the entire original **77 unique** command set through pretest/test/posttest, plus the new cleanup runner. A direct `npm run test --ignore-scripts` intentionally does not mean the full lifecycle and is not a replacement acceptance entry.
- `npm run test:new-core-deterministic-acceptance`: unchanged existing current acceptance map; no groups, IDs or expected results altered.
- `npm run test:new-core-relative-temporal-contract`: unchanged permanent temporal regression.
- Production-turn adapter, production LINE candidate and burst webhook runners exercise current production boundaries with controlled local provider/transport inputs. Their execution does not send REAL LINE messages.
- `run:new-core-openai-shadow-acceptance` remains an optional REAL Understanding-only harness, not full business E2E. Legacy deployed-conversation acceptance scripts remain classified by their actual entry, not by the word deployed. No REAL scripts were removed or executed by this task.
- Protected acceptance and codex integrity commands, implementations, manifests and workflow requirements remain unchanged.

## Review queue and limits

The before-cleanup extended run found four existing failing suites. Two have the direct stale fixture/expectation evidence above. Two remain unchanged and **NEEDS_REVIEW**:

1. `new-core-openai-adapter-contract-runner.js:364`: supposed valid provider-schema fixture is rejected. No stale diagnosis or runtime root cause established in this maintenance task.
2. `new-core-start-clarify-state-runner.js:149`: expected missing stay dates but route reports an empty missing-field list. No stale diagnosis or runtime root cause established here.

Other old-core/legacy mixed files retain their inherited review classification. Do not infer that every assertion is obsolete or that an unexecuted runner is green. Current required 28-runner acceptance and extended standalone suites have separate denominators. A scoped cleanup can be complete while this explicitly preserved review queue remains open; no broad all-tests-green claim is made.

No current responsibility became unprotected through these retirements. The added cleanup runner protects conservation of original execution/membership; added paired safety controls strengthen the two updated suites. Full REAL LINE delivery, provider variability and pending REAL acceptance remain outside this test-only task, alongside the two unresolved baseline failures.

Raw command output and before/after exit summaries: `/home/gqlik/junzan-test-baseline-20260912/`. Prior classification evidence: `/home/gqlik/junzan-core-review-20260911/test-system-review.md`, `test-inventory.json`, and `/home/gqlik/junzan-proactive-audit-20260911/test-inventory-delta.json`. Exact current results and release metadata are recorded separately after verification.
