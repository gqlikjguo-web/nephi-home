# Test-only Acceptance Data Determinism Design

## Goal

Before any protected real OpenAI acceptance request, make the deployed test-only PostgreSQL facts for the acceptance property exactly match the repository-approved snapshot. A mismatch, ambiguous canonical source, unauthorized environment, or failed post-write verification blocks the matrix with `INTEGRITY_FAILURE`.

## Scope

This design is limited to the Render test-only environment, the configured acceptance property, and its official test data. It does not change generic `seedPostgres()` update behavior, production customer data semantics, Planner, semantic compiler/validators, Canonicalizer, Resolver, FinalDecision, FinalResponse, acceptance cases, or date fixtures.

The synchronized data domain is:

- property display name and exact property settings JSON;
- room identity, name, capacity, type, description, enabled state, and neutral structured pricing/presentation fields not approved by the fixture;
- knowledge items and canonical knowledge keys;
- bundle offers, membership, capacity, enabled state, neutral structured pricing, and neutral unapproved entertainment metadata;
- room price overrides;
- normalized and legacy daily inventory for the exact fixture horizon.

LINE bindings, administrators, onboarding records, message logs, review records, and general conversation state are not part of this reset.

## Canonical snapshot

`fixtures/postgres-seed.json` remains the manifest entry point. `loadSeedManifest()` and `normalizeSeedInput()` produce the repository snapshot. The normalized snapshot has a stable SHA-256 hash over sorted JSON fields and includes the exact property ID, rooms, settings, FAQs, bundles/members, structured pricing state, availability dates, and inventory statuses.

Positive room or bundle pricing is answerable only when represented by approved structured data. The current manifest supplies no approved room structured prices and explicitly supplies bundle price `0`; the synchronized database therefore uses `0` as the existing resolver's unanswerable sentinel and deletes price overrides. This does not mean free or confirmed-no. The July prose price rule remains exact repository settings data, while effective room/bundle structured pricing remains `REQUIRES_OPERATOR_CONFIRMATION`.

Availability is authoritative only inside the 2026-07-14 through 2026-08-31 fixture horizon. The sync removes test-property availability outside that snapshot from active normalized and compatibility tables rather than preserving stale values.

Snapshot construction fails before database writes when property scope, identifiers, membership, dates, status values, uniqueness, or repository relationships conflict.

## Transactional synchronization

An explicit test-only synchronizer accepts:

- an explicit PostgreSQL/PGlite connection;
- `testOnly: true`;
- an exact configured acceptance property ID;
- the repository manifest path.

It opens one database transaction, locks the property row, replaces only the synchronized data domain, reads it back, compares it with the canonical snapshot, and commits only on an exact hash match. Any conflict or mismatch throws an integrity error and rolls back. It never deletes the property row, so unrelated test-only identities and transport/admin state remain intact.

## Protected deployed boundary

The existing GitHub Actions OIDC verifier protects a dedicated test-only acceptance-data initialization endpoint. The endpoint exists only when both `TEST_ONLY_ENVIRONMENT=true` and `TEST_ONLY_ACCEPTANCE_ENABLED=true`, only accepts the configured property, and only runs against PostgreSQL.

The deployed acceptance runner obtains its OIDC identity, invokes initialization, independently computes the repository snapshot hash from its checkout, and requires the endpoint's post-sync hash to match before issuing the first conversation-acceptance request. Any non-2xx response, scope error, hash mismatch, or incomplete verification becomes `INTEGRITY_FAILURE`; no OpenAI matrix case executes.

## Acceptance state isolation

Every matrix execution receives a fresh cryptographic run scope. Conversation IDs are derived from that run scope plus the case ID, and event IDs include fresh UUIDs. Tests inject deterministic UUID values and prove that two executions at the same commit cannot reuse conversation or message identity. Duplicate-event and explicit-clear acceptance cases reuse or clear only their own current-run identifiers.

Because isolation is proven, the official-data transaction preserves conversation and message tables. If the isolation contract fails, initialization must not compensate by clearing property-wide state.

## Verification

TDD first reproduces existing-property stale settings, rooms, bundles, knowledge, price overrides, and availability using PGlite. It also proves acceptance run IDs differ. The implementation then passes focused data-integrity, PostgreSQL provider, onboarding/property-isolation, protected acceptance, Codex integrity, and complete fresh `npm test` gates. No real OpenAI matrix is run in this task.
