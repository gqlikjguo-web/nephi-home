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
