# Codex 執行完整性契約

本契約是 JunZan AI 專案 Codex 執行完整性的唯一領域權威。產品行為、Security、基線、決策、當前事實與待辦仍由 `RULES_INDEX.md` 指定的各自文件負責。

## 1. 禁止假資料冒充真實結果

Fixture、mock、stub、合成資料、recorded replay、PGlite、local HTTP 與 isolated CI database 只能證明明示的測試層級。不得稱為真實 LINE、正式 PostgreSQL、正式 OpenAI、Render 部署或 production runtime 證據；任何完成聲明必須揭露資料來源、double、執行權限與限制。

## 2. 核心驗收與 runtime 同路徑

一般 unit test 可隔離模組並明確分類。核心 acceptance、runtime component、signed webhook E2E 與真實 LINE 驗收必須使用正式 production entry point、provider selection、resolver、writer、`FinalDecision`、`FinalResponse` 與 transport。隔離 unit test 不得擴張宣稱為完整 runtime 證據，測試入口也不得複製第二套產品判斷。

## 3. 禁止寫死答案與特例旁路

禁止寫死答案、keyword/regex 特例、只為 Golden 案例成立的分支、legacy fallback、雙 runtime、第二 resolver、第二 writer、第二資料權威或任何繞過 production path 的捷徑。`createJsonProviders` 只能由 isolated test 直接建立並注入；production factory 不得因缺值自動 fallback。

Checkpoint B 的 provider fail-closed 必須保留合法、明確的 PostgreSQL／PGlite connection injection：`createProviders` 只有在既沒有非空 `databaseUrl`，也沒有明確注入合法 `postgresConnection` 時拋出 `DATABASE_URL_REQUIRED`；不得為了 fail closed 刪除 connection injection。

## 4. 驗收標準不可被改考卷

本次 A／B／C 中 Golden Matrix 的案例、分類、預期結果、Constitution 與既有核心 acceptance 必須與核准基準 byte-identical。不得修改、弱化、跳過、重新分類或改 runner 讓實作通過；發現錯誤或矛盾時立即停止並回報。

未來只有使用者事前明確批准的獨立「驗收標準變更任務」可建立新基準。該任務不得同時修改 runtime，必須獨立審查並保存新舊案例、分類、預期結果與 hash 對照；本工作不得留下 bootstrap、update、override 或 bypass。

## 5. 必須完整完成原始任務

逐條對照原始要求，包含困難、複雜與容易失敗的部分。不得只做容易部分、縮小需求、以相似功能替代、只測容易成功案例，或以「核心已完成」包裝部分完成。未完成項目必須逐項列出原因與證據。

## 6. 新路徑完成必須封閉舊旁路

新路徑完成時，被取代的 route、handler、fallback、dead code、第二 writer 與第二資料來源必須刪除或證明不可達。相容性保留必須先取得使用者明確批准，並由自動測試證明 runtime 不會使用；不得以註解、環境開關或 test mode 保存可復活旁路。

## 7. 完成聲明必須有可核對證據鏈

每項完成聲明必須能獨立核對：原始要求 → 修改檔案與函式 → production 呼叫鏈 → assertion → 測試分類 → stdout/stderr 與 exit code → commit/CI → 對應 runtime 證據。任何一段缺失都標示 `UNPROVEN`，不得推論為成功。每個命令同時記錄工作目錄、branch、HEAD 與是否使用外部資源。

## 8. 誠實 BLOCKED 與未完成

允許誠實回報 `BLOCKED`、`PARTIALLY_IMPLEMENTED` 或 `UNPROVEN`。`BLOCKED` 必須列出失敗前置條件、實際證據、最後安全動作、需要的權限或外部變更，以及為何無安全本機進展。禁止隱藏失敗、跳過失敗測試、偽造結果或把 queued／timeout／skip／neutral 當成成功。

## 9. 核心封口的獨立審查

本次 Codex 執行完整性核心封口必須由未負責實作的 reviewer 審查完整需求覆蓋、diff、immutable acceptance、旁路封閉、mutation 執行、證據分類與 deployment blocker。這項要求只限本次核心工作，不擴張為所有日常小修改的第二流程。

## 10. 最小必要流程

只建立會直接阻止作假、改考卷、旁路、第二權威或虛假完成的規則與 Gate。不得新增 approval platform、外部 audit service、大型 provenance／attestation 系統、第二套 issue 流程或與本次風險無直接關係的官僚程序。

## 11. 外部系統與部署授權

沒有使用者對特定外部動作的明確授權，不得 push、建立 PR、merge、部署或操作 Render、LINE Console、正式 PostgreSQL、credentials 與 production environment。測試或本機完成不能解除：

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

## 12. 權威衝突與停止條件

權威優先順序及唯一責任由 `RULES_INDEX.md` 指定。專案規則可比 repository 根層更嚴格但不得弱化其誠信底線；同層衝突、兩個 active authority、Golden／核心 acceptance 矛盾或無法驗證的必要證據，都必須停止並回報，不得自行採用較寬鬆解釋。

## 測試分類與證據邊界

- `UNIT_TEST`：隔離模組行為；可能使用直接注入的 test double，不能代表完整 runtime。
- `STRUCTURED_CONTRACT_TEST`：schema、靜態架構、Gate 與 mutation 契約；不能代表外部 provider。
- `FAKE_INTEGRATION`：fixture、PGlite、local HTTP 或 isolated CI service 的整合行為；不能代表正式環境。
- `RECORDED_REPRODUCTION`：Git object、source audit、diff 或已保存輸出的可重現證據；不能代替當次 runtime。
- `RUNTIME_COMPONENT_TEST`：使用 production entry point 與正式組件鏈、但外部 transport/provider 仍可隔離的測試。
- `REAL_OPENAI_PLANNER`：經授權且可核對的真實 OpenAI planner 呼叫。
- `REAL_POSTGRESQL_PROVIDER`：經授權對指定正式 PostgreSQL 的真實 provider 證據。
- `REAL_LINE`：經授權、簽章與 property identity 可核對的真實 LINE 端到端證據。
- `REAL_RENDER_DEPLOYMENT`：經授權且 commit、service、部署時間與 health 可核對的 Render 證據。

任何結果只能使用其實際達到的最低分類，不能因 assertion 名稱、PASS marker 或 CI 環境而升級。
