# Test-only Acceptance Data Determinism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transactionally verified, OIDC-protected test-only PostgreSQL reset that runs before the first deployed acceptance request and cannot reuse prior acceptance conversation/message state.

**Architecture:** A focused provider module builds and hashes the repository manifest snapshot, synchronizes only approved acceptance-property data in one transaction, and verifies the database graph before commit. The existing OIDC-protected test-only HTTP boundary exposes initialization, while the deployed runner computes the same hash, initializes before any conversation request, and uses a fresh per-run identity scope.

**Tech Stack:** Node.js 20, CommonJS, PostgreSQL 16, PGlite, built-in `node:test`-style assertion runners, GitHub Actions OIDC.

## Global Constraints

- Do not change generic `seedPostgres()` into an overwrite path.
- Do not modify Planner, semantic compiler/validators, Canonicalizer, Resolver, FinalDecision, FinalResponse, acceptance cases, or date fixtures.
- The reset must require test-only environment and exact acceptance property scope.
- Canonical conflict or post-sync mismatch must roll back and return `INTEGRITY_FAILURE` before any OpenAI request.
- Preserve LINE/admin/message/conversation state; isolate acceptance-scoped identities and prove they are never reused across runs.
- Do not run a new 77/90 real OpenAI matrix.

---

### Task 1: Existing-property RED and canonical snapshot contract

**Files:**
- Create: `tests/test-only-acceptance-data-integrity-runner.js`
- Create: `lib/providers/test-only-acceptance-data.js`

**Interfaces:**
- Consumes: `loadSeedManifest(manifestPath)`, `normalizeSeedInput(value)`, `openPostgres(connection)`.
- Produces: `loadAcceptanceDataSnapshot(manifestPath)`, `hashAcceptanceDataSnapshot(snapshot)`, `syncTestOnlyAcceptanceData(options)`.

- [ ] **Step 1: Write the failing PGlite regression**

Create an existing acceptance property, mutate settings, room presentation/capacity/prices, knowledge, bundle/members/prices, price overrides, and both availability authorities, then call legacy `seedPostgres()` and assert those stale values remain before calling the wished-for `syncTestOnlyAcceptanceData()` API.

- [ ] **Step 2: Run the RED**

Run: `node tests/test-only-acceptance-data-integrity-runner.js`

Expected: non-zero exit after the stale-seed assertions, because the test-only synchronizer/export does not exist.

- [ ] **Step 3: Implement snapshot validation and hashing**

Build a stable JSON snapshot with exact property/settings/FAQ/room/bundle/member/pricing/availability fields. Reject duplicate identifiers/dates, invalid membership/status, a property-scope mismatch, a non-contiguous/empty availability horizon, and positive structured price data without an explicit effective-data authority marker.

- [ ] **Step 4: Implement the minimal single-transaction sync**

Require `{ testOnly: true, acceptancePropertyId, connection, manifestPath }`. Lock/upsert the property; clear only child rows in the synchronized domain; upsert exact settings/rooms; replace FAQs, bundles/members, and normalized/legacy availability; clear overrides; read back and compare exact snapshot hashes; throw `ACCEPTANCE_DATA_INTEGRITY_FAILURE` before commit on mismatch.

- [ ] **Step 5: Run focused GREEN and rollback negative controls**

Run: `node tests/test-only-acceptance-data-integrity-runner.js`

Expected: PASS for stale repair, sibling-property preservation, exact hash verification, neutral unknown pricing, and unrelated message/conversation preservation; PASS negative controls for wrong property, non-test-only execution, canonical conflict, and injected verification mismatch rollback.

### Task 2: OIDC-protected initialization and acceptance state isolation

**Files:**
- Modify: `server.js`
- Modify: `scripts/run-deployed-conversation-acceptance.js`
- Modify: `tests/test-only-conversation-acceptance-api-runner.js`
- Modify: `tests/deployed-conversation-acceptance-contract-runner.js`

**Interfaces:**
- Consumes: `syncTestOnlyAcceptanceData(options)`, existing `authorizeTestOnlyAcceptance(request)`, and the repository snapshot hash.
- Produces: authenticated `POST /api/admin/test-only/acceptance-data-integrity`, `initializeDeployedAcceptanceData(options)`, and `createAcceptanceRunScope(commit, uuid)`.

- [ ] **Step 1: Write API and runner RED tests**

Assert that the endpoint is unavailable outside test-only mode, rejects missing/invalid OIDC and wrong properties, returns the verified snapshot hash for an injected initializer, and that the deployed runner calls initialization exactly once before its first conversation request.

- [ ] **Step 2: Write identity-isolation RED tests**

Inject two distinct UUIDs at the same commit and assert different run scopes, conversation IDs, and event IDs. Assert duplicate mode reuses only its current-run event ID and clear mode targets only its current-run conversation ID.

- [ ] **Step 3: Run RED suites**

Run: `node tests/test-only-conversation-acceptance-api-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js`

Expected: non-zero exit because the endpoint, preflight initializer, and run-scope helper are absent.

- [ ] **Step 4: Implement the minimal protected boundary**

Wire an injectable initializer into `createApp()`, expose it only behind the existing OIDC authorization and test-only gates, enforce the configured property ID and PostgreSQL provider, and return `{ status: 'verified', propertyId, snapshotHash, counts }`.

- [ ] **Step 5: Implement runner preflight and fresh run scope**

Obtain OIDC after exact-SHA health, initialize/verify data, compare the local repository hash, then construct all conversation/event IDs beneath one fresh run scope. Convert any preflight failure to an error code beginning `INTEGRITY_FAILURE` and stop before `runAcceptanceMatrix()`.

- [ ] **Step 6: Run API/runner GREEN suites**

Run: `node tests/test-only-conversation-acceptance-api-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js && node tests/real-guest-deployed-acceptance-matrix-runner.js`

Expected: all structured contract tests PASS without network/OpenAI execution.

### Task 3: Permanent gates and full verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-codex-integrity.js`
- Modify: `tests/verify-codex-integrity-runner.js`
- Modify: `.github/workflows/test-only-ci.yml` only if static integrity coverage requires an explicit command beyond the runner's mandatory preflight.

**Interfaces:**
- Consumes: the focused data-integrity runner and deployed preflight contract.
- Produces: a permanent local/CI gate that fails when the synchronizer or mandatory pre-OpenAI ordering is removed.

- [ ] **Step 1: Add static mutation RED checks**

Mutate a temporary package/workflow/runner source to remove the data-integrity test or preflight call and assert `verify:codex-integrity` exits 1 with `INTEGRITY_FAILURE`.

- [ ] **Step 2: Run the integrity RED**

Run: `node tests/verify-codex-integrity-runner.js`

Expected: non-zero exit until the gate requires the new runner and initialization boundary.

- [ ] **Step 3: Add the focused script and integrity requirements**

Add `verify:test-only-acceptance-data` and require it from package/CI integrity configuration without changing acceptance cases or outcomes.

- [ ] **Step 4: Run focused and provider/isolation verification**

Run, in order:

```powershell
npm run verify:test-only-acceptance-data
npm run test:postgres
node tests/postgres-worker-smoke-runner.js
node tests/property-neutral-runtime-runner.js
node tests/onboarding-authorization-scope-runner.js
node tests/onboarding-intake-submission-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-onboarding-existing-property-apply-runner.js
npm run verify:protected-acceptance
npm run verify:codex-integrity
```

Expected: every command exits 0; PGlite/isolated PostgreSQL results remain local test evidence only.

- [ ] **Step 5: Run complete fresh verification**

Run: `npm test`

Then run: `git diff --check`, `git status --short`, and inspect the complete diff against the scope constraints.

Expected: exit 0, no skipped/forced success, no protected behavior changes, and only intended files modified.

- [ ] **Step 6: Commit and non-force push**

After all fresh gates pass, create one scoped commit and push `HEAD:test-only/node-pilot-integration` without force. Record the commit SHA, remote SHA, CI run URL/status if available, and explicitly record that no Render deployment, PostgreSQL reset, or real OpenAI matrix was executed.
