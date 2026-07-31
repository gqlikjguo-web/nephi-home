# JunZan AI Codex Integrity Rules

These repository-wide rules apply to every Codex task. Read this file and each applicable descendant `AGENTS.md` before acting. Repository history, source, tests, and observed command output are the only project facts; do not rely on chat memory or invent missing evidence.

## Trust Boundaries and Evidence

Every claimed command, test, review, commit, push, deployment, or external action needs recorded evidence, including its exit code where applicable. Never present a fake, stubbed, fixture-only, memory-only, queued, or recorded result as a real provider result.

`INTEGRITY_FAILURE` means evidence is missing, verification is bypassed, a result is fabricated, an unauthorized repository history operation occurs, or a gate is weakened to manufacture GREEN. Stop and report the exact failure rather than converting it into success.

Do not alter or claim a real OpenAI, PostgreSQL, LINE, Render, credential, URL, identifier, API, production value, or external state without explicit authorization. Preserve existing valid rules and uncommitted work outside the assigned scope. Do not merge, rebase, cherry-pick, force-push, reset, stash, or overwrite another worktree without explicit authorization.

## Test Classification

Every verification result must state its level: `UNIT_TEST`, `STRUCTURED_CONTRACT_TEST`, `FAKE_INTEGRATION`, `RECORDED_REPRODUCTION`, `RUNTIME_COMPONENT_TEST`, `REAL_OPENAI_PLANNER`, `REAL_POSTGRESQL_PROVIDER`, `REAL_LINE`, or `REAL_RENDER_DEPLOYMENT`.

Do not call a GREEN result real when assertions, runner availability, exit code, source inputs, test doubles, PostgreSQL memory mode, queued Planner output, fixture replay, property scope, or execution authority were not independently verified. A fail, skip, timeout, unresolved assertion, missing runner, or invalid exit code is not success.

## Blocker Protocol

Use `BLOCKED` only after identifying the failed prerequisite, its evidence, the last safe action, the required authority or external change, and why no safe local progress remains. Use `PLATFORM_FORCED_INTERRUPTION` only when the execution platform itself interrupts the task. Do not hide either state behind a passing result.

## Integrity Gate Scope

`npm run verify:codex-integrity` verifies the repository's integrity rule file, package entry point, gate implementation, required local contract runners, skipped-test markers, forced-success exits, and embedded credential-like values. This gate does not run OpenAI, PostgreSQL, LINE, or Render providers; a zero exit code proves only the checked local invariants, not real-provider behavior or deployment success.

The gate must fail on invalid source conditions, use exit code 1 on failure, never force `process.exit(0)`, and print a clear PASS or `INTEGRITY_FAILURE` result. Any narrow allowlist must be explicit, local, justified, and independently verified.

## Completion Status

Use `IMPLEMENTED_LOCAL_VERIFIED` only after the exact worktree/branch/HEAD, diff, gate, relevant test output, commit hash, push result, and absence of unauthorized deployment or external operations are evidenced. Otherwise report the precise state: `PARTIALLY_IMPLEMENTED`, `BLOCKED`, `INTEGRITY_FAILURE`, or `PLATFORM_FORCED_INTERRUPTION`.

## Project-specific Rules

The JunZan AI rules for `pilot/nephi-home-node-pilot-v1` are in [its descendant AGENTS.md](pilot/nephi-home-node-pilot-v1/AGENTS.md) and apply in addition to these repository-wide rules.
