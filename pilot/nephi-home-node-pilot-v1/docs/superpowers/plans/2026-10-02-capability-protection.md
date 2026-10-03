# Capability Protection Implementation Plan

> Execute inline with superpowers:executing-plans; no parallel agents or history operations.

**Goal:** Enforce bounded edits and trustworthy zero-token capability evidence before release.
**Architecture:** Existing trusted Core Reliability Gate remains the approval authority. New external-only modules compute actual content/impact, run offline baselines and refuse incomplete/stale evidence. No application runtime imports these modules.
**Tech Stack:** Node built-ins; existing core fixtures and tests. No new dependency or schema.
**Spec:** Owner current A–H instruction; CAPABILITY_PROTECTION.md records installation and limitations.

## Global Constraints
- Production baseline 2557101e1183d2945a5ee1994c4a5b90cfdc2391; frozen clarification worktree untouched.
- OpenAI=0; REAL/deploy/commit/push prohibited. Existing valid PASS→FAIL stops and preserves evidence.
- Candidate declarations are not approval. Trusted manifest + actual diff + independent review govern installation.

## Review Focus
Unknown/new path; stale or overwritten lock; forged PASS or omitted runner; token-budget self-approval/repeated case; canary scope and actual DB schema not proven.

## Tasks
- [ ] Pin exact task paths; inspect baseline evidence; mark trace-backed PROVEN separately from CONTRACT_BASELINE.
- [ ] RED: scope/authority drift, transitive impact, missing regression, false evidence, immutable lock, token/retry misuse and unsafe canary.
- [ ] Implement one component/content/verification manifest and focused Gate helpers; strengthen existing trusted Gate without touching runtime.
- [ ] GREEN adversarial tests and structured baseline; record zero calls and actual exit/log/content hashes.
- [ ] Full193 + protected/integrity/maintainability; dry-run clarification scope; preserve actual drift/schema/canary blockers.

No commit/deployment step in this task. Local validation does not install the Gate.

## 2026-10-03 formal activation continuation

Ruling: Owner explicitly authorized completing the remaining formal activation, token execution wiring and drift classification. The five newly scoped paths are existing approval/REAL harness/Gate-test consumers and two external governance helpers/tests, never product runtime. Preserve prior193 evidence; revalidate affected governance and the requested final complete regression. No OpenAI/REAL/DB write/deploy.

- Extend the existing private GitHub approval receipt for exact registered governance paths; serialized/self-declared approval remains rejected. The initial governance candidate is qualified by the old trusted Gate, never its own replacement.
- Select REAL cases from trusted capability mappings with prerequisite closure. No case/answer changes. Persist each request and usage, bind candidate digest, stop on missing usage/replay/over-budget/max2 violations. Legacy qualification remains compatible until trusted installation.
- Classify saved physical-schema differences separately from source parity. Unknown compatibility blocks product promotion, not governance-only installation. Canary remains disabled and independently BLOCKED.
- New RED/GREEN, existing affected governance/REAL-contract tests, full193/protected/integrity/maintainability/diff check, independent review. Then use the existing reviewed governance PR installation; stop only for required human approval or valid regression.

### Activation review findings
The completed first lock passed204 commands including all193. Independent static review identified the existing fast-path alternate entry, so its exact governance path was added before modification. Preserve the first lock/evidence; final qualification uses a fresh lock after this bounded wiring. REAL accounting uses dispatched ledger counts when budget preflight blocks a request. Old trusted REAL requirements remain additive; a requirement without new model-impact eligibility blocks independent review instead of being waived. No product change. The Owner formal-activation continuation authorizes the separate reviewed governance PR; earlier local-only no-commit restriction applied to the prior phase. No product merge/deployment is part of this task.
