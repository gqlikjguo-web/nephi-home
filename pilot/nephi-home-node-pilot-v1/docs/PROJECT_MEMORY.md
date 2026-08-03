# JunZan AI 當前專案事實

本文件只保存目前已證明事實、已知限制、blocker 與交接上下文。權威、必讀順序及文件責任見 [RULES_INDEX](RULES_INDEX.md)；產品行為見 [PRODUCT_BASELINE](PRODUCT_BASELINE.md)；未完成工作見 [NEXT_TASKS](NEXT_TASKS.md)。歷史演進由 Git、[DECISIONS](DECISIONS.md)、`CHANGELOG_INTERNAL.md` 與 `LESSONS_LEARNED.md` 追溯，不在此重複。

## 當前工作

- Branch：`codex/execution-integrity-rules`。
- 基準：`5a7c018c4a409ec5b429fb191c1ad6ab84e47696`。
- 本輪固定順序：Checkpoint A 完成回報並等待批准 → Checkpoint B 完成回報並等待批准 → Checkpoint C 完成回報。
- 目前只授權 Checkpoint A；不得提前執行 B 的 runtime/provider 修改或 C 的 push、PR、CI 外部動作。

## 已證明的本機事實

- `RECORDED_REPRODUCTION`：本工作開始 HEAD `0735730f82161603f5f16f06a1a302b1e8d37826` 的完整 `npm.cmd test` 在安裝 lockfile 依賴後 exit 0。輸出包含 fixture、local HTTP 與 PGlite，因此不構成真實 LINE、正式 PostgreSQL 或正式部署證據。
- `STRUCTURED_CONTRACT_TEST`：protected-acceptance runner 對 valid、缺檔、改檔、Golden mutation、重複／glob／directory、自身 hash、bootstrap／update／skip／override、branch/SHA allowlist、forced success 與一般 unit test 新增執行 mutation cases。
- `STRUCTURED_CONTRACT_TEST`：Integrity runner 驗證兩層 `AGENTS.md` 的不同作用域連結、`RULES_INDEX.md`、十二項完整性契約、唯一 active authority 與既有 anti-skip／credential assertions。
- A0 source audit 仍命中 legacy `/api/test-line/webhook`、caller-controlled property handler、return 後 dead runtime 與 production JSON fallback。這些是 Checkpoint B 的已知 RED，不得在 A 宣稱已封閉。

## 已知限制與未證明外部狀態

- `UNPROVEN_REAL_LINE`：本輪沒有真實 LINE request、reply、signature、property identity 或雙使用者 trace 證據。
- `UNPROVEN_REAL_POSTGRESQL_PROVIDER`：本輪 PostgreSQL 類測試是 isolated PGlite／test service 等級，不是正式 PostgreSQL。
- `UNPROVEN_REAL_RENDER_DEPLOYMENT`：過去文件中的 test-only 部署、health 與 live service 敘述未在本輪以相同 commit、URL、時間與平台輸出重新核對。
- `UNPROVEN_GITHUB_BRANCH_PROTECTION`：`CODEOWNERS` 或 workflow 檔案存在不代表 GitHub 平台已強制 branch protection。
- 第一版、test-only LINE binding migration、正式 LINE 切換與正式驗收均不得由本機測試推論為完成。

## Blocker

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

解除條件由 [SECURITY](SECURITY.md) 與 [Codex 執行完整性契約](CODEX_EXECUTION_INTEGRITY_CONTRACT.md) 定義。本輪不得讀寫 credentials、操作 LINE Console、Render 或正式資料庫，也不得以 fixture／local HTTP／isolated database 取代真實遷移與驗收。

## 交接原則

- 只根據 repository、Git object、實際 diff 與當次命令輸出陳述事實。
- 任一完成聲明缺少 assertion、分類、exit code、commit 或 runtime 證據時標示 `UNPROVEN`。
- 權威衝突、immutable acceptance 差異或必要 Gate 失敗時停止並回報，不改考卷、不跳過困難部分。
