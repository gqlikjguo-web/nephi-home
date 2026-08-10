# V1 Acceptance Contract Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 77-case / 90-turn acceptance suite score V1 customer-visible product outcomes, safety, and edge robustness independently while detecting omitted substantive sibling requests.

**Architecture:** The two JSON sources own Tier assignment and per-turn product outcomes. The existing deployed acceptance runner validates and reports that metadata through a property-neutral subject registry; no case ID is used in product-outcome evaluation and no production runtime module changes.

**Tech Stack:** Node.js, JSON fixtures, `node:assert/strict`, existing standalone contract runners.

## Global Constraints

- Do not modify Planner, compiler/validator, Canonicalizer, Resolver, PostgreSQL runtime semantics, FinalDecision, or FinalResponse.
- Do not deploy, synchronize live PostgreSQL, or run real OpenAI.
- Preserve all property isolation, Unknown != No, claim authority, semantic structural, past-date, credential, and unsupported-operation safety contracts.
- Do not edit protected golden acceptance files.
- All acceptance changes use RED -> minimal GREEN and finish with fresh complete verification before commit/push.

---

### Task 1: Tier metadata and corrected source expectations

**Files:**
- Modify: `tests/fixtures/real-guest-fixed-matrix.json`
- Modify: `tests/fixtures/real-guest-supplemental-matrix.json`
- Test: `tests/real-guest-deployed-acceptance-matrix-runner.js`

**Interfaces:**
- Consumes: source `cases[]`, `turns[]`, `allowedActions`, `expectedSemantic`.
- Produces: exact `tiers` partition and optional `turn.productOutcomes[]` records.

- [ ] Add assertions for the four exact Tier case/turn totals and the corrected `rg-003`, `rg-029`, `rg-038`, `rg-039`, and `rgs-019` expectations.
- [ ] Run `node tests/real-guest-deployed-acceptance-matrix-runner.js` and require an assertion failure caused by missing Tier/corrected metadata.
- [ ] Add the exact Tier partitions, narrow Tier 1/2 action sets, set `rg-003` past-date safety, remove ungrounded/internal-detail expectations, and add the named false-green product outcomes.
- [ ] Re-run the matrix contract and keep any runner-feature assertions RED until Task 2.

### Task 2: Metadata-driven outcome evaluator and separated report

**Files:**
- Modify: `scripts/run-deployed-conversation-acceptance.js`
- Test: `tests/deployed-conversation-acceptance-contract-runner.js`
- Test: `tests/real-guest-deployed-acceptance-matrix-runner.js`

**Interfaces:**
- Consumes: `tier`, `productOutcomes`, Planner structured tasks, CanonicalRequest items, task results, Claim Validator, FinalDecision.
- Produces: `missingProductOutcomes(result, expectation)`, per-tier summary, grouped summary, and tiered JSON/Markdown report.

- [ ] Add a synthetic known-plus-unknown result where a generic handoff omits the known answer; assert `validateAcceptanceResult` and `assessFinalResponseEvidence` reject it.
- [ ] Add a complete synthetic result with an answered canonical sibling plus a scoped handoff sibling; assert PASS.
- [ ] Add report assertions for all four tiers and the three independent groups, including no combined success percentage.
- [ ] Run both contract runners and confirm RED failures identify the missing evaluator/summary behavior.
- [ ] Implement a fixed subject registry, exact structured/source evidence matching, and disposition validation without case-ID branches.
- [ ] Propagate Tier through loaded cases and report records, validate Tier partitions, and compute tier/group summaries.
- [ ] Keep target repair attribution as non-product engineering diagnostics rather than a blocking product outcome.
- [ ] Re-run both contract runners and require GREEN.

### Task 3: Protected and complete verification

**Files:**
- Verify only; no acceptance changes after the fresh full suite begins.

**Interfaces:**
- Consumes: final repository tree.
- Produces: recorded exit codes and exact commit/push evidence.

- [ ] Run `npm.cmd run test:deployed-acceptance-contract`.
- [ ] Run `node tests/verify-protected-acceptance-runner.js` and `npm.cmd run verify:protected-acceptance`.
- [ ] Run `node tests/verify-codex-integrity-runner.js` and `npm.cmd run verify:codex-integrity`.
- [ ] Run `node tests/real-guest-deployed-acceptance-matrix-runner.js`.
- [ ] Run a fresh `npm.cmd test` and require exit code 0.
- [ ] Run `git diff --check`, inspect exact modified paths, and confirm forbidden production paths are absent.
- [ ] Commit one scoped acceptance-contract change and non-force push `HEAD:test-only/node-pilot-integration`.
