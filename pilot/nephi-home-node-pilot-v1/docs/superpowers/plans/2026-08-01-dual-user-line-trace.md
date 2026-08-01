# Test-only Dual-user LINE Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a safe, admin-readable, 72-hour test-only trace for two real LINE users asking the configured target message, without changing conversation behavior or clearing state.

**Architecture:** A focused trace service hashes identities, filters by target message hash, allowlists diagnostic stages, and appends immutable per-event stage snapshots through the persistence provider. PostgreSQL stores the bounded JSON trace; the active test-only server wires the existing diagnostic callback and LINE transport to the service, and an existing-admin-authenticated GET route reads it.

**Tech Stack:** Node.js 20 CommonJS, PostgreSQL/PGlite, existing HTTP server and admin-session guard, existing Conversation Engine V3 diagnostics.

## Global Constraints

- Enable writes and reads only when `testOnly=true` and `TEST_ONLY_LINE_MESSAGE_TRACE_ENABLED=true`.
- Never store raw LINE user IDs, channel destinations, tokens, secrets, cookies, database URLs, prompts, evidence/source text, or guest personal data.
- Never delete or reset conversation state.
- Do not alter Planner, reducer, Resolver, FinalDecision, FinalResponse, or transport authority behavior.
- Retain records for 72 hours and ignore unrelated message hashes.
- Deploy only to the existing test-only Render service; do not touch production LINE or production services.

---

### Task 1: Safe trace projection and event aggregation

**Files:**
- Create: `lib/test-only-line-message-trace.js`
- Test: `tests/test-only-line-message-trace-runner.js`

**Interfaces:**
- Produces: `sha256(value): string`, `createTestOnlyLineMessageTrace(options): { begin(input), diagnostic(entry), finalResponse(input), transport(input), list(filters) }`.
- Consumes: a persistence object exposing `upsertTestOnlyLineTrace(record)` and `listTestOnlyLineTraces(filters)`.

- [ ] **Step 1: Write the failing unit runner**

```js
const trace = createTestOnlyLineMessageTrace({
  enabled: true,
  testOnly: true,
  targetMessageSha256: sha256("8/6 有雙人房嗎？"),
  persistence,
  now: () => new Date("2026-08-01T12:00:00.000Z")
});
trace.begin({ propertyId: "nephi_home", channelId: "Ubot", lineUserId: "Ualice", eventId: "evt-a", eventTimestamp: 1, messageText: "8/6 有雙人房嗎？" });
trace.diagnostic({ traceId: "trace-a", eventId: "evt-a", stage: "state_before", state: seededState });
assert.equal(records[0].lineUserHash, sha256("Ualice"));
assert.equal(JSON.stringify(records).includes("Ualice"), false);
assert.equal(JSON.stringify(records).includes("secret-value"), false);
```

- [ ] **Step 2: Run RED**

Run: `node tests/test-only-line-message-trace-runner.js`

Expected: FAIL because `lib/test-only-line-message-trace.js` does not exist.

- [ ] **Step 3: Implement the minimal trace service**

Implement exact stage projectors for `state_before`, `planner`, `validation`, `context_validation`, `canonical_request`, `context_execution`, `executor`, `final_decision`, `final_response`, and `line_transport`. Keep an in-memory map only for correlation from event ID/trace ID; every accepted update is persisted. Reject unknown stage keys, recursively reject forbidden key names, cap arrays and strings, hash channel/user/message, and set `expiresAt = now + 72h`.

- [ ] **Step 4: Run GREEN**

Run: `node tests/test-only-line-message-trace-runner.js`

Expected: PASS including disabled/production, unrelated-message, two-user-hash, PII/credential exclusion, and state non-mutation assertions.

- [ ] **Step 5: Commit**

```bash
git add pilot/nephi-home-node-pilot-v1/lib/test-only-line-message-trace.js pilot/nephi-home-node-pilot-v1/tests/test-only-line-message-trace-runner.js
git commit -m "test-only: add safe LINE trace projection"
```

### Task 2: PostgreSQL trace persistence

**Files:**
- Create: `migrations/021_test_only_line_message_traces.sql`
- Modify: `lib/providers/contracts.js`
- Modify: `lib/providers/postgres-providers.js`
- Modify: `lib/providers/postgres-worker.js`
- Test: `tests/test-only-line-message-trace-postgres-runner.js`

**Interfaces:**
- Produces: `upsertTestOnlyLineTrace(record): record` and `listTestOnlyLineTraces({ propertyId, eventId?, traceId?, messageTextHash?, now, limit? }): record[]`.
- Consumes: the sanitized record produced by Task 1.

- [ ] **Step 1: Write the failing PostgreSQL runner**

```js
provider.upsertTestOnlyLineTrace(recordA);
provider.upsertTestOnlyLineTrace({ ...recordA, stages: { ...recordA.stages, final_decision: { action: "reply" } } });
assert.deepEqual(provider.listTestOnlyLineTraces({ propertyId: "nephi_home", now: "2026-08-01T12:01:00.000Z" })[0].stages.final_decision, { action: "reply" });
assert.equal(provider.listTestOnlyLineTraces({ propertyId: "other_property", now: "2026-08-01T12:01:00.000Z" }).length, 0);
assert.equal(provider.listTestOnlyLineTraces({ propertyId: "nephi_home", now: "2026-08-04T12:01:01.000Z" }).length, 0);
```

- [ ] **Step 2: Run RED**

Run: `node tests/test-only-line-message-trace-postgres-runner.js`

Expected: FAIL because migration 021 and provider methods are absent.

- [ ] **Step 3: Implement migration and provider RPC**

Create the table with a unique `(property_id,event_id)` constraint and indexes on expiry, trace ID, and message hash. Upsert only sanitized columns, merge/replace the bounded `stages` JSON, query only `expires_at > now`, enforce property scope, and cap results at 20. Add the two methods to the persistence contract and PostgreSQL method list.

- [ ] **Step 4: Run GREEN and migration ordering**

Run: `node tests/test-only-line-message-trace-postgres-runner.js`

Run: `node tests/availability-authority-migration-runner.js`

Expected: both PASS; migration order ends at 021.

- [ ] **Step 5: Commit**

```bash
git add pilot/nephi-home-node-pilot-v1/migrations/021_test_only_line_message_traces.sql pilot/nephi-home-node-pilot-v1/lib/providers/contracts.js pilot/nephi-home-node-pilot-v1/lib/providers/postgres-providers.js pilot/nephi-home-node-pilot-v1/lib/providers/postgres-worker.js pilot/nephi-home-node-pilot-v1/tests/test-only-line-message-trace-postgres-runner.js
git commit -m "test-only: persist bounded LINE traces"
```

### Task 3: Active webhook and authenticated read integration

**Files:**
- Modify: `server.js`
- Modify: `config/runtime.js`
- Test: `tests/test-only-line-message-trace-http-runner.js`
- Test: `tests/final-decision-contract-runner.js`

**Interfaces:**
- Consumes: Task 1 trace service and Task 2 persistence methods.
- Produces: `GET /api/test-only/line-message-traces?propertyId=<selected>&messageTextHash=<sha256>` behind the existing admin-session and property-scope guard.

- [ ] **Step 1: Write the failing HTTP/transport runner**

Start the app twice, once disabled and once with explicit test-only trace options. Assert disabled GET is 404/403, unauthenticated enabled GET is 401, cross-property query is 403, and an authenticated target event exposes all required sanitized stages and the exact submitted reply text. Capture conversation state before/after and assert tracing itself performs no delete/reset and does not change the engine result.

- [ ] **Step 2: Run RED**

Run: `node tests/test-only-line-message-trace-http-runner.js`

Expected: FAIL because the active server has no trace integration or route.

- [ ] **Step 3: Wire diagnostics without changing authority**

Construct the service only under both gates. Pass `diagnosticDetail:true` only under that condition and route the existing callback through the safe trace service. Call `begin` from the active webhook before enqueue, append FinalDecision/FinalResponse from the returned engine result, and append transport data using only `result.finalResponse.shouldReply` and `result.finalResponse.replyText`. Add the authenticated, property-scoped GET route.

- [ ] **Step 4: Run GREEN and authority regression**

Run: `node tests/test-only-line-message-trace-http-runner.js`

Run: `node tests/final-decision-contract-runner.js`

Run: `node tests/property-line-binding-runner.js`

Expected: all PASS; source assertions still reject legacy `result.shouldReply`, `result.replyText`, and `finalDecision.shouldReply` authority.

- [ ] **Step 5: Commit**

```bash
git add pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/config/runtime.js pilot/nephi-home-node-pilot-v1/tests/test-only-line-message-trace-http-runner.js
git commit -m "test-only: capture authenticated per-message LINE traces"
```

### Task 4: Verification, publication, and test-only deployment

**Files:**
- Modify: `package.json` only to add each new runner exactly once to `pretest` and `test` if repository convention requires it.
- Modify: `docs/CHANGELOG_INTERNAL.md`, `docs/PROJECT_MEMORY.md`, and `docs/NEXT_TASKS.md` with the temporary test-only diagnostic state.

**Interfaces:**
- Produces: a CI-verified test-only commit with the trace endpoint ready before the user resends either message.

- [ ] **Step 1: Run focused verification**

Run the three new runners, FinalDecision transport contracts, PostgreSQL worker/provider tests, migration ordering, and `npm.cmd run verify:codex-integrity`.

- [ ] **Step 2: Run full verification**

Run: `npm.cmd test`

Run: `git diff --check`

Run a repository sensitive-data scan for LINE credentials, bearer tokens, database URLs, raw target LINE IDs, and accidental guest data.

- [ ] **Step 3: Commit verified implementation metadata**

```bash
git add pilot/nephi-home-node-pilot-v1/package.json pilot/nephi-home-node-pilot-v1/docs/CHANGELOG_INTERNAL.md pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md
git commit -m "docs: record test-only LINE trace readiness"
```

- [ ] **Step 4: Push and wait for GitHub Actions**

Push normally, inspect every job for completed/success and no skipped required job, and do not deploy a different commit.

- [ ] **Step 5: Deploy only the existing test-only service**

Set the enable flag and target message SHA-256 on `nephi-home-node-pilot-test-only`, deploy the CI-verified commit, and verify health plus authenticated trace-read readiness without sending a LINE message or clearing state. Do not modify the production service, production LINE, DNS, or PostgreSQL availability data.
