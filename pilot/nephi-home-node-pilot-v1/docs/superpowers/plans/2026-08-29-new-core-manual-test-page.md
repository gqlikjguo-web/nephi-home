# New-Core Manual Test Page Implementation Plan

> **Scope:** local, admin-only, test-only orchestration for `nephi_home`; no deploy, push, production composition-root change, Contract change, prompt change, or ConversationStateV3 schema change.

## Exact allowlist

- `docs/superpowers/plans/2026-08-29-new-core-manual-test-page.md` (this plan)
- `lib/new-core/manual-test-service.js` (application orchestration, safe diagnostics, isolated state and side-effect guards)
- `lib/new-core/manual-test-repository.js` (test-only session/turn repository contract and memory implementation for isolated tests)
- `lib/providers/contracts.js` (test-only persistence methods only)
- `lib/providers/json-providers.js` (test-only repository delegation for local/contract tests)
- `lib/providers/postgres-providers.js` (test-only RPC delegation only)
- `lib/providers/postgres-worker.js` (test-only table queries only)
- `lib/json-repository.js` (test-only session/turn storage only)
- `migrations/025_new_core_test_sessions.sql` (new test-only tables; no existing table or state shape changes)
- `server.js` (admin-only page/API composition only)
- `public/admin-new-core-test.html`
- `public/assets/admin-new-core-test.css`
- `public/assets/admin-new-core-test.js`
- `tests/new-core-manual-test-page-runner.js`
- `tests/property-line-binding-postgres-webhook-runner.js` (migration-chain expectation only)
- `package.json` (targeted runner script only)

If implementation requires any file outside this allowlist or changes an existing core decision, Resolver semantic, production composition root, formal guest schema, or ConversationStateV3 persisted shape, stop.

## RED

1. Add a production-shaped HTTP/application contract runner that expects `/admin/new-core-test`, server-side `nephi_home` authorization, server-generated sessions, isolated multi-turn state, official final projections, manual review, trace lookup, safe diagnostics, and six zero side-effect counters.
2. Run it before implementation and retain the earliest failure showing the route/service is absent.

## Minimal implementation order

1. Add dedicated test session/turn persistence and new test-only tables.
2. Add a manual-test service that builds C01 input, calls the fixed Luna provider, runs C02–C09, applies the formal state-v3 adapter/reducer, executes C08 canonical requests through existing read-only Resolver components, and delegates finalization to existing ResponsePlan/Claim Validator/FinalDecision/FinalResponse.
3. Add fail-closed side-effect counters and explicit diagnostics allowlist/recursive denylist.
4. Add authenticated fixed-property HTTP routes and API.
5. Add the minimal chat/history/review UI.

## Targeted GREEN

- unauthenticated/unauthorized denial and fixed `nephi_home` scope
- server-generated test identity and no client state/model/property authority
- START+CLARIFY then CONTINUE through the same reducer-owned pending cycle
- ANSWER/CLARIFY/HANDOFF/NO_REPLY projections use official FinalResponse
- official Resolver read-only delegation and six counters remain zero
- new-conversation generation resets only test state
- review persistence, records filters, trace lookup ownership
- diagnostics allowlist and sensitive-field denial

Fake provider/isolated repository tests prove only contract integration. They do not claim REAL_OPENAI, deployed PostgreSQL, or deployment evidence.

## Affected regression and commit boundary

Run the targeted runner, new-core START+CLARIFY/state/context suites, C01–C11 affected suites, 298/298 deterministic acceptance, 48/48 Shadow, property isolation, FinalDecision/FinalResponse, protected/integrity/maintainability gates, existing affected-regression command, and `git diff --check`. Commit all allowlisted changes once, leave the worktree clean, and do not push or deploy.
