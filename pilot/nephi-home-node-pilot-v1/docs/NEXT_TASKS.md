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
