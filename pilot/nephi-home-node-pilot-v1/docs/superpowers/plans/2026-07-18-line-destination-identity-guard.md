# LINE Destination Identity Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate numeric LINE Channel ID from webhook Bot User ID and return an explicit 4xx when webhook destination identity does not match.

**Architecture:** Runtime configuration carries both `channelId` and `destinationId`. Startup validation requires both identities plus the existing environment, route, secret fingerprint, and token checks; webhook validation compares only `payload.destination` with `destinationId` and throws an HTTP-aware guard error.

**Tech Stack:** Node.js CommonJS, built-in `assert`, existing HTTP server and test runners.

## Global Constraints

- Keep `NEPHI_PILOT_LINE_CHANNEL_ID` for configuration and audit identity.
- Add `NEPHI_PILOT_LINE_DESTINATION_ID` for webhook destination validation.
- Do not modify the Conversation Engine, external settings, LINE, Render, or databases.
- Use test-driven development and run the complete `npm test` suite.

---

### Task 1: Destination identity and explicit HTTP error

**Files:**
- Modify: `tests/line-channel-identity-guard-runner.js`
- Modify: `lib/line-channel-identity-guard.js`
- Modify: `config/runtime.js`
- Modify: `server.js`
- Modify: `docs/SECURITY.md`

**Interfaces:**
- Consumes: LINE webhook payload `destination` and runtime environment variables.
- Produces: validated identity `{ environment, channelId, destinationId, webhookRoute }` and guard errors with `status=400`.

- [ ] **Step 1: Write failing unit and HTTP integration tests**

Add assertions covering correct and incorrect destination IDs, separation from numeric Channel ID, existing route and secret failures, successful coordinator entry, and a 400 response carrying `LINE_CHANNEL_IDENTITY_MISMATCH`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/line-channel-identity-guard-runner.js`

Expected: FAIL because `destinationId` is not required or used and guard errors currently become HTTP 500.

- [ ] **Step 3: Implement the minimal identity separation**

Read `NEPHI_PILOT_LINE_DESTINATION_ID` in runtime config, include `destinationId` in startup validation, compare webhook destination only with that value, and make guard errors expose status 400.

- [ ] **Step 4: Document the environment variable**

Add the two distinct LINE identity types and safe Bot User ID acquisition guidance to `docs/SECURITY.md`; do not include secrets or tokens.

- [ ] **Step 5: Verify focused and complete suites**

Run: `node tests/line-channel-identity-guard-runner.js`

Run: `npm test`

Run: `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 6: Commit and push**

Commit only the scoped source, test, security documentation, and this plan; push `test-only/node-pilot-integration`.
