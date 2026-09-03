# New Core Luna Model Authority Design

**Date:** 2026-08-29

**Scope:** JunZan AI new-core OpenAI understanding provider, read-only Shadow, and REAL_OPENAI acceptance only. Production legacy-core model selection is excluded.

## Goal

Make `gpt-5.6-luna` the sole model authority for every new-core OpenAI request. A caller, environment variable, test runner, or Shadow configuration must not select another model or silently fall back when Luna is unavailable.

## Root Cause

The current new-core provider accepts an arbitrary `options.model`. Shadow accepts a second arbitrary `providerConfig.model` and forwards it. Task 14 can construct that value from shell environment overrides, while multiple new-core tests explicitly inject `gpt-4.1-mini`. Model identity therefore belongs to the last caller rather than one new-core authority. The historical Task 14 run demonstrated the consequence: 41 calls used Luna and 71 used `gpt-4.1-mini`.

The new core has no automatic fallback algorithm. The mixed run was caused by explicit caller and shell overrides, which are functionally equivalent to multiple authorities.

## Architecture

Create one small new-core model-authority module that exports the immutable model identifier `gpt-5.6-luna` and exact identity validation. The new-core provider imports this authority directly when building the OpenAI request. Its public call interface no longer accepts a model. Any model-like override supplied at the provider or Shadow boundary is rejected rather than ignored.

Shadow accepts only the credential needed to perform the provider request. It does not own, copy, default, or resolve a model. The Task 14 runner imports the same authority and has no model environment input, CLI flag, default, or fallback.

This authority is new-core-specific. Existing legacy/test-only planners, composers, classifiers, coverage critics, production composition roots, and their environment variables remain byte-for-byte outside the mutation scope.

## Model Identity Gate

Every real provider attempt records safe metadata:

- `requestedModel`: the authority value used in the request body.
- `resolvedModel`: the model identity returned by the OpenAI response envelope.

Before accepting structured output, the provider requires both values to equal `gpt-5.6-luna`. Missing or different response identity fails closed with `MODEL_IDENTITY_MISMATCH`. Such an attempt remains counted as a real provider attempt but cannot count toward Task 14 acceptance.

Luna may return a reasoning output item before its structured message. The response extractor may ignore bounded non-message reasoning items, but must still require exactly one completed message containing exactly one non-empty `output_text` part, reject refusals and unexpected output item types, and preserve the single-call/no-semantic-repair rule.

Luna transport, availability, schema, or identity failure is final except for the existing transport-category retry policy. A retry always requests Luna. No retry or error path may switch models.

## Task 14 Evidence

The prior mixed-model 112 calls remain historical evidence and are excluded from the Luna-only acceptance denominator. The new run starts from zero and includes a run only when its recorded requested and resolved identities both equal Luna.

Each of the eight approved cases receives at least five accepted Luna-only runs. Unsafe semantic variance adds samples. Each private run record includes the existing semantic/C10/C11/side-effect fields plus requested and resolved model identity.

Safe reporting includes per-case shape distribution and a concise human review:

`INPUT → OpenAI understanding → JunZan action → expected behavior → actual behavior → PASS/FAIL → plain-language reason`.

The report distinguishes:

- `CONTRACT_TOO_NARROW`: the OpenAI candidate meaning is product-correct and property-safe, but an equivalent representation is rejected by C03–C09.
- `OPENAI_UNDERSTANDING_ERROR`: the OpenAI candidate itself has the wrong purpose, capability, subject, context, temporal meaning, or reply intent.

Human review is a reporting projection of provider candidates and controlled-core outcomes. It does not become a second semantic authority, mutate runtime decisions, or convert a failed contract result into acceptance.

## Testing Strategy

RED first proves that the current provider, Shadow, and Task 14 configuration can accept `gpt-4.1-mini`.

GREEN proves:

- The provider request body can only contain Luna.
- Provider and Shadow model overrides fail closed.
- Requested/resolved identity mismatch returns `MODEL_IDENTITY_MISMATCH`.
- Luna response envelopes with a bounded reasoning item and one structured message are accepted.
- No model fallback exists in new-core source or Task 14 execution paths.
- Shadow retains six zero side-effect counters and property isolation.
- All deterministic acceptance and affected regressions remain green.

REAL_OPENAI execution occurs only after local gates pass. Raw provider artifacts remain outside Git. No production deployment, production model change, or Task 15 work is permitted.

## Mutation Boundary

Expected implementation scope:

- New model-authority module under `lib/new-core/`.
- New-core OpenAI provider.
- Read-only Shadow provider boundary.
- New-core provider/Shadow contract runners.
- Task 14 runner and safe metadata only.
- Package script entries strictly required to execute those runners.

Explicitly excluded:

- Legacy/test-only planner, composer, classifier, critic, or production model configuration.
- Resolver, PostgreSQL, Temporal, state, FinalDecision, FinalResponse, LINE, deployment, and Task 15 composition-root changes.
- Protected acceptance expectations or product behavior changes.

## Stop and Rollback

Stop and restore this phase if a previously passing product regression appears, the change requires modifying excluded legacy/production paths, any Shadow side effect becomes nonzero, property isolation fails, or Luna-only REAL_OPENAI results expose unsafe variance that the existing controlled contracts cannot safely absorb without a separately approved architecture change.
