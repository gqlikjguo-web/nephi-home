# JunZan AI Onboarding Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable, property-safe Onboarding request-changes and approval review flows with one active hashed resume token, non-blocking Email delivery, Email-first invitations, and clear responsive result states.

**Architecture:** Keep the existing PostgreSQL onboarding tables and provider RPC. Strengthen row-locked transactions and service error mapping, return the newly issued resume URL from the protected request-changes route, split approval into explicit new/existing modes, and retain only a disabled internal compatibility key where current foreign keys require it. Render one admin review state machine in the existing plain JavaScript page.

**Tech Stack:** Node.js CommonJS, PostgreSQL/PGlite, existing provider worker RPC, plain HTML/CSS/JavaScript, Node assertion runners, in-app browser QA.

## Global Constraints

- Work only in the configured Node Pilot repository on `test-only/node-pilot-integration`.
- Never write formal `nephi_home` onboarding, property, account, availability, pricing, FAQ, note, LINE, or contactLink data during implementation or QA.
- Never modify formal Email identities, password hashes, sessions, platform admin grants, Render secrets, Resend configuration, DNS, or LINE credentials.
- Existing-property approval must fail safely until controlled property application exists; it must never create a replacement property.
- Store only resume token hashes in PostgreSQL and allow at most one active token per application.
- Use test properties, test submissions, and test identities only.

---

### Task 1: Request-changes Transaction and Token Lifecycle

**Files:**
- Create: `tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/postgres-worker.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/onboarding-service.js`
- Modify: `pilot/nephi-home-node-pilot-v1/server.js`

**Interfaces:**
- Produces: `reviewOnboarding(...) -> {application, notification:{noteId,shouldNotify}, resumeTokenHashPersisted:true}`.
- Produces: `onboarding.review(...) -> {application,resumeToken,expiresAt,emailStatus}`.
- Produces: protected request-changes response `{application,resumeUrl,expiresAt,emailDelivery}`.

- [ ] **Step 1: Write failing integration assertions**

Create a PGlite runner that seeds only `review_test_platform`, `review_test_new`, and test submissions. Assert blank reason 400, a valid request changes status and saves the exact trimmed reason, raw token is absent from DB, hash resolves, expiry is 30 days, prior tokens are deleted, a second request returns 409, an approved request returns 409, and an injected delivery insert failure rolls back application/note/token rows.

- [ ] **Step 2: Run RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js --request-changes`

Expected: failures for duplicate 409, single-token lifecycle, response URL, or rollback coverage.

- [ ] **Step 3: Implement the transaction and error mapping**

In `reviewOnboarding`, remove the existing already-changes-requested retry branch. Require `submitted|resubmitted`, delete all application resume tokens before insert, and return the committed application. In `submitOnboarding`, use a transaction and delete resume tokens when changing `changes_requested -> resubmitted`. Map provider state errors to `AppError` 404/409 and change the generic 500 message to `系統暫時無法處理請求，請稍後再試。`.

- [ ] **Step 4: Return the same resume link and isolate Email**

Keep raw token only in service memory. After provider commit, attempt Email and delivery-status updates inside best-effort handling; always return the committed application plus raw token/expiry/email status. Build `resumeUrl` only at the protected server route boundary.

- [ ] **Step 5: Run GREEN and commit**

Run the new request-changes runner and existing onboarding runner. Commit transaction/token changes separately.

### Task 2: Explicit Approval Modes and Email-first Compatibility

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/postgres-providers.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/postgres-worker.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/onboarding-service.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/admin-auth.js`
- Modify: `pilot/nephi-home-node-pilot-v1/server.js`
- Test: `tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js`

**Interfaces:**
- Produces: `onboarding.approve(id,{mode,newPropertyId,targetPropertyId},session)`.
- Produces: `listApprovalProperties() -> [{propertyId,displayName}]` for platform-admin UI.
- Produces: system key `onboarding_<normalized application id>` stored only in `admin_users.username`, `admin_user_properties.username`, and `property_admin_invitations.username`.
- Produces: disabled marker recognized by legacy username auth and never accepted as a credential.

- [ ] **Step 1: Write failing approval/security assertions**

Assert `existing` without target is 400, nonexistent target is 404, existing target returns 409 without changing property rows, `nephi_home` row counts remain unchanged, and no replacement property is created. Assert `new` creates one test property and Email invitation without `owner`; compatibility username is not returned in UI/API, cannot log in through legacy login, is created once, and creates no platform grant.

- [ ] **Step 2: Run RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js --approval`

Expected: old `propertyId/adminUsername` API and `owner` creation fail the new contract.

- [ ] **Step 3: Implement explicit modes**

Validate `mode` as `new|existing`. For `existing`, verify target through the existing customer-settings provider and return `EXISTING_PROPERTY_APPLY_NOT_AVAILABLE` before any mutation. For `new`, validate `newPropertyId`, reject existing IDs, derive the compatibility key internally, and use the submitted Email in `property_admin_invitations`.

- [ ] **Step 4: Disable legacy credential and preserve identities**

Add a non-hash disabled marker for the compatibility `admin_users` row and make legacy username login reject it. Invitation redemption creates a new Email identity only when none exists; for an existing identity it preserves Email/password hash and only adds the new property membership. Never write `platform_admin_grants`.

- [ ] **Step 5: Run GREEN and commit**

Run approval/security checks, admin Email tests, onboarding tests, and property isolation tests. Commit approval/auth compatibility changes separately.

### Task 3: Stable Responsive Review UI

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/public/admin-onboarding.html`
- Modify: `pilot/nephi-home-node-pilot-v1/public/assets/admin-onboarding.js`
- Modify: `pilot/nephi-home-node-pilot-v1/public/assets/onboarding.css`
- Test: `tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js`

**Interfaces:**
- Consumes: request-changes success object and approval property list.
- Produces: stable success result state and explicit new/existing approval controls.

- [ ] **Step 1: Add failing front-end contract assertions**

Assert the asset has request reason trimming, pending-state disabling, a success result renderer, copy-link action, retained failure draft, `mode` payload, no editable `adminUsername`, no default `owner`, and CSS for 44px targets/no overflow.

- [ ] **Step 2: Run RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-onboarding-review-workflow-runner.js --frontend`

Expected: missing stable result and explicit approval-mode controls.

- [ ] **Step 3: Implement UI state machine**

Separate review information, request changes, and approval sections. On request success, replace actions with a result card showing property, reason, status, Email state, Copy Link, Return to List, and View Submission. On failure, preserve textarea and restore actions. Remove username input; show invitation Email read-only.

- [ ] **Step 4: Implement responsive styles and GREEN**

Use single-column action groups below 640px, `min-width:0`, `overflow-wrap:anywhere`, and 44px controls. Run static checks and commit UI changes.

### Task 4: Full Verification, Browser QA, Push, and Deploy

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/package.json`
- Modify only for reproduced defects: files from Tasks 1-3

- [ ] **Step 1: Add runner to `npm test` and execute targeted regression**

Run the new runner, onboarding, admin Email, daily availability/calendar, Guest, property isolation, and PostgreSQL provider runners.

- [ ] **Step 2: Execute complete regression and scans**

Run `npm.cmd test`, `git diff --check`, a changed-line credential scan, and a forbidden-scope diff scan.

- [ ] **Step 3: Browser QA with test-only data**

Use a temporary PGlite app and test platform admin. Verify empty reason, successful return, stable result, copied resume link, applicant reason, resubmission, API failure retention, Email unconfigured, duplicate click, state rejection, new property view, existing-property block, and desktop/390/375 overflow and touch targets.

- [ ] **Step 4: Fix reproduced issues test-first**

For every defect, add a failing assertion, reproduce RED, apply one scoped fix, and rerun affected automation/browser flows.

- [ ] **Step 5: Commit, push, and deploy**

Commit final verification fixes, push `test-only/node-pilot-integration`, use the unchanged Render workflow, and verify the final asset plus `https://app.junzanai.com/api/health` returns HTTP 200 with `status=ready`. Do not run production review/approval mutations.
