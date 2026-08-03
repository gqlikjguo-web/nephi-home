# Codex 執行完整性封口設計規格

- 狀態：待最終複核，尚未授權實作
- 日期：2026-08-03
- 實作分支：`codex/execution-integrity-rules`
- 基準：`origin/test-only/node-pilot-integration`，commit `5a7c018c4a409ec5b429fb191c1ad6ab84e47696`
- 適用範圍：本次 JunZan AI Repository 的 Codex 執行規則、必要反作弊 Gate、已確認 runtime 旁路封閉與一次性獨立審查

## 1. 目標與不可違反條件

本工作只解決會造成「驗收結果與真實 runtime 不一致」或「未完成卻宣稱完成」的直接風險，不建立額外治理體系。

完成後必須同時成立：

1. `RULES_INDEX.md` 是規則權威、責任分工及衝突優先順序的唯一索引；它不複製其他文件全文。
2. 每一份規則文件只負責一個清楚範圍，重複內容刪除或改為連結。
3. fixture、mock、stub、合成資料與 isolated test database 只能證明其明示的測試層級，不能冒充真實 LINE、正式 PostgreSQL、正式部署或 production runtime 證據。
4. 測試必須走與對應 runtime 相同的 production entry point、resolver、provider、renderer 與 writer；測試專用入口不得形成第二套產品邏輯。
5. 禁止寫死答案、keyword/regex 特例、legacy fallback、雙 runtime、第二 writer、第二 resolver、第二資料權威及任何可繞過正式路徑的旁路。
6. Golden Matrix 的案例、分類、預期結果與既有核心驗收標準不得修改、弱化、跳過或重新解釋來取得通過。若發現錯誤或矛盾，立即停止並回報，不自行修正。
7. Codex 必須逐條完成原始任務，不能只完成容易部分、縮小需求、用相似功能替代、只測容易成功的案例，或以「核心已完成」包裝部分完成。
8. 新路徑完成時，已被取代的 runtime route、handler、fallback、dead code、第二 writer 與第二資料來源必須封閉。相容性保留需先取得使用者明確批准，並以不可達測試證明 runtime 不會使用。
9. 每項完成聲明必須具備可獨立核對的「原始要求 → 修改檔案與函式 → 真實呼叫鏈 → assertion → 測試分類 → exit code → commit/CI → runtime 證據」鏈。缺一段就標示「尚未證明」。
10. 可以誠實回報 `BLOCKED` 或未完成；禁止虛假成功、推論成真實驗收、隱藏失敗、跳過失敗測試或改考卷。
11. 本次核心封口工作必須由不負責實作的 reviewer 獨立審查；這不是所有日常小修改的新流程。
12. 全程不得部署，不得操作 Render、LINE、正式 PostgreSQL、credentials 或任何正式環境。

## 2. 權威規則體系

### 2.1 權威與優先順序

新建的 `docs/RULES_INDEX.md` 只登記文件的權威範圍、必讀入口、衝突處理與狀態，不堆疊各文件全文。優先順序如下：

1. 使用者在當前任務的明確指示。
2. Repository 根目錄 `AGENTS.md`：全 repository 的 Codex 行為與證據底線。
3. `pilot/nephi-home-node-pilot-v1/AGENTS.md`：該子專案的必讀順序與工作入口。
4. `docs/RULES_INDEX.md`：下列領域文件的唯一權威索引及衝突路由。
5. 各自唯一負責的領域文件。

同一層文件若有矛盾，Codex 不自行選擇較寬鬆版本；停止並回報。歷史文件只有在 `RULES_INDEX.md` 明列為現行權威時才可作為當前規則。

### 2.2 文件唯一責任

| 文件 | 唯一責任 | 不負責 |
|---|---|---|
| 根目錄 `AGENTS.md` | 全 repository 的執行誠信、證據與完成聲明底線 | 產品細節、歷史紀錄 |
| 子專案 `AGENTS.md` | 強制閱讀 `RULES_INDEX.md`，指出子專案工作入口 | 重述完整規則 |
| `docs/RULES_INDEX.md` | 權威文件表、優先順序、衝突處理、現行/歷史狀態 | 複製各規則全文 |
| `docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md` | 防作假、完整交付、證據鏈、BLOCKED、旁路封閉與測試分類契約 | 產品功能需求、部署教學 |
| `docs/JUNZAN_AI_CONSTITUTION.md` | JunZan 的產品行為與架構原則 | Codex 作業流程；本次不修改 |
| `docs/SECURITY.md` | secrets、外部服務、LINE binding 與資料安全邊界 | 一般任務排程 |
| `docs/PRODUCT_BASELINE.md` | 已接受、仍有效且有證據的產品基線 | 未驗證完成聲明、工作紀錄 |
| `docs/DECISIONS.md` | 唯一編號、狀態、取代關係清楚的架構決策 | 當前待辦、流水帳 |
| `docs/PROJECT_MEMORY.md` | 精簡的當前事實、已知限制與交接上下文 | 歷史完成清單、重複規則 |
| `docs/NEXT_TASKS.md` | 尚未完成、可執行且有依賴關係的工作佇列 | 已完成歷史、部署成功宣稱 |
| `docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md` | 既有核心架構驗收標準 | 本次不修改 |

## 3. 三個檢查點與停點規則

每個檢查點必須單獨完成、驗證、審查 diff 並回報證據。未取得使用者對前一檢查點的明確確認，不進入下一檢查點。任何 Gate 失敗、Golden Matrix 矛盾或證據缺口均標示未完成；不得用下一階段工作掩蓋。

## 4. 檢查點 A：規則、入口、現況校正與驗收保護

### 4.1 預定修改檔案

新增：

- `pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md`
- `pilot/nephi-home-node-pilot-v1/docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md`
- `.github/protected-acceptance.json`
- `pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js`
- `pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js`
- `.github/CODEOWNERS`

修改：

- `AGENTS.md`
- `pilot/nephi-home-node-pilot-v1/AGENTS.md`
- `pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md`
- `pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md`
- `pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md`
- `pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md`
- `pilot/nephi-home-node-pilot-v1/docs/SECURITY.md`
- `pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js`
- `pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js`
- `pilot/nephi-home-node-pilot-v1/package.json`
- `.github/workflows/codex-integrity.yml`

明確不修改：

- `docs/JUNZAN_AI_CONSTITUTION.md`
- `docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md`
- Golden Matrix、其 runner、核心 acceptance runner
- runtime、provider 與一般功能測試

`PROJECT_MEMORY.md`、`NEXT_TASKS.md`、`PRODUCT_BASELINE.md` 只保留可證明的現況；真實 LINE migration、真實外部驗收及部署若無本輪證據，一律改為 `UNPROVEN` 或 `DEPLOYMENT_BLOCKED`。`DECISIONS.md` 修正重複編號、狀態與 supersedes 關係，但不改變既有決策的實質內容。`SECURITY.md` 移除「legacy test-only webhook 不受 binding 要求影響」這類仍允許旁路的現行例外，並把尚未遷移狀態寫成部署阻塞，不宣稱已完成遷移。

### 4.2 Protected acceptance 清單

`.github/protected-acceptance.json` 只可精確列出以下核心驗收、Golden Matrix、Integrity Gate 與關鍵 review/CI workflow；不得加入規則文件、現況文件、一般 unit/regression tests，也不得以 `tests/**` 或其他廣泛 glob 阻止正常測試新增：

- `pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md`
- `pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json`
- `pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js`
- `pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js`
- `pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js`
- `pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js`
- `pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js`
- `.github/workflows/codex-integrity.yml`
- `.github/protected-acceptance.json`
- `.github/CODEOWNERS`

`package.json` 不做整檔 hash 保護，避免正常新增測試受阻；Integrity Gate 改為精確斷言必要 script 與關鍵 Gate 仍存在且可執行。

manifest 不能對自己做不可解的 self-hash。除 `.github/protected-acceptance.json` 本身外，上列檔案各有內容 hash；manifest 本身由固定 schema、不可變的 base commit、Golden/core baseline entries、Integrity Gate、CODEOWNERS 與本次獨立 diff review 共同保護。這能偵測一般竄改，但不冒充 repository 內部檔案可抵抗同時惡意改寫 manifest、Gate 與 workflow；GitHub branch protection 是否已開啟仍標示 `UNPROVEN`。

### 4.3 Acceptance-protection Gate 的真實 assertion

`node scripts/verify-protected-acceptance.js` 必須：

1. 讀取受版本控制的 manifest，確認所有列出的檔案存在、是普通檔案且路徑無重複、無目錄與廣泛 glob。
2. 對 manifest 以外的每一受保護檔案計算內容 hash，與 manifest 的 accepted baseline 比對；任何遺漏、修改或刪除皆 exit non-zero，並列出實際路徑，不靜默通過。
3. 確認 Golden fixture 的案例 ID、分類、預期結果及核心 runner 內容與基準 commit 完全一致。Checkpoint A 與 C 必須 byte-identical。
4. 拒絕任何 `--bootstrap`、`--update`、`--skip`、環境變數 override、branch/SHA allowlist 或 `process.exit(0)` 快捷通過。
5. 只允許本規格明列且經使用者核准的 protected Gate 實作變更在 Checkpoint B 以人工 diff 審查後更新該檔案的明確 hash entry；不得提交產生或刷新 hash 的工具。Golden Matrix、Constitution 與核心 acceptance 標準的基準 hash 不得刷新。
6. 自身 runner 必須 mutation 測試：修改受保護檔、刪除受保護檔、改 Golden 預期值、加入 bypass flag 均必須使 Gate 失敗；新增普通 unit test 必須不觸發保護失敗。

首次建立 manifest 的 bootstrap 只是一個不提交、不可重用的本機產生動作。Repository 最終不得包含 bootstrap script、CLI flag、環境開關或任何可再次更新全部基準的 bypass。

`.github/CODEOWNERS` 只為核心檔案提供 review ownership 訊號；是否真正有 branch protection 必須標示 `UNPROVEN`，不得把檔案存在當成平台已強制執行。

### 4.4 Integrity Gate 的真實 assertion

`node scripts/verify-codex-integrity.js` 與其 runner 必須驗證：

- 兩層 `AGENTS.md` 都要求先讀 `RULES_INDEX.md`，且 index 指到正確、存在的權威文件。
- `RULES_INDEX.md` 沒有兩個文件宣稱同一唯一責任，且現行/歷史狀態可解析。
- `CODEX_EXECUTION_INTEGRITY_CONTRACT.md` 包含第 1 節的十二項不可違反條件與測試分類。
- `package.json` 存在且實際執行 protection、integrity、canonical、uniqueness 與 provider fail-closed Gate；不得只搜尋 PASS 字串。
- workflow 使用乾淨 checkout、`npm ci`，並實際執行上述 Gate 與完整測試；不得 `continue-on-error` 或以條件排除 Gate。
- 不存在可讓 Gate 靜默跳過的 skip flag、空 runner、固定 PASS、只掃檔名不執行 assertion 的捷徑。

### 4.5 Checkpoint A 完成標準

只有以下全部成立才可回報 A 完成：

- 權威索引、契約與兩層必讀入口已建立，沒有規則全文重複堆疊。
- 四份現況文件與 `SECURITY.md` 已去除過期、重複及誤標完成內容；每項外部狀態有證據或明示 `UNPROVEN/BLOCKED`。
- Golden Matrix、Constitution、核心 acceptance 檔與 runtime byte-identical。
- protection 與 integrity runner 的 positive/negative/mutation cases 全部通過並有 exit code。
- 一般 unit/regression test 新增不受 protection Gate 阻擋。
- diff 僅包含 4.1 的 A 檔案，並完成本機 diff 審查。
- 回報：完整檔案清單、逐檔責任、命令、assertion、測試分類、exit code、commit、未證明項目。

回報後停止，等待使用者批准進入 B。

## 5. 檢查點 B：封閉旁路、補強 Gate 與 provider fail-closed

### 5.1 預定修改檔案

核心 runtime 與 provider：

- 修改 `pilot/nephi-home-node-pilot-v1/server.js`
- 修改 `pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js`
- 刪除 `pilot/nephi-home-node-pilot-v1/lib/test-line-webhook.js`，但只有 5.3 的前置證據全部成立才執行

Gate 與 provider 驗證：

- 修改 `pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js`
- 修改 `pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js`
- 修改 `tests/pilot-nephi-home-node-pilot-v1-postgres-provider-runner.js`
- 新增 `pilot/nephi-home-node-pilot-v1/tests/provider-authority-fail-closed-runner.js`
- 修改 `pilot/nephi-home-node-pilot-v1/package.json`
- 只更新 `.github/protected-acceptance.json` 中本規格已批准變更的 Gate hash；不得更新 Golden/core acceptance hash

LINE 測試 harness：

- 新增 `pilot/nephi-home-node-pilot-v1/tests/helpers/property-scoped-line-webhook.js`，集中建立測試用 property binding 與 shared webhook request，不建立產品旁路
- 將仍走 `/api/test-line/webhook?customerId=...` 或直接依賴 legacy handler 的測試改走 `/api/line/webhooks/<webhookKey>` 與 property-scoped binding：
  - `pilot/nephi-home-node-pilot-v1/tests/answered-claim-contract-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/first-version-controlled-core-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/junzan-test-line-gateway-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/line-channel-identity-guard-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/location-google-maps-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/phase6-transport-e2e-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/phase7-final-response-e2e-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/planner-failure-safety-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/relative-date-availability-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/test-only-line-message-trace-http-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-nephi-faq-runtime-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-nephi-property-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-optional-room-type-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-precise-clarification-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-query-mode-dedupe-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-room-filter-state-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-single-date-default-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-test-line-chain-runner.ps1`
  - `tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-trailing-flush-runner.js`

移除 legacy helper 依賴但保留/強化原 assertion：

- 修改 `pilot/nephi-home-node-pilot-v1/tests/test-line-official-adapter-runner.js`，改驗證 shared binding route 的 signature、reply 與 identity 行為
- 修改 `tests/pilot-nephi-home-node-pilot-v1-contract-runner.js`，移除「legacy helper 必須存在」契約，改斷言 legacy helper/route 不存在且 shared binding 是唯一入口

下列既有 shared-binding 驗證保留並作為替代路徑證據：

- `pilot/nephi-home-node-pilot-v1/tests/property-line-binding-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/property-line-binding-postgres-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/property-line-binding-postgres-webhook-runner.js`
- `pilot/nephi-home-node-pilot-v1/tests/property-line-setup-runner.js`

`pilot/nephi-home-node-pilot-v1/tests/test-line-official-adapter-runner.js` 與 `tests/pilot-nephi-home-node-pilot-v1-contract-runner.js` 對 `lib/test-line-webhook.js` 的依賴，必須先把仍必要的 signature、reply、identity assertion 對應到 shared-binding 路徑測試。若無法證明等價覆蓋，停止，不刪檔。

上述是現有文字引用盤點形成的候選清單。實作前仍需重新以 base commit 與當前 branch 全 repository 搜尋；若發現額外引用，加入同一遷移範圍並在 B 回報，不得遺漏後宣稱旁路已封閉。

### 5.2 旁路刪除內容

在證據成立後，從 `server.js` 刪除：

- `TEST_LINE_WEBHOOK_ROUTE` 與 `/api/test-line/webhook?customerId=...` route。
- 使用全域 LINE secret/token 並相信 caller `customerId` 的 `lineWebhookHandler`。
- 對上述 handler 的 options/injection wiring。
- `return app;` 後以「legacy runtime kept below temporarily unreachable」保留的整段 dead runtime，包括舊 classifier、coordinator、push fallback、第二 app/handler 與第二渲染/寫入路徑。

不得留下註解封存版、環境變數開關或測試模式復活 route。唯一 webhook 入口為 `/api/line/webhooks/<webhookKey>`；property 必須先由 binding resolver 解析，成功驗證該 binding 的 signature 後才可進 shared runtime。

### 5.3 刪除前必須取得的證據

刪除 legacy LINE route、handler、dead code 或 `lib/test-line-webhook.js` 前，必須逐項記錄：

1. **Active runtime 無引用**：建立從 `createApp` route table、handler injection 到 exports 的引用清單；分辨 active code 與 unconditional `return` 後 dead code。全 repository 搜尋不得省略 generated/alternate entry point。
2. **無必要 export/測試依賴**：確認 `lineWebhookHandler` 未 export；列出 `lib/test-line-webhook.js` 的每個 import 與 assertion，完成等價 shared-binding 遷移後才能刪除。
3. **shared binding 是唯一替代路徑**：以四個 property binding runner 與遷移後 HTTP tests 證明 route、binding lookup、signature verification、property identity、reply/failure 路徑均由 shared route 執行。
4. **重現會被 mutation 擋住**：在 uniqueness runner 重新插入 legacy route、caller-controlled `customerId` handler、第二 runtime 或 return 後 dead runtime，任一 mutation 都必須使 Gate non-zero。

任一證據缺失即回報 `BLOCKED_LEGACY_ROUTE_REMOVAL`，不得先刪再用測試缺失合理化。

### 5.4 弱 Gate 修正與真實 assertion

#### Canonical request Golden Gate

`canonical-request-golden-gate-runner.js` 不得只讀檔名與 PASS marker。它必須逐一啟動既定清單內 runner，並對每一個斷言：

- 檔案存在且 child process 真的執行。
- child exit code 為 0；signal、timeout、spawn error 或 non-zero 均使 Gate 失敗。
- 預期 PASS marker 必須來自該次 child stdout，不能只存在於原始碼。
- 回報每一 runner 的 exit code；不能在第一個成功後提前退出。
- Golden Matrix 的案例、分類、預期結果及核心 acceptance assertion 保持不變。

#### Runtime uniqueness mutation Gate

`v2-runtime-uniqueness-runner.js` 必須掃描完整 runtime，不得以 legacy marker 截斷檔案。至少逐一實際執行並證明下列 mutation 會失敗：

- `legacy_query_line_route`
- `caller_controlled_property_handler`
- `second_runtime`
- `resolver_bypass`
- `second_final_renderer`
- `second_canonicalizer`
- `second_temporal_writer`
- `second_capability_writer`
- `second_entity_writer`
- `second_resolver_writer`
- `unreachable_dead_runtime_after_return`

每個 mutation 都要有獨立 non-zero assertion；不能只定義 mutation 而未執行。

#### Provider fail-closed Gate

Production `createProviders` 在缺少 `DATABASE_URL` 或必要 PostgreSQL configuration 時必須 fail closed，不得退回 JSON provider。測試若需要 JSON，必須明確 inject `createJsonProviders(...)`，不得透過 production factory 的缺值 fallback 取得。

`provider-authority-fail-closed-runner.js` 至少斷言：

- production factory 無 `databaseUrl` 時拋出明確錯誤且沒有 JSON provider。
- `server.createApp` 未 inject providers 且 DB config 缺失時啟動失敗。
- 明確 injection 的 JSON test provider 仍可用於 isolated unit tests，並被分類為 `FIXTURE/ISOLATED_TEST`，不宣稱真實 PostgreSQL。
- mutation 恢復 `if (!databaseUrl) return createJsonProviders(...)` 時 Gate non-zero。
- runtime 只有 PostgreSQL authority；不存在同時寫 JSON/PostgreSQL 或讀取第二權威的分支。

### 5.5 Checkpoint B 完成標準

只有以下全部成立才可回報 B 完成：

- 5.3 四類刪除證據完整，legacy route、handler、dead runtime 與已證明無必要依賴的 legacy helper 已刪除。
- 全 repository 搜尋無 `/api/test-line/webhook`、caller-controlled `customerId` webhook、legacy marker、第二 runtime 或 production JSON fallback；必要歷史說明只能出現在非執行文件且明示已刪除。
- 所有受影響測試保持原 assertion 意義並改走 shared binding；沒有刪除困難案例或縮小預期。
- canonical Gate 真正執行每一 runner；全部 child exit code 可核對。
- uniqueness 的每個 mutation 均被實際注入且 Gate 對每個 mutation non-zero。
- provider 缺失 fail closed；JSON 只可由測試明確 injection。
- Golden Matrix、Constitution、核心 acceptance 標準仍與 base commit byte-identical；若不一致立即停止。
- 目標測試、完整本機測試與 Gate 均有分類及 exit code；B 的完整本機測試不取代 C 的乾淨環境 CI。
- diff 僅包含 5.1 的 B 檔案與經證據發現的額外直接引用，並完成 diff 審查。
- 回報被刪除/封閉旁路、呼叫鏈、所有 mutation、命令、assertion、exit code、commit 與未證明項目。

回報後停止，等待使用者批准進入 C。

## 6. Test-only LINE binding 部署阻塞

本輪即使完成程式與測試內 legacy route 移除，也必須保持：

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

只有下列條件全部由真實證據滿足，且使用者另行明確授權部署後，才能解除：

1. 現有 test-only LINE Channel 的 credentials 已透過 property-scoped binding 安全寫入目標環境；本輪不得讀寫這些 credentials。
2. LINE webhook 已由舊 route 遷移到 `/api/line/webhooks/<webhookKey>`；本輪不得操作 LINE Console。
3. 目標環境能以對應 binding 驗證真實 LINE signature、解析唯一 property，且錯誤/未知/revoked binding fail closed。
4. 由真實 test-only LINE 帳號完成端到端驗收，並保存可獨立核對的 request、reply、property identity 與時間證據。
5. 通過部署 commit 對應的完整 CI 與獨立審查，沒有用本機 fixture 冒充真實 LINE。
6. 使用者對該次部署另行明確批准。

本規格、local tests、isolated PostgreSQL container 或 draft PR 都不能解除此阻塞，也不能宣稱 LINE 已可直接切換。

## 7. 檢查點 C：乾淨環境 CI、draft PR 與獨立審查

### 7.1 預定檔案與外部變更

原則上不新增產品檔案。若乾淨環境揭露只與本工作直接相關的缺陷，必須回到對應 A/B 範圍修正並重新驗證，不可在 C 偷渡新功能或弱化測試。

C 允許的 repository/協作變更只有：

- 本分支必要的修正 commit。
- 推送本分支。
- 建立 draft PR，內容列出 A/B 證據與 deployment blocker。
- 取得一次獨立 reviewer 對本次核心封口的書面審查結果。

不得 merge、部署、更新 Render/LINE/PostgreSQL/credentials 或解除 deployment blocker。

### 7.2 乾淨驗證與 Gate assertion

在新建、無未追蹤檔與無先前 `node_modules` 的乾淨 checkout/worktree 執行：

| Gate | 真實 assertion | 分類 |
|---|---|---|
| `npm ci` | 只依 lockfile 安裝成功，exit 0 | BUILD_REPRODUCIBILITY |
| `npm run verify:protected-acceptance` | manifest 完整、所有 protected hash 合法、無 bypass、Golden/core baseline 未變 | STATIC/MUTATION_INTEGRITY |
| `npm run verify:codex-integrity` | 兩層必讀、權威映射、必要 scripts/workflow 與 anti-skip assertions 成立 | STATIC/MUTATION_INTEGRITY |
| canonical Golden Gate | 清單內每一 runner 本次真的執行且各自 exit 0/PASS | CONTROLLED_ARCHITECTURE/BEHAVIOR |
| runtime uniqueness Gate | 所有列出 mutation 個別使 Gate non-zero，正常 runtime exit 0 | MUTATION/ARCHITECTURE |
| provider fail-closed Gate | production 缺 DB 失敗、explicit test injection 可用、fallback mutation 被拒 | MUTATION/PROVIDER_AUTHORITY |
| `npm test` | repository 完整測試 exit 0，沒有 skip/continue-on-error | 混合；逐 runner 依證據標示 |
| GitHub Actions `codex-integrity` | clean checkout、ephemeral isolated PostgreSQL service、所有必要 Gate 與完整 suite exit 0 | CI/ISOLATED_RUNTIME_COMPONENT |

CI 內的 ephemeral PostgreSQL 只能證明 PostgreSQL provider/integration 行為，不得標成正式 PostgreSQL 或 production runtime 證據。

draft PR 必須固定列出：基準/完成 commit、完整 diff、A/B/C 檔案責任、已封閉旁路、Gate 命令與 assertions、測試分類與 exit code、Golden/core hash 未變、`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`、未證明項目及「不得部署」。

### 7.3 獨立審查範圍

reviewer 必須不是本次實作者，且只審查本次核心封口：

- 原始需求是否逐條覆蓋，有無只做容易部分。
- 權威文件是否各守唯一責任，有無重複或衝突。
- Golden/core acceptance 是否未變。
- legacy route/dead code/provider fallback 是否真正不可達或已刪除。
- mutation 是否真的執行並能殺死對應旁路。
- 測試分類與完成聲明是否被證據支持。
- deployment blocker 是否仍清楚且未被誤解除。

審查發現問題時回到 A/B 修正並重跑完整 C；不得把「已送審」當成通過。本次審查規則不擴張為所有日常小修改必須採用第二套流程。

### 7.4 Checkpoint C 完成標準

只有以下全部成立才可回報本工作完成：

- 乾淨環境所有命令和 GitHub Actions 完整通過，記錄每個 exit code/check URL。
- draft PR 已建立，未 merge，並含完整證據與 blocker。
- 獨立 reviewer 已完成審查，所有 blocking finding 已修正並重驗。
- branch diff 已獨立核對，沒有 Golden/core acceptance 弱化、未列檔案或旁路。
- 明確列出仍未證明的外部狀態；test-only LINE migration 保持部署阻塞。
- 提供完整檔案清單、逐檔責任、刪除旁路、Gate/assertion、測試分類、exit code、commit、CI、draft PR 與下載連結。

## 8. 明確不做

本工作不做以下事項：

- 不部署，不操作 Render、LINE Console、正式 PostgreSQL、credentials 或 production environment。
- 不修改 Golden Matrix 的案例、分類、預期結果，不修改 Constitution 或既有核心驗收標準。
- 不因 Gate 困難而刪除、跳過、改名或縮小測試。
- 不建立 approval platform、外部 audit service、大型 provenance/attestation 系統、第二套 issue 流程或其他與本次防作假無直接關係的流程。
- 不要求所有日常小修改都進行獨立第二審查。
- 不新增產品功能、不改 UI、不改模型提示、不處理與旁路封閉無關的技術債。
- 不把 fixture、mock、isolated database、local HTTP test、靜態掃描或 CI 模擬環境稱為真實 LINE、正式資料庫或正式 runtime 驗收。
- 不 merge PR，不更新 main/release branch，不建立 deployment tag。
- 不把歷史文件重新包裝成現行完成證據，也不清理與本工作無直接關係的 archive。

## 9. 每階段證據回報格式

每個檢查點只能依以下欄位回報；無證據填 `UNPROVEN`，不得省略：

1. 原始要求與本階段範圍。
2. 基準 commit、完成 commit、branch、worktree 是否乾淨。
3. 完整修改檔案與逐檔責任。
4. 真實呼叫鏈與已刪除/封閉旁路（A 不適用時明示）。
5. Gate 命令、逐項 assertion、測試分類、exit code。
6. Golden/core acceptance hash 對比。
7. diff 審查結果與獨立審查狀態。
8. 未完成、BLOCKED、UNPROVEN 與原因。
9. 本階段沒有執行的事項，特別是 deployment/external systems。
10. 可下載 branch/commit；只有 C 才提供 draft PR/CI 連結。

## 10. 本規格複核停點

本文件只定義設計與驗收契約，不授權 Checkpoint A 實作。正式複核前不得修改 4.1、5.1 所列任何既有檔案，不得執行旁路刪除、Gate 重寫、push、PR 或部署。使用者明確批准本規格後，下一步才是依本規格撰寫可執行 implementation plan；該 plan 仍須維持 A → 回報/批准 → B → 回報/批准 → C 的三段停點。
