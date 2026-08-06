# JunZan AI 後續工作狀態

## 目前狀態

- 本次 Codex 執行完整性規則制定工作已完成。
- Checkpoint A、Checkpoint B 與 Checkpoint C 均不再列為目前任務。
- 本文件不新增其他工作、產品功能或自動執行項目。

## 未授權的未來候選

- Checkpoint B 與 Checkpoint C 僅保留在已核准的設計文件與 [implementation plan](superpowers/plans/2026-08-03-codex-execution-integrity-implementation-plan.md) 中，作為未來候選方案。
- 兩個 Checkpoint 目前都未獲授權，不得由 Codex、CI、文件狀態或先前核准內容自動啟動。
- 未來如需修改 runtime、LINE、provider、legacy route、fallback、dead code、canonical／uniqueness Gate 或其他旁路，必須由使用者另外建立並明確批准一個獨立任務。
- 新任務必須重新確認範圍、驗收標準及允許的外部操作；不得把本次規則制定完成視為 runtime 或部署變更授權。

## 非目前任務的已知限制

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

此限制與其他未證明的 runtime／外部狀態記錄在 [PROJECT_MEMORY](PROJECT_MEMORY.md)。它們不是本次收尾工作的自動待辦，也不得被誤標為已完成。

## 2026-08-04 deployed acceptance follow-up

1. Independently review the local deployed-acceptance closure commit and complete diff.
2. After explicit authorization, push and integrate it into `test-only/node-pilot-integration` without rewriting history.
3. Require normal test-only CI, Render deployment of the exact commit, and the new OIDC-authenticated deployed conversation matrix to succeed before any real LINE acceptance.

## 2026-08-05 active release-closure sequence

1. Finish complete local verification for merged-unknown catalog task isolation, then create the next traceable commit and non-force push it to `test-only/node-pilot-integration`.
2. Require exact-commit Render health, GitHub Actions OIDC, real OpenAI + PostgreSQL deployed acceptance, the private artifact, `rg-015` recovery, and no regression from the current 64 PASS cases.
3. After that root is stable, continue from deployed evidence in order: date/CanonicalRequest failures (`rg-003`, `rg-006`, `rg-013`), multi-task price and room-scope preservation (`rg-037`, `rg-038`, `rg-039`), then controlled operator-context scope (`rgs-019`, `rgs-020`).

## 2026-08-05 regression closure after run 30976898838

1. Deploy the substantive-acknowledgement relation preservation repair and require `rg-052` to return a controlled handoff instead of no-reply.
2. Re-run all existing no-reply cases and the complete deployed matrix; retain no regression from the prior 64-PASS baseline.
3. Continue the remaining real-Planner drift one contract at a time: `rg-032`, `rg-051`, `rgs-007`, and `rgs-017`, then the pre-existing date, room-scope, and operator-context failures.

## 2026-08-05 catalog category authority

1. Complete verification and deploy the repair that lets an exact formal property-catalog category correct an incompatible Planner task type for non-general detail requests.
2. Require `rgs-010` and the existing `rgs-015` pet-policy control to pass without loss of formal facts, then rerun the complete deployed matrix.
3. Continue from stable failures in attempt 2: `rg-001`, date projection and parsing (`rg-003`, `rg-006`, `rg-013`), multi-turn task preservation (`rg-038`, `rg-039`), sensitive access routing (`rg-051`), and operator-context scope (`rgs-019`, `rgs-020`).

## 2026-08-05 safe temporal evidence projection

1. Preserve the controlled CanonicalRequest `expressionType` and `repairReasonCode` in the allowlisted deployed safe trace, without exposing Planner text, raw date candidates, or temporal provenance.
2. Re-run the trace privacy contract, deployed acceptance contract, all local gates, exact-commit Render deployment, and the complete real OpenAI + PostgreSQL matrix.
3. Expect the projection repair to remove the false `expected_date_range_missing` result where a controlled `past_date/date_range` already exists. Keep any later FinalDecision or parsing failure, especially `rg-013`, visible as a separate root.

## 2026-08-05 duplicate Planner task-ID normalization

1. Normalize repeated IDs only when every task in that duplicate group is a stateless property-catalog task, while preserving type, candidate index, evidence, relation, and task count.
2. Keep duplicate IDs on availability, price, capacity, and other stateful tasks invalid because they identify request cycles; retain the existing multi-cycle rejection control.
3. Deploy and require the real `rg-036` shape to retain all three tasks without `planner_schema_invalid`, while rerunning the complete matrix and all prior PASS cases.

## 2026-08-05 pure Unicode punctuation normalization

1. Reproduce the deployed `rg-049` shape in which a pure punctuation source produced an invalid unknown candidate and `planner_schema_invalid` handoff.
2. After OpenAI, normalize punctuation/symbol-only source events to one valid unknown no-reply contract using Unicode categories; discard unsupported task, stay, relation, and state claims.
3. Prove that letters or numbers remain Planner-controlled, rerun prior acknowledgement/no-reply and multi-cycle PASS cases, then deploy the complete matrix without per-case retries.

## 2026-08-05 bounded OpenAI Planner timeout

1. Preserve the existing maximum of two provider attempts and the existing timeout/network/rate-limit/provider-5xx retry categories.
2. Raise only the live test-only Planner attempt timeout from 15 to 30 seconds, retaining safe per-attempt diagnostics and a finite round deadline.
3. Deploy and require `rg-009` plus turn 1 of `rgs-020` to complete the real OpenAI semantic path, while rerunning every prior PASS case and the complete matrix without case retries.

## 2026-08-05 source-grounded temporal recovery

1. Recover only unique deterministic date ranges or durations from verified task source; allow full-message recovery only for the sole stay-dependent task in the turn.
2. Require `rg-013` and `rgs-017` to reach the intended controlled temporal state in real OpenAI + PostgreSQL deployment, while rerunning multi-cycle, mixed property-fact, invalid-date, ambiguity, and all prior PASS cases.
3. Keep `rgs-019` and the first turn of `rgs-020` as visible specification conflicts while their fixture dates are in the past; do not change expected values, formal data, or past-date policy without explicit user approval. Continue next with the earliest deployed layer for `rg-038`, `rg-039`, and `rg-051`.

## 2026-08-06 month-qualified weekday recovery

1. Finish the explicit protected-acceptance, Codex-integrity, Constitution, runtime-uniqueness, and diff gates for the shared Temporal Resolver repair, then create one root-cause commit and push it to `test-only/node-pilot-integration` without force.
2. Require GitHub Actions success, exact-commit Render health with `testOnly=true`, a verified private artifact, and the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix. `rg-038` must keep dates unresolved, execute no availability query, and ask for an exact date; all prior PASS turns must remain PASS.
3. If the Release Gate is still unmet, continue from the new artifact's earliest common failure layer without changing expected values, past-date policy, non-executable scope, or acceptance thresholds. Real LINE final acceptance remains blocked until the test-only Release Gate passes.

## 2026-08-06 contradictory Planner capability preservation

1. Run the explicit protected-acceptance, Codex-integrity, Constitution, runtime-uniqueness, canonical-golden, and diff gates for the compiler repair, then create one root-cause commit and non-force push it to `test-only/node-pilot-integration`.
2. Require exact-commit Render health and the complete real OpenAI + PostgreSQL matrix. Compare every case and turn against artifact `8942265827`; `rg-028`, `rg-032`, `rg-037`, and `rgs-008` must not be hidden by net score, and any new prior-PASS regression must be located before continuing.
3. If the Release Gate is still unmet, continue from the newest artifact's earliest common failure layer. Keep `rg-038`'s temporal fail-closed behavior, all past-date and multi-cycle boundaries, unchanged expected values, and all non-executable cases visible; do not begin real LINE final acceptance early.

## 2026-08-06 source-bound detail capability normalization

1. Local `npm test`, protected acceptance, Codex integrity, Constitution, runtime uniqueness, canonical golden, and `git diff --check` have passed. Create one root-cause commit and non-force push to `test-only/node-pilot-integration`.
2. Require exact-commit Render health, a verified private artifact, and the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix. `rg-001`, `rg-028`, and `rg-032` must individually return to PASS; compare every prior PASS case and turn against artifacts `8943541801`, `8942265827`, and `8937651304`.
3. Preserve `rg-038`'s null temporal state and zero availability QueryPlan. If Release Gate remains unmet, continue with the new artifact's earliest shared failure layer, including the separate date-clarification task boundary, sensitive-access routing, and still-visible past-date/specification conflicts. Real LINE final acceptance remains blocked.

## 2026-08-06 unreferenced same-turn supplement recovery

1. Commit and non-force push the locally complete relation repair after final diff checks; local targeted tests, complete `npm test`, protected acceptance, Codex integrity, Constitution, runtime uniqueness, and canonical golden have passed.
2. Require exact-commit Render health, a verified private artifact, and the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix. `rg-014` must recover without changing any valid continuation or multi-cycle relation, and every prior PASS case and turn must be compared against artifact `8944853419`.
3. Keep `rg-037` and `rgs-020` visible as prior-PASS regressions and treat `rg-028` as an incomplete apparent PASS until the formal 08:00-22:00 answer is actually grounded. Preserve `rg-038`'s null dates and zero QueryPlan, then continue from the next earliest shared failure layer without changing expected values or past-date policy.

## 2026-08-06 minimum-variance Planner sampling

1. Create one root-cause commit for `temperature: 0` plus its request-body RED/GREEN and non-force push it after final diff checks; complete local `npm test` and all explicit safety gates have passed.
2. Require exact-commit Render health, a verified private artifact, and the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix. Compare every case and turn against artifacts `8945791121`, `8944853419`, and `8943541801`; `rg-032` and `rgs-007` must not be hidden by net score.
3. Lower sampling variance is not a Release Gate by itself. Require the formal 08:00-22:00 `rg-028` answer, preserve `rg-038`'s null dates and zero QueryPlan, keep `rgs-020` and all past-date conflicts visible, and continue with deterministic shared compiler boundaries if any capability drift remains.

## 2026-08-06 sampling rollback and next shared boundary

1. Roll back the explicit Planner sampling override because artifact `8946684391` regressed prior-PASS `rg-001`, `rg-006`, and `rg-037`; run complete local verification, create one rollback commit, and non-force push it.
2. Keep the rollback deployment separate and verify its exact SHA, private artifact digest, and complete 77-case / 90-turn matrix. Do not claim recovery from net score: compare every prior-PASS case and turn against artifact `8945791121`.
3. Continue with the earliest deterministic shared failure layer using verified current-source evidence. Preserve temporal fail-closed behavior, especially `rg-038` null dates and zero QueryPlans, and require actual formal answers rather than apparent acceptance PASS states.

## 2026-08-06 verified task-source time-detail grounding

1. Complete local verification for the narrow time-detail source grounding, create one root-cause commit, and non-force push it. General source scanning and all ambiguity, price, temporal, and multi-cycle safety boundaries must remain green.
2. Require exact-commit Render health, verified private artifact digest, and the complete 77-case / 90-turn matrix. `rg-028` must return the formal 08:00-22:00 answer without altering the independent soundproofing handoff or regressing any prior PASS case.
3. Keep `rg-001`, `rg-037`, `rg-032`, `rgs-007`, `rg-038`, `rg-039`, `rg-051`, `rgs-019`, and `rgs-020` visible as separate unresolved layers, then continue from the earliest deterministic shared boundary.

## 2026-08-06 structured Planner price grammar

1. Run protected acceptance, Codex integrity, Constitution, runtime uniqueness, canonical golden, and `git diff --check`; then create one root-cause commit for the shared price-versus-policy generation contract and non-force push it to `test-only/node-pilot-integration`.
2. Require exact-commit GitHub Actions success, Render `ready` with `testOnly=true`, a verified private artifact digest, and the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix. `rgs-007` must expose canonical `price`, retain missing-date clarification, create no premature availability query, and return no invented amount; compare every prior PASS case and turn against artifact `8948576835`.
3. If Release Gate remains unmet, continue from the new artifact's earliest failure layer. Keep `rg-038`'s unresolved dates and zero availability QueryPlan, `rg-039`'s past-date rejection, and `rgs-019` / `rgs-020` scope conflicts visible; do not begin real LINE acceptance early.

## 2026-08-06 structured Planner regression repair

1. Run all explicit safety gates, create one regression-repair commit, and non-force push it. Do not retain artifact `8949414624` as progress while `rg-051` or `rgs-009` is regressed.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, verified private artifact digest, and the complete 77-case / 90-turn matrix. `rgs-007` and `rgs-009` must both be canonical price clarifications with zero premature QueryPlans, while `rg-051` must remain a high-risk human handoff. Compare every prior PASS turn against artifact `8948576835`.
3. If no prior PASS regresses and Release Gate remains unmet, continue from the newest earliest failure layer among `rg-038`, `rg-039`, `rgs-019`, and `rgs-020`; retain all temporal and past-date safety and do not enter real LINE acceptance early.

## 2026-08-06 lodging-arrangement capability regression repair

1. Create one root-cause commit for the shared lodging-arrangement / booking-process structured grammar and non-force push it; local targeted tests, complete `npm test`, protected acceptance, Codex integrity, Constitution, runtime uniqueness, and diff checks pass.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, verified private artifact digest, and the complete 77-case / 90-turn matrix. `rgs-017` must retain canonical `duration_only` with two nights and expose `booking_request` or another accepted booking capability without an availability query; every prior PASS turn must be compared against artifact `8950072765` and stable artifact `8948576835`.
3. If no prior PASS regresses and Release Gate remains unmet, continue from the newest earliest failure layer among `rg-038`, `rg-039`, `rgs-019`, and `rgs-020`. Preserve month-plus-weekday fail-closed behavior, past-date rejection, multi-cycle authority, unchanged expected values, and the real-LINE block.

## 2026-08-06 lodging-arrangement grammar rollback

1. Complete local verification of the exact code rollback, create one rollback commit that retains artifact `8950851806` evidence, and non-force push it. Do not retain the isolated `rgs-017` improvement while any prior PASS or past-date behavior regresses.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, private artifact digest verification, and the complete 77-case / 90-turn matrix. All prior PASS cases and turns from artifact `8950072765` must recover before proceeding.
3. After rollback stability is proved, repair `rgs-017` only through deterministic verified-source compiler evidence with explicit non-lodging, property, high-risk, context, ambiguity, and past-date negative controls. Real LINE final acceptance remains blocked.

## 2026-08-06 stateful catalog-isolation rollback

1. Verify runtime and tests are byte-equivalent to commit `32ff2fe1bf7ee80f444fa595ee7e2eb43ce627a1`, run the complete local suite and safety gates, create one rollback commit retaining run `31062128940` evidence, and non-force push it.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, verified private artifact digest, and the complete 77-case / 90-turn matrix. Compare every prior-PASS turn against artifacts `8951474217` and `8950072765`; do not retain any apparent target recovery unless its deployed trace proves the responsible repair executed.
3. After rollback stability, continue from the newest earliest common failure layer. `rg-038`, `rg-039`, `rgs-017`, `rgs-019`, and `rgs-020` remain unresolved until complete deployed evidence proves otherwise; real LINE final acceptance remains blocked.

## 2026-08-06 duplicate-source formal authority

1. Run complete local tests and all safety gates for the same-canonical-ID property-source reconciliation; create one root-cause commit and non-force push it.
2. Require exact-SHA verify, Render `ready` with `testOnly=true`, verified private artifact digest, and complete 77-case / 90-turn acceptance. The target trace must expose a subject-compatible policy or amenity capability, remain property-catalog-only, and every prior-PASS turn from artifacts `8953248983`, `8951474217`, and `8950072765` must remain PASS.
3. If stable, continue from the next earliest shared Planner layer among `rg-036`, `rg-038`, `rgs-019`, and `rgs-020`; preserve temporal ambiguity and past-date fail-closed behavior and keep real LINE blocked.

## 2026-08-06 duplicate-source formal reconciliation rollback

1. Verify runtime and tests are byte-equivalent to `7f9edf2a4ef6c055cf4bda0a67b03b625abfc0de`, run the complete local suite and all safety gates, create one rollback commit retaining run `31066678489` evidence, and non-force push it.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, verified private artifact digest, and complete 77-case / 90-turn acceptance. All prior-PASS turns from artifacts `8953248983` and `8950072765` must recover before any new fix is retained.
3. Continue from the newest rollback artifact's earliest common failure layer. No future repair may count `rg-022` as recovered unless its deployed trace executes the responsible deterministic boundary; preserve temporal ambiguity, past-date, multi-cycle, and real-LINE safety gates.

## 2026-08-06 resolved lodging detail-scope preservation

1. Run the remaining lodging, policy, temporal, ambiguity, past-date, multi-cycle, complete `npm test`, and all safety gates; create one root-cause commit and non-force push it.
2. Require exact-SHA verify, Render `ready` with `testOnly=true`, verified private artifact digest, and complete 77-case / 90-turn acceptance. The `rg-006` target trace must contain `resolved_inventory_detail_scope_preservation`, retain the resolved room in CanonicalRequest and State, create no availability QueryPlan for a past date, and finish with explicit past-date clarification.
3. Compare every prior-PASS turn against artifacts `8954889733`, `8953248983`, and `8950072765`. If stable and Release Gate remains unmet, continue from the next earliest common failure layer; keep real LINE blocked.

## 2026-08-06 task-level Planner contract recovery

1. Run the fresh complete local suite, protected acceptance, Codex integrity, Constitution, runtime uniqueness, canonical golden, and `git diff --check`; retain the final Reviewer Ready verdict, then create one root-cause commit and non-force push it to `test-only/node-pilot-integration`.
2. Require exact-SHA GitHub verify and Render `ready` with `testOnly=true`. Run the exact 18 previously failing turns in `target_preflight`; every turn must PASS with executed repair attribution, expected canonical capability/subject, and no premature availability query.
3. Only after preflight succeeds, run the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix without case retries. Compare every prior-PASS turn against artifact `8962416807`; do not accept net-score improvement with any prior-PASS regression or target trace that bypasses the repair. If the Release Gate remains unmet, continue from the newest artifact's earliest common failure layer. Real LINE stays blocked.

## 2026-08-06 lodging coverage preflight continuation

1. Local closure is complete: independent Reviewer Ready, complete `npm test`, protected acceptance, Codex integrity, Constitution, runtime uniqueness, canonical golden, and diff checks all pass on final bytes. Create one common-root commit and non-force push it to `test-only/node-pilot-integration`.
2. Require exact-SHA GitHub verify, Render `ready` with `testOnly=true`, and a verified private artifact for the exact 18-turn `target_preflight`. All 18 turns must PASS; `rg-037` must retain pool plus price, `rg-038` must retain room price plus a non-querying date clarification, `rgs-019` must retain the uniquely eligible whole-property bundle, and `rgs-020` must retain its stated room number. Every non-`rg-023` target turn must expose bounded repair attribution through the safe trace.
3. Only after the attributed preflight succeeds, run the complete 77-case / 90-turn real OpenAI + PostgreSQL matrix without retries. Reject any prior-PASS regression, unexpected availability query, target bypass, or unverified artifact. Update Product Baseline only after complete formal acceptance; real LINE remains blocked.
