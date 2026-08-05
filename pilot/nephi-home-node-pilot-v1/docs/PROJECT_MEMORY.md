# JunZan AI 目前專案事實

本文件只記錄目前可由 Repository、Git 歷史與已執行命令核對的狀態。規則權威與優先順序以 [RULES_INDEX](RULES_INDEX.md) 為準；未完成工作是否已獲授權以使用者當次明確指示為準。

## Codex 執行完整性規則狀態

- Codex 執行完整性規則的制定與 Checkpoint A 已完成。
- 規則分支為 `codex/execution-integrity-rules`，且已 push 至 GitHub。
- 規則包含兩層 `AGENTS.md` 必讀入口、`RULES_INDEX.md`、執行完整性契約、acceptance protection Gate、integrity Gate、CI 執行入口及必要的狀態文件校正。
- Checkpoint B 與 Checkpoint C 未獲授權，不是目前工作；不得因其存在於規格或 implementation plan 而自動執行。

## 尚未完成或尚未證明

- Legacy `/api/test-line/webhook` route、相關 handler／helper 與 `return` 後 dead runtime 尚未在本次規則制定工作中修正或刪除。
- Production provider factory 的 JSON fallback 與 provider fail-closed 尚未在本次規則制定工作中修正。
- `REAL_LINE`、`REAL_POSTGRESQL_PROVIDER`、`REAL_RENDER_DEPLOYMENT` 與真實 OpenAI Planner 行為均沒有由本次文件收尾新增外部驗收證據。
- GitHub 上的 workflow、CODEOWNERS 或 branch protection 實際強制結果，不得僅由本機 Gate 或檔案存在推定為已完成外部驗收。

## 部署阻塞

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

在另行授權並完成 test-only LINE binding 遷移與真實驗收前，不得宣稱 LINE 已可直接切換或部署阻塞已解除。

## 證據原則

- 本機 Gate exit 0 只證明 Gate 實際檢查的 Repository 不變量，不等於真實 provider 或正式部署成功。
- 沒有可獨立核對的 assertion、exit code、commit、push或 runtime／外部證據時，必須標示 `UNPROVEN` 或精確 blocker，不得宣稱完成。

## 2026-08-04 deployed acceptance checkpoint

- The secure post-deployment test-only conversation acceptance channel is implemented and fully verified locally on `codex/deployed-acceptance-closure-20260804`.
- The route is dual-gated, preserves platform-admin access, and adds commit-bound GitHub Actions OIDC with safe FinalResponse and execution evidence.
- The deployed matrix has not been pushed, run in GitHub Actions, deployed, or executed against Render; independent review and later integration remain required.

## 2026-08-05 active first-version release closure

- `test-only/node-pilot-integration` is deployed at `7ddf5bd69d7b634690c136f7f3bf56fa068b7065`; Render health is `ready`, `testOnly=true`, and reports that exact commit.
- GitHub Actions run `30972750105` passed the complete verify job. Its real OpenAI + PostgreSQL deployed matrix produced 64 PASS, 9 FAIL, and 4 non-executable cases across 77 cases / 90 turns (73 cases / 81 turns executable).
- The remaining FAIL case IDs are `rg-003`, `rg-006`, `rg-013`, `rg-015`, `rg-037`, `rg-038`, `rg-039`, `rgs-019`, and `rgs-020`. The private artifact is `8917333233`, digest `sha256:96ed55788c5d4d34bdb067f605c2091a45c928271d04feadf7151839450fff4f`.
- Exact current-event evidence normalization fixed the prior `rg-018` context-relation failure. The only prior-PASS regression was `rg-015`, where OpenAI merged the BBQ and ingredient-order questions into one unknown task; the active uncommitted repair isolates a verified property-catalog subtask while preserving the unknown remainder as fail-closed.

## 2026-08-05 deployed acceptance run 30976898838

- Commit `fdbcbe69121f70f501ae8c00e063990e0d480ae5` passed the complete GitHub Actions verify job and Render health reported that exact commit with `testOnly=true`.
- Real OpenAI + PostgreSQL acceptance produced 61 PASS, 12 FAIL, and 4 non-executable cases. The private artifact is `8918810222`, digest `sha256:b2d4ea025ec2acc07e114ec6c646f4a2c9bbafd4839baf7040461da7fdeeb93f`.
- `rg-015` and `rg-037` improved, but `rg-032`, `rg-051`, `rg-052`, `rgs-007`, and `rgs-017` regressed from the prior PASS set. Trace comparison shows those five runs did not execute merged-unknown catalog isolation; they are independent real-Planner contract drift and remain failures.
- The active repair targets `rg-052`: an acknowledgement-labeled Planner result whose task has a verified `new_request` relation must not be changed to no-reply by the contract compiler. Pure acknowledgement cases retain relation-uncertain task evidence, while Unicode-only punctuation remains covered by the separate deterministic non-substantive rule.
