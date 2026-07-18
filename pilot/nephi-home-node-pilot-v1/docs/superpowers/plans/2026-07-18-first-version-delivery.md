# JunZan AI First-Version Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the test-only V2 path preserve existing property-scoped resolver behavior and prove all first-version capabilities with a data-driven matrix.

**Architecture:** V2 validates planner candidates and state, adapts canonical requests into the existing resolver contract, then turns resolver output into property-scoped response-plan facts. The existing resolver remains the only source of availability, knowledge, policy, pricing, and reliability facts.

**Tech Stack:** Node.js, PostgreSQL/PGlite test providers, existing V2 engine, Node assert runners, Render test-only deployment.

## Global Constraints

- No formal LINE, webhook, secret, database, or environment change.
- No property-specific branching in Shared Core.
- Test first; observe each new matrix assertion fail before production code changes.
- `propertyId` is required at every data boundary.
- Composer may only express Response Plan facts; safety boundaries are deterministic.

---

### Task 1: Add the failing property-scoped acceptance matrix

**Files:**
- Create: `tests/first-version-acceptance-matrix-runner.js`
- Modify: `package.json`

- [ ] Define two independently seeded properties and data cases for required Nephi scenarios plus generic variants.
- [ ] Run the new runner and confirm it fails because the V2 path cannot yet preserve the existing resolver contract.
- [ ] Add the runner to `pretest` only after its checks are implemented.

### Task 2: Add the canonical-request resolver adapter

**Files:**
- Create: `lib/conversation-engine-v2/resolver-adapter.js`
- Modify: `lib/conversation-engine-v2/capability-executor.js`
- Modify: `lib/conversation-engine-v2/engine.js`

- [ ] Implement only shape conversion from validated canonical state/entity values to the existing resolver API and map its result to task outcomes.
- [ ] Run the matrix; confirm availability, reliability, and isolation assertions pass without property-specific code.

### Task 3: Complete property-backed knowledge resolution

**Files:**
- Modify: `lib/conversation-engine-v2/property-catalog.js`
- Modify: `lib/conversation-engine-v2/capability-executor.js`
- Test: `tests/first-version-acceptance-matrix-runner.js`

- [ ] Make property settings and knowledge items uniformly searchable by canonical catalog entities and aliases.
- [ ] Preserve deterministic unknown/handoff when no source-backed fact exists.
- [ ] Run the matrix and confirm different property knowledge, policy, names, and unknown behavior remain isolated.

### Task 4: Lock reply and state safety with regression cases

**Files:**
- Modify: `tests/conversation-engine-v2-coverage-runner.js`
- Modify: `tests/conversation-engine-v2-response-composition-runner.js`
- Modify: `tests/first-version-acceptance-matrix-runner.js`

- [ ] Add assertions for three identical inputs, multi-task coverage, state modifications, whole-message composer fallback, and no internal/garbage output.
- [ ] Run focused V2 runners and the matrix until all pass.

### Task 5: Full verification and test-only delivery evidence

**Files:**
- Modify: `docs/PROJECT_MEMORY.md`
- Modify: `docs/NEXT_TASKS.md`
- Modify: `docs/CHANGELOG_INTERNAL.md`

- [ ] Run `npm test` to exit 0.
- [ ] Deploy only the approved test-only branch through the existing deployment integration.
- [ ] Verify the deployed commit, HTTP 200, `status=ready`, and `testOnly=true`.
- [ ] Record only verified status and the minimal remaining human LINE checks.
