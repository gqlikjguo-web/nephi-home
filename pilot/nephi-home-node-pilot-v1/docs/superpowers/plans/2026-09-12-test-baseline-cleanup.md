# Test baseline cleanup implementation plan

**Goal:** Retire proven obsolete test assertions and repeated execution without changing production behavior or losing current protection.

**Architecture:** Reuse the Sep 11 source audit and refresh only file/version/wiring facts against ddc7a7e. Keep all mixed or uncertain suites. Separate inventory classification from execution evidence. Existing runtime Contracts and protected gates remain byte-identical.

**Tech stack:** Node assertion runners, npm lifecycle, JSON inventory, Git.

**Spec:** User-authorized test-only cleanup, 2026-09-12; existing source audit `/home/gqlik/junzan-core-review-20260911/test-system-review.md` and proactive audit test-inventory delta.

## Constraints

- No production runtime, Contract, database, credential, deployment or REAL LINE action.
- Every retirement needs original scope, stale evidence, replacement responsibility and coverage limits.
- Keep current-core/production-equivalent/protected/integrity coverage; uncertain failures are NEEDS_REVIEW.
- Stop if cleanup removes a formal protection or introduces false acceptance.
- Commit and push test changes only; no deployment.

## Steps

- [x] Capture original package lifecycle and run relevant baseline commands, including all current-core suites and retirement replacements.
- [x] Record every current runner using prior audit classification, file hashes, primary evidence and preservation disposition; explicitly retain changed/mixed legacy entries.
- [x] Retire only two standalone obsolete Planner prompt-text tests after confirming no consumer imports them: non-actionable-planner-instructions-contract and planner-amenity-list-instructions-contract. Their current semantic responsibility is exercised by wire-schema, semantic-unit, unit-routing, unit-aggregation and request-responsibility tests. Old prompt wording is no longer an acceptance Contract. Real natural-language acceptance remains separate.
- [x] Remove exactly repeated identical commands from normal pretest/test/posttest execution; retain the unique command set and earliest invocation order. Keep the phase1 wrapper because its grouping remains consumed by the constitution runner.
- [x] Add a test-only baseline cleanup regression that rejects missing original command coverage, duplicated lifecycle entries, missing replacement tests and removal of current regression files. Capture negative controls before changing the package.
- [x] Save itemized cleanup inventory and review limits under docs/test-baseline; do not modify existing acceptance manifests or gates.
- [x] Run candidate current-core acceptance, protected/integrity, production-equivalent local runners, permanent temporal and quantity/context/correction/final-response regressions. Preserve exact exit codes and compare baseline failures.
- [ ] Verify runtime/Contract/protected bytes unchanged and clean scope, then commit and push the current recovery branch. No Render trigger or production branch push is needed for this test-only task.

Verification complete: 83 candidate commands, 81 PASS and 2 unchanged baseline FAIL retained as NEEDS_REVIEW. Current acceptance 28/28, deterministic acceptance, protected/integrity, temporal48, production-boundary tests and quantity/context/correction/final-response affected suites passed except the two explicitly retained standalone review entries. Commit/push is the final pending bookkeeping step until release evidence records its SHA.
