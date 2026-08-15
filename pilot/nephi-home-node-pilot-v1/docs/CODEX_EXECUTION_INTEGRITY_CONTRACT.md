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

每輪完成報告固定逐項列出：A. exact root cause；B. `MUTATION_ALLOWLIST`；C. actual modified production paths；D. allowlist 外 mutation；E. unauthorized DB/state mutation；F. previously PASS regression；G. frontend regression；H. admin regression；I. LINE regression；J. property isolation regression；K. tests/evidence；L. commit SHA。D 至 J 必須以可核對證據證明為 `0`；任何一項無法證明時不得宣稱 COMPLETE，只能使用 `BLOCKED`、`NOT_VERIFIED` 或 `IMPLEMENTED_LOCAL_VERIFIED`。

## 8. 誠實 BLOCKED 與未完成

允許誠實回報 `BLOCKED`、`PARTIALLY_IMPLEMENTED` 或 `UNPROVEN`。`BLOCKED` 必須列出失敗前置條件、實際證據、最後安全動作、需要的權限或外部變更，以及為何無安全本機進展。禁止隱藏失敗、跳過失敗測試、偽造結果或把 queued／timeout／skip／neutral 當成成功。

Production bug 只使用「未定位」、「已定位未驗證」、「已修復」三種狀態。「已修復」必須具有 exact deployed SHA、real environment、相關 real provider、root-cause boundary evidence 與 Protected Baseline no-regression evidence；local test 或 CI PASS 只能支持本機狀態，不得升級成「已修復」。

## 9. 核心封口的獨立審查

本次 Codex 執行完整性核心封口必須由未負責實作的 reviewer 審查完整需求覆蓋、diff、immutable acceptance、旁路封閉、mutation 執行、證據分類與 deployment blocker。這項要求只限本次核心工作，不擴張為所有日常小修改的第二流程。

## 10. 最小必要流程

只建立會直接阻止作假、改考卷、旁路、第二權威或虛假完成的規則與 Gate。不得新增 approval platform、外部 audit service、大型 provenance／attestation 系統、第二套 issue 流程或與本次風險無直接關係的官僚程序。

### 任務範圍 Gate

每次派工、修改或執行前，必須先明確寫出：

1. 使用者要的唯一結果。
2. 本輪只做的事項。
3. 本輪明確不做的事項。

只有第 2 項明列的內容屬於本輪授權範圍。任何未明列的延伸工作，包括後續階段、優化、重構、文件、測試、CI、PR、部署、外部操作或「順便修正」，即使看似有幫助，也不得自行加入。發現額外問題只能回報，除非使用者另外明確批准。不得把建議、可能的後續方案、設計備選或未授權計畫解讀成本輪任務。

### 全系統 Protected Baseline（DEFAULT DENY）

JunZan AI 所有已正常、已修好、已 PASS、已驗證或已供客人／業者使用的 code、behavior、data、settings、UI、API、LINE、database 與 infrastructure，全部預設為 `PROTECTED_BASELINE`。本規則涵蓋所有 property 與整個 JunZan AI，不只單一測試 property；沒有明確授權就不能改，而不是「沒說不能改就能改」。

受保護範圍至少包括：

- Runtime／AI：Planner／OpenAI provider、schema、semantic compiler、evidence、context、conversation state、entity resolver、capability executor、Canonicalizer、Resolver／PostgreSQL provider、FinalDecision、Claim Validator、FinalResponse、property isolation、Unknown ≠ No 及所有已 PASS 自動回覆能力。
- 前台／後台：guest／admin／availability frontend、public／admin API、route／slug、房型顯示、房價、房況、bundle、LINE 按鈕／連結與目前正常 UI 行為。
- PostgreSQL：properties、property_settings、room_types、room enabled／presentation、prices、room_price_overrides、availability、bundles／members、knowledge_items、LINE bindings、admin／operator identity、onboarding、custom replies、notes、conversations／messages／state。
- LINE：credentials、bindings、webhook、gateway、routing、LINE URL 與 property identity。
- Infrastructure：Render、PostgreSQL connection、environment variables、GitHub Actions、OIDC、migrations、seed、reset、sync、initialization 與 deployment configuration。

### MUTATION_ALLOWLIST 與 Production Modification Gate

每輪開始先記錄 task baseline，並列出 exact repository-relative `MUTATION_ALLOWLIST`。只有本輪唯一結果直接需要、且由使用者當次授權的最小責任範圍可列入；實作途中發現需要 allowlist 外檔案、function、table、field 或外部動作時立即停止，不得自行擴張。

任何 production mutation 在取得授權資格前，必須先建立完整直接因果鏈：

`實際 FAIL`
→ `earliest failure layer`
→ `exact production function / transition`
→ `direct causation`
→ `證明不修改該處就無法安全修復`

同時列出鄰近已 PASS behavior、no-regression 測試與 rollback。缺少任何一項時不得修改 production；「同一主線／contract／lifecycle」、「方便」、「重構」、「fixture 較容易」或推測相關都不是授權。

即使證據證明某個 `PROTECTED_BASELINE` surface 必須改，也只取得向使用者請求修改的資格。Codex 必須先停止並回報：真實 FAIL、earliest layer、exact surface、不可避免原因、exact files／functions／tables／fields、預計行為差異、可能影響的正常能力、no-regression 驗證與 rollback；只有使用者對該次 exact mutation 明確同意後才能執行。過去授權、一般「繼續」或 test-only 身分不構成本次批准。

Machine Code Gate 必須比較 task-start baseline 與完成狀態，包含 tracked 與 untracked path，並證明 `actual modified paths ⊆ MUTATION_ALLOWLIST`。任何額外 path 以 `PROTECTED_BASELINE_MUTATION` exit 1；Gate 輸入缺失、baseline 無法證明或以 broad／模糊 path 代替 exact allowlist 時均為 `INTEGRITY_FAILURE`。

### Protected PASS 與 acceptance 不可退化

Protected PASS set 只能增加，不能縮小。修 B 造成 A 從 PASS 變 FAIL 仍是 `REGRESSION`，不得提交、push 或部署；必須 rollback，或修到 A、B 同時 PASS。Acceptance 題目、assertion、預期、safety、property isolation、Unknown ≠ No、NOT_EXECUTABLE 與 substantive coverage 同屬 `PROTECTED_BASELINE`；若 acceptance 本身確有錯誤，只能在獨立任務以獨立證據先取得批准，不得與 production fix 同輪修改。

Section 3 的禁止旁路永久適用，並明確包括 case／question hardcode、keyword、regex、alias、fuzzy patch、fallback masking、broad validator relaxation、unrelated refactor、順便修改 frontend／backend／DB，以及為製造 GREEN 改產品行為。

### Formal deployed acceptance fail-closed Gates

- **Render／environment／migration deployment preflight：** 任何 deployed acceptance 或部署完成聲明開始前，必須以唯讀、可核對證據同時確認 exact authorized Render service、repository、branch、live commit、全部必要 runtime environment 設定，以及目標 migration／schema readiness。缺值、未知、錯配、檢查錯誤或無法證明時一律 `INTEGRITY_FAILURE` 並以 non-zero 結束。Preflight 本身不得執行 migration、seed、sync、initialization 或其他寫入；任何寫入仍須遵守本契約的逐次授權。
- **Diagnostic／finalizer 不得取代正式驗收：** Diagnostic、trace、report attribution 與 finalizer 都是非權威證據層，不能取代 production acceptance、改變正式結果或將未證明狀態降級為成功。任何本次驗收要求的 diagnostic／finalizer／attribution 未完成、拋錯或無法證明時，必須保留 bounded evidence 並以 non-zero 結束；不得只寫入 `UNPROVEN` marker 後繼續回報 PASS。
- **所有未通過狀態一律阻擋成功退出：** 任一 case 或 turn 為 `FAIL`、`PARTIAL_NOT_EXECUTABLE`、`NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API` 或其他 `NOT_EXECUTABLE` 狀態時，整個 acceptance run 必須以 non-zero 結束。Tier、分類、group、optional／edge 標記不得豁免；unavailable、expired 或日期失效的測試資料只能如實 FAIL／NOT_EXECUTABLE 並回報，禁止修改題目、expected result、case count、分類或產品 runtime 來製造 PASS。

## 11. 外部系統與部署授權

沒有使用者對特定外部動作的當次明確授權，不得 push、建立 PR、merge、部署或操作 Render、LINE Console、PostgreSQL、credentials 與 production environment。測試或本機完成不能解除：

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

### Runtime 正常寫入與 Agent 主動寫入的邊界

本限制只約束 Codex／Agent／測試／驗收／維護流程主動造成的 operational state mutation。已核准且正常運作的 JunZan AI runtime 必要寫入，例如正常處理客人訊息時保存 message、conversation state、reply log 或同類正式業務狀態，不得被 Gate 禁止、不得被修改破壞，也不需要逐次取得使用者批准；這些正常 runtime 必要寫入本身屬於 `PROTECTED_BASELINE`。

Codex／Agent／workflow 主動執行或觸發 seed、reset、sync、initialization、migration、backfill、restore、batch UPDATE、DELETE、property settings overwrite、availability reset、price overwrite 或 LINE binding change，全部是 `WRITE OPERATION`。名稱即使是 preflight、integrity、test-only 或 verification，只要會寫資料就仍是 mutation；必須先停止並取得使用者針對該次 exact operation 的明確批准。

### Acceptance 隔離 Gate

Acceptance 不得 reset／sync public、operator-managed、customer-facing、LINE-bound property 或正常 JunZan operational data。優先使用獨立 acceptance PostgreSQL database 與獨立 write credential，且該 credential 不得有正常 operational DB write permission。若只能使用獨立 acceptance property，第一個 DB write 前必須自動證明：無 public slug、無 LINE binding、無正常 admin／operator ownership、有 acceptance-only marker，且不與正常 property 共用 mutable rows；任一條件缺失即 `INTEGRITY_FAILURE`。

### Operational State Gate

任何 Codex／Agent task 可能主動造成 deployed operational state mutation 時，必須在寫入前後讀取同一 scope 的 operational snapshot。至少完整包含 settings、rooms（含 enabled／presentation）、prices、overrides、availability、bundles、knowledge、LINE、admin／operator bindings 與 public identity。純唯讀調查可明確宣告 `--no-deployed-write`，不等同於未接觸外部唯讀資料，也不得掩護任何寫入。正常業者資料可能自然變化時只能比較本次 before／after snapshot，不得使用永久固定 hash。任何未列入本次 operational mutation allowlist 的差異以 `PROTECTED_OPERATIONAL_STATE_MUTATION` exit 1；scope 不一致、必要 domain 缺失或 snapshot 不可驗證均為 `INTEGRITY_FAILURE`。

### Operational-data 事故與 restore

發現 Codex／acceptance 誤寫正常 operational data 時，立即停止後續 AI 修正、acceptance 與外部寫入，先唯讀查找 PostgreSQL／Render backup、historical state、audit／history、pre-sync artifact 或其他可證明的 last-known-good state，並分類為 `RECOVERABLE_EXACT`、`RECOVERABLE_PARTIAL` 或 `NOT_RECOVERABLE`。不得以 fixture、對話記憶或猜測恢復。找到 exact recovery source 後，只能先回報 source、exact tables／fields、expected before／after 與 rollback，再停止等待使用者對 restore 的當次明確批准。

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
