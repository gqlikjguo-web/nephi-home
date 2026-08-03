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
