# Test-only dual-user LINE trace design

## Goal

Add a temporary, test-only, per-message diagnostic record that can compare two real LINE users asking the same availability question without changing conversation decisions or clearing existing state.

The diagnostic must preserve enough evidence to locate the first divergent layer: state before processing, pending work, Planner output and validation, CanonicalRequest and temporal resolution, PostgreSQL availability resolution, FinalDecision, FinalResponse, and the text handed to LINE transport.

## Scope and invariants

- The feature is enabled only when the runtime is both `testOnly=true` and an explicit diagnostic flag is enabled.
- It observes the existing engine and transport outputs; it does not alter Planner input, reducer transitions, Resolver queries, FinalDecision, FinalResponse, or LINE delivery.
- It never deletes or resets conversation state.
- It never operates on production LINE credentials, bindings, services, or routes.
- It traces only the configured target message hash. The configured value is a SHA-256 digest, not the guest message itself, so unrelated LINE traffic is not retained.
- Raw LINE user IDs are used only long enough to compute SHA-256 and are never stored or logged.

## Considered approaches

1. **Structured PostgreSQL trace records with an authenticated read API (selected).** Durable across restarts, queryable for side-by-side comparison, and independently testable. It requires a migration and narrow provider methods.
2. **Render logs only.** Smaller implementation, but log access and retention are unreliable and multi-line traces are difficult to correlate safely.
3. **In-memory traces.** Minimal persistence work, but service restarts destroy the evidence and make the requested comparison unreliable.

## Data model

Create a test-only trace table with one record per LINE event:

- `property_id`
- `channel_id_hash`
- `event_id`
- `event_timestamp`
- `line_user_hash`
- `message_text_hash`
- `trace_id`
- `stages` as allowlisted JSONB
- `expires_at`
- created/updated timestamps

The unique key is property plus event ID. Records expire after 72 hours. Reads exclude expired rows, and writes may remove only expired diagnostic rows; conversation and message state are never deleted.

## Captured stages

The existing diagnostic callback is used with diagnostic detail enabled only under the test-only trace flag. The sink retains only the target message hash and projects each stage into an explicit allowlist:

- `state_before`: V3 revision, tasks, pending requests, missing slots, temporal status, handoff/review/stale markers; source text and user identifiers are removed.
- `planner`: parsed structured fields required for comparison; evidence quotes, source text, prompts, provider bodies, and identifiers are removed.
- `validation` and `context_validation`: acceptance state and stable reason codes.
- `canonical_request`: capability, canonical entity, required fields, temporal state, resolver ID, risk and response modes.
- `temporal`: the canonical temporal state and slot sources already emitted at the canonical/context boundaries.
- `resolver`: operation, query scope, result status, room/bundle identifiers and availability facts; no guest or credential data.
- `final_decision`: action, reason code, review requirement and missing fields.
- `final_response`: action, shouldReply and the sanitized reply text.
- `line_transport`: attempted/delivered state, stable reason code and the exact sanitized text submitted to the LINE client.

Early-return paths must also append FinalDecision and FinalResponse before the engine discards its in-memory trace context.

## Sanitization

The persistence boundary rejects unknown keys and recursively removes:

- raw `lineUserId`, user IDs, source IDs and channel destination IDs;
- tokens, secrets, cookies, authorization headers, database URLs and credentials;
- guest names, phone numbers, email addresses, booking/contact details and evidence/source message text;
- raw provider request/response bodies, prompts and stack traces.

Strings are length-bounded. The actual outgoing reply is retained only for the configured target message and is rejected/redacted if it matches a credential or personal-data pattern. Hashes use SHA-256 hex.

## Read access

Add a GET endpoint under the existing admin-authenticated data routes. It is available only in a test-only runtime with diagnostics enabled, and returns only non-expired records for the authenticated property scope. It accepts bounded filters such as event ID, trace ID, or message-text hash; it never accepts SQL or raw LINE IDs.

## Failure handling

Diagnostic failures are isolated from message processing and LINE delivery. A failed trace write emits only a stable error code and hashes, never payload data. The user receives the unchanged production decision. The endpoint fails closed when the test-only flag or admin authentication is absent.

## Test strategy

Tests are written and observed RED before implementation. They must prove:

- production or disabled diagnostics write nothing and expose no endpoint;
- two users produce distinct hashes without persisting raw IDs;
- existing state is read but never cleared or changed by tracing;
- all required stages and outgoing text are retained for a target message;
- unrelated message hashes are ignored;
- secrets, tokens, cookies, database URLs, PII-like fields and source text cannot reach persistence or API output;
- Planner/Reducer/Resolver/FinalDecision outputs are unchanged with diagnostics on versus off;
- trace persistence survives provider restart and expires after 72 hours;
- the read endpoint requires existing admin authentication and property scope;
- real LINE transport still uses `finalResponse.shouldReply` and `finalResponse.replyText` as its only authority.

## Deployment and acceptance

Run targeted RED/GREEN tests, the full test suite, integrity verification, migration ordering checks, `git diff --check`, and a sensitive-data scan. Commit and push normally, require GitHub Actions success, and deploy only to the existing test-only Render service. Confirm health and the diagnostic endpoint readiness without sending a LINE message or clearing state. The user will then send the same question once from each real account; root-cause comparison is a later read-only task.
