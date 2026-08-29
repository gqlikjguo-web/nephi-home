# New Core Luna Model Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gpt-5.6-luna` the sole non-overridable model for new-core provider, Shadow, and REAL_OPENAI Task 14, with response-envelope identity proof.

**Architecture:** A new `lib/new-core/openai-model-authority.js` owns the only model constant and exact identity check. The new-core provider imports it, refuses caller model fields, validates the response envelope model, and safely extracts one structured message alongside bounded reasoning items. Shadow and Task 14 accept credentials but never model configuration.

**Tech Stack:** Node.js/CommonJS, OpenAI Responses API structured outputs, repository runner scripts.

**Spec:** `docs/superpowers/specs/2026-08-29-new-core-luna-model-authority-design.md`

## Global Constraints

- Modify only new-core model authority, new-core OpenAI provider, read-only Shadow boundary, their tests, Task 14 runner, safe metadata, and necessary package scripts.
- Do not modify legacy/test-only providers, production composition root, Resolver, PostgreSQL, Temporal, state, FinalDecision, FinalResponse, LINE, protected expectations, or Task 15.
- Do not push or deploy.
- Run REAL_OPENAI only after local GREEN; only accepted calls with requested and resolved model both equal to `gpt-5.6-luna` count.

---

### Task 1: Prove current override paths RED

**Files:**
- Create: `tests/new-core-luna-model-authority-runner.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: current provider and Shadow public interfaces plus Task 14 runner source.
- Produces: a structured contract runner that fails while caller-selected models remain possible.

- [ ] Write assertions that require `NEW_CORE_OPENAI_MODEL === "gpt-5.6-luna"`, reject an `options.model` own field, reject `providerConfig.model`, require Task 14 source to omit `OPENAI_MODEL`, and require provider diagnostics to expose requested/resolved identity.
- [ ] Add fake Responses envelopes for Luna reasoning plus one message, multiple messages, reasoning-only, refusal, and mismatched response model.
- [ ] Run `node tests/new-core-luna-model-authority-runner.js`; expect failure because the authority module and identity gate do not exist.
- [ ] Preserve RED output and confirm existing source search still finds direct `gpt-4.1-mini` injection in new-core tests.

### Task 2: Implement authority and provider identity/extraction gate

**Files:**
- Create: `lib/new-core/openai-model-authority.js`
- Modify: `lib/providers/openai-understanding-v1.js`
- Modify: `tests/new-core-openai-adapter-contract-runner.js`
- Modify: `tests/new-core-luna-model-authority-runner.js`

**Interfaces:**
- Produces: `NEW_CORE_OPENAI_MODEL`, `assertNewCoreOpenAiModelIdentity(requestedModel, resolvedModel)`.
- Changes: `callOpenAIUnderstandingV1(input, options)` accepts credential/transport controls but rejects own `model`; provider request always uses Luna; result/provider failure diagnostic records both identities.

- [ ] Implement the immutable Luna constant and exact mismatch error code `MODEL_IDENTITY_MISMATCH`.
- [ ] Remove provider model resolution from options and build every request with the authority constant.
- [ ] Validate `payload.model` before semantic output acceptance and attach requested/resolved identity to provider attempt diagnostics.
- [ ] Permit bounded reasoning items only when exactly one completed message has exactly one non-empty `output_text`; reject reasoning-only, multiple message, refusal, and unexpected item types.
- [ ] Run `node tests/new-core-luna-model-authority-runner.js` and `node tests/new-core-openai-adapter-contract-runner.js`; expect PASS.

### Task 3: Remove Shadow model authority

**Files:**
- Modify: `lib/new-core/shadow-core.js`
- Modify: `tests/new-core-shadow-isolation-runner.js`

**Interfaces:**
- Changes: `providerConfig` has exactly `apiKey`; model-like fields fail closed and the provider receives no model.

- [ ] Update Shadow contract assertions first so current `{apiKey, model}` calls fail RED.
- [ ] Change the closed provider config projection to one credential field and remove model forwarding.
- [ ] Update new-core Shadow test inputs to use the credential-only shape; retain explicit negative tests proving a model field is rejected.
- [ ] Run Shadow isolation; require all six counters zero and property-scoped records unchanged.

### Task 4: Build Luna-only Task 14 runner

**Files:**
- Create: `scripts/run-new-core-openai-shadow-acceptance.js`
- Create: `tests/new-core-openai-shadow-acceptance-contract-runner.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `OPENAI_TEST_API_KEY` only, exact eight approved inputs, Task 11 provider, Task 12 pure Shadow assembler.
- Produces: private `/tmp` per-run evidence and safe model/shape/human-review summaries.

- [ ] Write runner contract RED requiring no model env/default/flag, minimum five accepted Luna identities per case, exact same context for AC-PRD-004/005, identity mismatch exclusion, safe variance distribution, zero side effects, and four failure classifications.
- [ ] Implement sequential calls with adaptive five-run extension on shape variance; never retry semantic outcomes or choose a different model.
- [ ] Record required per-run fields, including provider candidate meaning and controlled-core action, without committing raw provider artifacts.
- [ ] Produce per-case human review fields and distinguish `OPENAI_UNDERSTANDING_ERROR`, `CONTRACT_TOO_NARROW`, `MODEL_IDENTITY_MISMATCH`, and `OTHER_RUNTIME_FAILURE` at the earliest boundary.
- [ ] Run the Task 14 contract runner; expect PASS at `STRUCTURED_CONTRACT_TEST` level without any provider call.

### Task 5: Local GREEN and affected regression

**Files:**
- No new files.

**Interfaces:**
- Verifies all modified and protected boundaries.

- [ ] Run new model authority, provider, Shadow, Task 14 contract, C01-C11, maintainability, observability, deterministic acceptance, protected acceptance, integrity, and the recorded affected-regression runner set.
- [ ] Search new-core provider/Shadow/Task 14 source for forbidden model strings and model inputs; allow `gpt-4.1-mini` only in explicit negative assertions proving rejection.
- [ ] Run `git diff --check` and verify excluded production/legacy paths have no diff.
- [ ] On any prior product PASS regression, restore this phase and stop without a second production patch.

### Task 6: Run Luna-only REAL_OPENAI Task 14

**Files:**
- Generate: private evidence under `/tmp` only.
- Create or modify: safe metadata only if all gates pass.

**Interfaces:**
- Produces: at least 40 accepted runs with exact requested/resolved Luna identity, per-case distributions, C11/C10 evidence, human review, side-effect and property-isolation proof.

- [ ] Execute the runner against the authorized test-only credential without supplying a model variable.
- [ ] Exclude identity mismatch and failed provider attempts from the accepted denominator while recording them honestly.
- [ ] Add five samples for every case with multiple semantic shapes and analyze every observed shape.
- [ ] Block Task 14 for unsafe meaning, route, context, property, or side-effect variance; do not modify controlled semantic contracts in this phase.

### Task 7: Verify, commit locally, and stop

**Files:**
- Commit only reviewed source, tests, plan, and safe metadata; exclude private artifacts.

**Interfaces:**
- Produces: one local commit and final Task 14 report; no push/deploy.

- [ ] Re-run targeted tests, full affected regression, `git diff --check`, and worktree mutation audit with fresh output.
- [ ] Commit locally only when verification supports it; otherwise report the exact blocker without a success commit.
- [ ] Confirm no production/deployment/push action occurred and stop before Task 15.
