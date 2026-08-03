# JunZan AI 未完成工作佇列

本文件只列尚未完成且有依賴順序的工作。當前事實與 blocker 見 [PROJECT_MEMORY](PROJECT_MEMORY.md)，權威與衝突處理見 [RULES_INDEX](RULES_INDEX.md)。

## 1. 目前已授權：Checkpoint A

1. 完成規則權威、兩層必讀入口、執行完整性契約及現況文件校正。
2. 完成 protected-acceptance 與 Integrity Gate 的 positive／negative／mutation assertions。
3. 在 package 與 workflow 只串接 A 已存在的 protection、integrity、canonical、uniqueness 與完整 suite；不得提前要求 provider fail-closed。
4. 比對 immutable acceptance、審查完整 A diff、建立本機 commit並回報證據後停止。

## 2. 等待使用者批准：Checkpoint B

必須依固定順序執行，不得挑容易部分或調換刪除前證據：

1. 重新證明 active runtime、exports、tests、shared-binding replacement 與 provider fallback 的全部引用。
2. 將所有 direct legacy webhook 測試遷移至 property-scoped shared binding，保留原 business assertions。
3. 只有在 active runtime 無必要引用、無必要 export／測試依賴、shared binding 唯一替代與 mutation 可阻止重現都成立後，才刪除 legacy route、handler、helper 與 return 後 dead runtime。
4. Provider selection fail closed：沒有非空 `databaseUrl` 且沒有合法明確 `postgresConnection` injection 時拋出 `DATABASE_URL_REQUIRED`；保留合法 PostgreSQL／PGlite connection injection，JSON 只由 isolated test 直接建立並注入。
5. 讓 canonical Gate 真正執行每個 child runner，並讓 uniqueness Gate 逐一執行全部批准 mutation。
6. 在 B 才把 provider Gate、isolated PostgreSQL service 與 health check 加入 package、Integrity 與 workflow；完成全部本機驗證、immutable 比對與 B 回報後停止。

## 3. 等待 B 回報後另行批准：Checkpoint C

1. 從精確 B HEAD 建立無既有 `node_modules` 的乾淨 worktree，執行 `npm ci` 與全部 Gate／suite。
2. 只有使用者明確批准 C 及外部動作後，才可 push 本分支、建立 draft PR 並等待相同 SHA 的 GitHub Actions。
3. 取得一次只限本核心封口工作、且 reviewer 未參與實作的獨立審查；blocking finding 必須回到 A/B 修正並重跑 C。
4. 不 merge、不部署，保留所有 `UNPROVEN` 與 deployment blocker。

## 4. 外部驗收與部署阻塞

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

仍需在本工作之外、取得逐次明確授權後完成：

- 將既有 test-only LINE Channel credentials 安全寫入目標 property binding，且不得在紀錄中暴露明文。
- 將 LINE Console webhook 遷移至 `/api/line/webhooks/<webhookKey>`。
- 以真實 test-only LINE 驗證 signature、唯一 property、reply/failure 與 revoked／unknown binding fail closed。
- 取得兩個真實使用者的目標訊息 trace 後才能判斷 dual-user incident 的首個分歧層；不得用 replay 或 simulated webhook 代替。
- 建立正式切換回退點；正式 LINE、Render、正式 PostgreSQL、credentials 與正式資料只有使用者另行明確授權才可操作。

上述任一項都不能由 fixture、mock、PGlite、local HTTP、文件聲明或本機 PASS marker宣稱為完成。
