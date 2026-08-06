# Deployed Acceptance Repair Provenance Design

## Goal

Make target-preflight attribution fail closed unless an opaque, bounded, per-turn correlation ID directly joins the responsible repair provenance to canonical trace evidence that satisfies the turn's existing expected capability or semantic subject.

## Scope

- Add diagnostic-only opaque correlation IDs for coverage repair, task-collection repair, and semantic repair.
- Carry those IDs through the engine and both safe trace projections without exposing the Planner task ID.
- Join repair provenance to canonical trace evidence in `validateTargetPreflightAttribution`.
- Add RED/GREEN coverage for missing, unrelated, duplicate, unknown, conflicting, and ambiguous IDs.
- Preserve all Planner understanding, coverage behavior, product responses, formal CanonicalRequest objects, fixture expectations, acceptance matrices, and `PRODUCT_BASELINE.md` byte-for-byte.
- Do not deploy or operate Render, LINE, OpenAI, PostgreSQL, or other external providers.

## Diagnostic Data Model

The Planner and semantic compiler may continue using their existing task IDs internally. Those values are never copied into the new safe provenance projection because current task IDs may contain semantic or entity text.

For each repaired or repair-preserved task, the diagnostic boundary creates a UUID v4 correlation ID. The private in-process link contains the internal task ID, repair kind, and correlation ID. Safe Planner or validation traces expose only:

```js
{
  repairProvenance: [
    { kind: "coverage_repair", correlationId: "opaque-uuid-v4" }
  ]
}
```

The canonical trace payload is a diagnostic copy, not the formal CanonicalRequest. It may add the matching opaque value:

```js
{
  repairCorrelationId: "opaque-uuid-v4",
  capability: "...",
  canonicalEntity: { category: "...", canonicalId: "..." }
}
```

Correlation IDs are limited to a strict UUID v4 shape. Repair kinds use a fixed bounded allowlist. A turn may emit at most 24 repair provenance entries. No correlation value is derived from guest text, property identity, inventory, canonical subjects, prompts, provider payloads, or credentials.

## Data Flow

1. Provider repair code records the internal task IDs affected by coverage repair, deterministic date-clarification repair, or task-collection repair in non-enumerable diagnostics. This records behavior that already occurred and does not change task creation or Planner decisions.
2. Provider success annotation assigns a fresh opaque correlation ID to each affected internal task.
3. The engine reads the private task-to-correlation links. Its Planner trace emits only safe repair kind/correlation pairs.
4. After semantic contract repair, the engine independently assigns opaque IDs to repaired task IDs and emits only safe semantic repair provenance.
5. When building the canonical trace payload, the engine uses the internal task ID only in memory to attach the matching opaque correlation ID to the diagnostic copy. The formal CanonicalRequest remains unchanged.
6. Server and persisted safe-trace projections preserve only allowlisted repair kinds, strict opaque IDs, existing necessary counts/booleans, and canonical diagnostic evidence.
7. The deployed acceptance validator performs a one-to-one join from repair provenance to canonical evidence by exact correlation ID.

## Fail-Closed Attribution Rules

Attribution fails when any of these conditions occurs:

- repair provenance is absent;
- a repair correlation has no canonical match;
- a canonical repair correlation is unknown;
- a correlation ID is duplicated in provenance or canonical evidence;
- one correlation maps to multiple canonical items;
- one canonical item claims conflicting repair correlations;
- a correlation ID or repair kind is malformed or out of bounds;
- the joined canonical item does not satisfy an existing expected capability or semantic subject;
- unrelated repair provenance exists while the expected canonical target comes from a different un-repaired task.

`rg-023` follows the same rule: `semanticValidation.repairedTasks` remains internal evidence, while a semantic-repair correlation joins the repaired pool task to its canonical pool evidence.

## Privacy

Safe traces must not contain guest message text, Planner source text, property IDs in the new provenance objects, internal inventory IDs in provenance, semantic Planner task IDs, prompts, raw provider JSON, or credentials. Canonical IDs remain only in the pre-existing canonical evidence projection; they are never encoded into or copied into a provenance correlation ID.

## Verification

TDD begins with contract failures for all required negative and positive cases. Focused verification covers the deployed acceptance contract, Planner/semantic diagnostics, engine flow, server and persisted safe traces, privacy, and unchanged product behavior. Completion additionally requires the complete `npm test`, repository integrity and protected acceptance gates, `git diff --check`, an independent Reviewer Ready verdict with no Critical or Important finding, one root-cause commit, and a non-force push only to `origin/test-only/node-pilot-integration`.
