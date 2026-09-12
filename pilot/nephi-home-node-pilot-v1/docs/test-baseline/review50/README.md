# Remaining 50 test baseline review

Baseline `1d2829417bd99174f3a4c1614992be32cbac244a` on `recovery/stability-20260910`.

**Classification/cleanup complete; this is not an all-green runtime or release claim.** Existing deterministic acceptance is 28/28 PASS; a newly exposed current property-amenity admission gap is CORE_FAIL, and the unchanged data-mover suite retains its baseline failure. Runtime/official Contract/DB/production were not modified.

## Dispositions

| Classification | Count | Action |
|---|---:|---|
| CURRENT_CORE_VALID | 26 | Retain unchanged, including shared/negative/mandatory test infrastructure |
| STALE_OLD_CORE | 21 | Delete individually evidenced obsolete entry/wire tests |
| STALE_EXPECTATION | 2 | Update fixtures/assertion ownership to existing official Contract; both PASS |
| REPLACED | 0 | No unsupported full-file coverage-equivalence claim |
| COVERAGE_MISSING | 1 | Retain old test; add current production-entry protection (2 cases, both CORE_FAIL) |

Test files under the prior inventory convention: 236 → 216 (21 removed, 1 added). This includes gateway.test.js; strict *runner.js counts are 235 → 215. The 186 out-of-scope test sources, including the prior cleanup guard, are unchanged; their previous classification was not redone.

## Individual decisions

| # | Test | Classification | Action |
|---:|---|---|---|
| 1 | amenity-list-pipeline-control-runner.js | COVERAGE_MISSING | RETAIN |
| 2 | breakfast-category-grounding-runner.js | CURRENT_CORE_VALID | RETAIN |
| 3 | controlled-context-authority-runner.js | CURRENT_CORE_VALID | RETAIN |
| 4 | controlled-custom-reply-runtime-runner.js | CURRENT_CORE_VALID | RETAIN |
| 5 | conversation-contract-runtime-green-runner.js | CURRENT_CORE_VALID | RETAIN |
| 6 | conversation-engine-v2-integration-runner.js | CURRENT_CORE_VALID | RETAIN |
| 7 | conversation-followup-runner.js | CURRENT_CORE_VALID | RETAIN |
| 8 | conversation-planner-v2-adapter-runner.js | CURRENT_CORE_VALID | RETAIN |
| 9 | core-90-limited-fixes-runner.js | CURRENT_CORE_VALID | RETAIN |
| 10 | coverage-critic-contract-runner.js | STALE_OLD_CORE | REMOVE |
| 11 | coverage-critic-planner-integration-runner.js | STALE_OLD_CORE | REMOVE |
| 12 | deployed-conversation-acceptance-contract-runner.js | CURRENT_CORE_VALID | RETAIN |
| 13 | dialogue-temporal-state-contract-runner.js | CURRENT_CORE_VALID | RETAIN |
| 14 | first-version-acceptance-matrix-runner.js | CURRENT_CORE_VALID | RETAIN |
| 15 | first-version-controlled-core-runner.js | CURRENT_CORE_VALID | RETAIN |
| 16 | first-version-data-mover-runner.js | CURRENT_CORE_VALID | RETAIN |
| 17 | location-google-maps-runner.js | CURRENT_CORE_VALID | RETAIN |
| 18 | location-readiness-regression-runner.js | CURRENT_CORE_VALID | RETAIN |
| 19 | lodging-price-supplement-semantic-ownership-runner.js | CURRENT_CORE_VALID | RETAIN |
| 20 | new-core-openai-adapter-contract-runner.js | STALE_EXPECTATION | UPDATE_TEST_ONLY |
| 21 | new-core-start-clarify-state-runner.js | STALE_EXPECTATION | UPDATE_TEST_ONLY |
| 22 | pending-request-contract-runner.js | CURRENT_CORE_VALID | RETAIN |
| 23 | planner-failure-safety-runner.js | CURRENT_CORE_VALID | RETAIN |
| 24 | planner-normalizer-semantic-preservation-runner.js | STALE_OLD_CORE | REMOVE |
| 25 | planner-semantic-reviewer-red-runner.js | STALE_OLD_CORE | REMOVE |
| 26 | planner-state-control-removal-runner.js | CURRENT_CORE_VALID | RETAIN |
| 27 | planner-strict-schema-contract-runner.js | STALE_OLD_CORE | REMOVE |
| 28 | planner-timeout-observability-runner.js | STALE_OLD_CORE | REMOVE |
| 29 | provider-shaped-conversation-fixture-runner.js | CURRENT_CORE_VALID | RETAIN |
| 30 | real-guest-deployed-acceptance-matrix-runner.js | CURRENT_CORE_VALID | RETAIN |
| 31 | relation-evidence-contract-runner.js | CURRENT_CORE_VALID | RETAIN |
| 32 | semantic-candidate-coverage-contract-runner.js | STALE_OLD_CORE | REMOVE |
| 33 | semantic-candidate-ledger-compiler-runner.js | STALE_OLD_CORE | REMOVE |
| 34 | semantic-candidate-provenance-runner.js | STALE_OLD_CORE | REMOVE |
| 35 | test-only-acceptance-data-integrity-runner.js | CURRENT_CORE_VALID | RETAIN |
| 36 | test-only-acceptance-oidc-runner.js | CURRENT_CORE_VALID | RETAIN |
| 37 | test-only-conversation-acceptance-api-runner.js | CURRENT_CORE_VALID | RETAIN |
| 38 | unique-core-convergence-red-runner.js | CURRENT_CORE_VALID | RETAIN |
| 39 | pilot-nephi-home-node-pilot-v1-ai-first-runner.js | STALE_OLD_CORE | REMOVE |
| 40 | pilot-nephi-home-node-pilot-v1-behavior-runner.js | STALE_OLD_CORE | REMOVE |
| 41 | pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js | STALE_OLD_CORE | REMOVE |
| 42 | pilot-nephi-home-node-pilot-v1-nephi-faq-runtime-runner.js | STALE_OLD_CORE | REMOVE |
| 43 | pilot-nephi-home-node-pilot-v1-nephi-property-runner.js | STALE_OLD_CORE | REMOVE |
| 44 | pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js | STALE_OLD_CORE | REMOVE |
| 45 | pilot-nephi-home-node-pilot-v1-precise-clarification-runner.js | STALE_OLD_CORE | REMOVE |
| 46 | pilot-nephi-home-node-pilot-v1-query-mode-dedupe-runner.js | STALE_OLD_CORE | REMOVE |
| 47 | pilot-nephi-home-node-pilot-v1-room-filter-state-runner.js | STALE_OLD_CORE | REMOVE |
| 48 | pilot-nephi-home-node-pilot-v1-single-date-default-runner.js | STALE_OLD_CORE | REMOVE |
| 49 | pilot-nephi-home-node-pilot-v1-timeout-runner.js | STALE_OLD_CORE | REMOVE |
| 50 | pilot-nephi-home-node-pilot-v1-trailing-flush-runner.js | STALE_OLD_CORE | REMOVE |

See [classification.json](classification.json) for every original responsibility, source/import/assertion evidence, retirement reason, supporting current tests and coverage-gap decision. [SPECIAL_FAILURES.md](SPECIAL_FAILURES.md) explains both changed tests and the two retained failure categories with exact source boundaries.

## Verification and protection

83 unique necessary verification commands executed: 81 PASS, 2 FAIL. The two failures are the unchanged legacy/shared data-mover failure and the new current amenity protection. No previously valid PASS became FAIL. The existing current deterministic matrix (28 runners), protected, integrity, production turn adapter/LINE/burst fixture paths, Temporal permanent regression (48 cases), and Context/State/quantity/correction/FinalResponse affected runners pass. These are local structured/fixture checks, not REAL E2E. The extended current-core coverage is explicitly RED.

The test cleanup conservation runner remains byte-identical and passes 6/6, including its missing-runner and duplicate-command negative controls. Its test inventory snapshot was migrated for exactly the 21 authorized retirements: only six obsolete lifecycle invocations were removed (77 → 71 original unique commands); no mandatory protected/integrity/current acceptance implementation or source Gate changed. Supporting current runners remain callable through test scripts.

The new amenity test is included in npm test and test:review50-current without skip/expected-failure treatment. Its old passing suite stays present because the new current protection has not reached GREEN. Consequently this review does not manufacture an all-green npm test baseline.

Raw logs and hashes: [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md). Exact final command/exit results: [results.json](results.json). No deployment is part of this task.
