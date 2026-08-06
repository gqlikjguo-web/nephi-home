# Deployed Acceptance Repair Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a one-to-one opaque correlation-ID join between repair provenance and the target canonical evidence used by deployed target-preflight attribution.

**Architecture:** Keep semantic Planner task IDs private and create UUID v4 correlations only in diagnostic metadata. The engine joins private task IDs in memory, emits correlation-only safe provenance plus correlation-tagged canonical diagnostic copies, and the deployed acceptance validator fails closed unless the joined canonical item satisfies existing expectations.

**Tech Stack:** Node.js CommonJS, built-in `crypto`, repository contract runners, safe diagnostic projections.

## Global Constraints

- Do not change Planner understanding, coverage behavior, product answers, formal CanonicalRequest objects, fixture expected values, acceptance matrices, or `PRODUCT_BASELINE.md`.
- Correlation IDs must be opaque UUID v4 values, bounded to 36 characters, generated per turn, and unrelated to guest text, inventory, property identity, canonical subjects, prompts, provider JSON, or credentials.
- Safe trace provenance contains only bounded repair kind, bounded correlation ID, and existing necessary counts/booleans.
- Duplicate, unknown, missing, conflicting, or one-to-many correlations fail closed.
- Do not deploy or operate Render, LINE, OpenAI, or PostgreSQL.

---

### Task 1: RED attribution and privacy contracts

**Files:**
- Modify: `tests/deployed-conversation-acceptance-contract-runner.js`
- Modify: `tests/conversation-planner-v2-adapter-runner.js`
- Modify: `tests/planner-failure-safety-runner.js`
- Modify: `tests/test-only-line-message-trace-runner.js`
- Modify: `tests/test-only-line-message-trace-http-runner.js`

**Interfaces:**
- Consumes: existing Planner diagnostics, engine diagnostics, safe traces, and `validateTargetPreflightAttribution(report)`.
- Produces: failing behavioral assertions for opaque provenance creation, safe projection, exact join, privacy, and fail-closed ambiguity handling.

- [ ] Add a deployed-attribution report builder whose literal fixtures use fixed opaque UUIDs independent of production helpers.
- [ ] Assert missing provenance fails.
- [ ] Assert an unrelated repaired task plus a separate matching canonical target fails.
- [ ] Assert a coverage-repaired target with the same correlation passes.
- [ ] Assert only the truly repaired target passes in a multi-task turn.
- [ ] Assert task-collection and `rg-023` semantic repairs require the same correlation on canonical evidence.
- [ ] Assert duplicate, unknown, missing, conflicting, and one-to-many correlations fail closed.
- [ ] Assert engine/server/persisted safe projections preserve joinable opaque IDs and exclude guest text, semantic task IDs, inventory/property data in provenance, prompts, provider payloads, and credentials.
- [ ] Run the focused runners and confirm they fail for the missing production behavior, not from syntax or fixture errors.

### Task 2: GREEN diagnostic provenance generation and propagation

**Files:**
- Modify: `lib/providers/test-only-openai-conversation-planner.js`
- Modify: `lib/conversation-engine-v2/engine.js`
- Modify: `lib/test-only-line-message-trace.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: existing non-enumerable Planner repair diagnostics and semantic `repairedTasks`.
- Produces: private `{ taskId, kind, correlationId }` links, safe `{ kind, correlationId }` provenance, and canonical diagnostic `repairCorrelationId` values.

- [ ] Record affected internal task IDs for coverage, date clarification, and task-collection repair without changing task output.
- [ ] Assign strict UUID v4 correlations in diagnostic annotations only.
- [ ] Generate semantic-repair correlations after the existing semantic compiler executes.
- [ ] Join private task IDs in engine memory and add only the correlation to canonical trace copies.
- [ ] Project bounded allowlisted provenance through server and persisted safe traces.
- [ ] Run focused Planner, semantic, engine, and safe-trace runners until GREEN.

### Task 3: GREEN deployed attribution direct join

**Files:**
- Modify: `scripts/run-deployed-conversation-acceptance.js`
- Modify: `tests/deployed-conversation-acceptance-contract-runner.js`

**Interfaces:**
- Consumes: Planner/validation `repairProvenance[]`, canonical `repairCorrelationId`, and existing turn expectations.
- Produces: `TARGET_PASS_ATTRIBUTION_PROVEN` only for strict one-to-one joined target evidence.

- [ ] Parse only allowlisted repair kinds and strict opaque IDs.
- [ ] Reject missing, unknown, duplicate, conflicting, or ambiguous links.
- [ ] Match joined canonical evidence against the existing expected capability and semantic subject data without changing fixtures or matrices.
- [ ] Replace the detached marker check, including the `rg-023` special path, with the direct join.
- [ ] Run the deployed acceptance contract and confirm all required RED cases become GREEN.

### Task 4: Verification, review, and publication

**Files:**
- Modify only authority-owned historical/current documentation required to record the verified local result; do not modify `docs/PRODUCT_BASELINE.md`.

**Interfaces:**
- Consumes: final diff and fresh command evidence.
- Produces: one reviewed root-cause commit and one non-force push to `origin/test-only/node-pilot-integration`.

- [ ] Run focused contract, safe trace, semantic, and engine suites with explicit test classifications.
- [ ] Run complete `npm test`, protected acceptance, Codex integrity, Constitution, runtime uniqueness, canonical golden, and `git diff --check` gates.
- [ ] Obtain an independent Reviewer Ready verdict with no Critical or Important finding.
- [ ] Verify branch, HEAD, status, diff, and absence of unauthorized external operations.
- [ ] Create one root-cause commit containing the complete reviewed change.
- [ ] Non-force push `HEAD` to `origin/test-only/node-pilot-integration` and verify the remote branch points to the committed SHA.
