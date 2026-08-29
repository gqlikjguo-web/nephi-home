# JunZan AI 新核心人工測試頁設計

日期：2026-08-29  
狀態：待使用者書面審閱  
範圍：新版核心 test-only／admin 執行路徑；不含 production cutover、Task 15 或既有 Contract 修正

## 1. 唯一目標

建立一個僅限已登入業者使用的「JunZan AI 新核心測試」頁面。業者可在固定的 `nephi_home` property scope 中連續輸入自然語言，實際經過新版核心、正式唯讀 Resolver 與既有 FinalDecision／FinalResponse，查看「若這是真實 LINE 訊息，系統會怎麼處理」，但不送 LINE、不寫正式客人狀態、不建立正式 message／review 紀錄，也不修改任何正式 property facts。

本工具的目的，是保存可追溯的真實人工測試 FAIL，讓後續工作能依 traceId、testSessionId、failureCode 與人工問題分類定位共同根因。本輪不修 AC-PRD-003／004／005，不修改 Luna prompt，不放寬既有 Contract。

## 2. 設計原則

1. 測試頁只是新版核心 UI，不是另一套核心。
2. OpenAI Understanding 固定走既有新版 provider 與唯一 model authority：`gpt-5.6-luna`。
3. C01 至 C08、CanonicalRequest、Resolver、ResponsePlan、Claim Validator、FinalDecision 與 FinalResponse 均重用既有正式元件與契約。
4. 正式 facts 只可由 existing Resolver 對 property-scoped PostgreSQL／業者後台正式資料進行唯讀查詢取得。
5. 測試 conversation state 與測試紀錄使用專用 repository 與專用資料表，不得進入正式 guest conversation、message log 或 review queue。
6. 所有正式副作用邊界 fail closed；任何 LINE send、正式 state/message/review write、booking mutation 或 facts mutation 嘗試都使該回合失敗並留下安全 diagnostic。
7. UI 只顯示 allowlisted diagnostics，不顯示 raw reasoning、完整 prompt、provider raw response、API key、credential、private notes、敏感 header 或資料庫連線資訊。

## 3. 重用現有基礎設施

### 3.1 Admin authentication

沿用 `nephi_admin_session`、既有 PostgreSQL admin session repository 與現有 property access rule。頁面與所有 API 都必須在 server side 驗證登入狀態，並要求該 admin session 可存取 `nephi_home`。query、request body 或 client-side state 不得切換 property。

### 3.2 新版核心

重用：

- C01 turn-input adapter 與 understanding input contract；
- `openai-understanding-v1` 與 `openai-model-authority`；
- C02 至 C07 validation、Context、Lifecycle 與 routing；
- C08 `canonical-execution-adapter`；
- C11 diagnostic boundary 的安全 marker 與 failure attribution。

不得建立 test-only Planner、fixture understanding、keyword／regex routing 或 `nephi_home` 特例。

### 3.3 正式查詢與最終輸出

ANSWER 路徑使用 C08 所產生的既有 CanonicalRequest，交給既有 canonical query／Resolver adapter、property-scoped repositories、ResponsePlan、Claim Validator、FinalDecision 與 FinalResponse renderer。測試 orchestration 只負責把正式元件串起來及收集 allowlisted diagnostics，不得自行解讀客人訊息、產生 facts 或撰寫答案。

CLARIFY、HANDOFF 與 NO_REPLY 仍由新版 routing／FinalDecision 決定。HANDOFF 對客文字固定由共用安全 copy authority 提供：

> 這個問題我先幫您交由業者確認，請稍候，業者會盡快回覆您。

測試頁不得保存或使用舊文案「這部分需要業者確認。」。

## 4. 元件與責任

### 4.1 Manual-test application service

新增單一 test-only application service，責任限於：

1. 驗證 admin 與固定 property scope；
2. 建立或讀取測試 session；
3. 從測試 state repository 組裝 C01 所需的 bounded conversation context；
4. 呼叫既有新版核心與正式唯讀查詢／finalization 元件；
5. 將新版 lifecycle 結果寫回同一 test session state；
6. 保存安全 diagnostic record；
7. 回傳 UI projection。

此 service 不得包含任何 capability、subject、日期、Context 或回答語意規則。

### 4.2 Read-only Resolver boundary

建立窄介面的 read-only facade，但 facade 只委派既有 Resolver／repository 查詢方法，不複製查詢邏輯。它只暴露本流程需要的 property、catalog、availability、available-dates、price、amenity、policy 與 custom-reply read operations；所有 mutation method 均不存在。若下游要求 mutation 或 scope 不等於 `nephi_home`，立即以安全 failureCode 失敗。

每次查詢 diagnostics 只保存 Resolver 名稱、正式資料是否找到、結果狀態與 bounded source kind；不保存敏感或完整正式資料 payload。

### 4.3 Side-effect guard

測試 composition 使用 fail-closed adapters：

- LINE sender：永遠不可呼叫；呼叫即 `TEST_LINE_SEND_FORBIDDEN`；
- production guest state writer：不可注入；
- production message writer：不可注入；
- production review writer：不可注入；
- booking／facts／property mutation writer：不可注入；
- test state writer 與 test diagnostic writer：只接受帶有效 testSessionId 的 test scope。

每回合保存六項 side-effect counter：LINE send、production state write、production message write、production review write、booking mutation、facts/property mutation。正常結果全部必須為零。

### 4.4 Test conversation repository

使用專用 PostgreSQL tables：

- `new_core_test_sessions`：testSessionId、propertyId、admin ownership、建立／更新時間、目前測試 state、active generation；
- `new_core_test_turns`：turnId、testSessionId、generation、timestamp、輸入、安全 diagnostics、預計回覆、人工判定欄位。

這些 table 是測試工具資料，不是正式 guest log、conversation state 或 review queue。foreign key 與 repository query 必須同時限制 session owner、propertyId=`nephi_home` 與 generation。

「開始新對話」建立新的 generation 並將 active test state 重設為空；歷史 turns 保留以供回查。它不得 DELETE 或 UPDATE 任何正式 guest row。

## 5. Conversation scope 與連續對話

每個 browser test session 由伺服器產生不可猜測的 testSessionId。傳給 C01 的 channel／user identity 使用明確 test-only namespace，概念上為：

- channel：`new-core-manual-test`
- user scope：由 testSessionId 衍生的不可逆 bounded identity
- propertyId：固定 `nephi_home`

不得使用 LINE user ID、LINE destination 或正式 conversation key。後續 turn 從專用 test state 取得 verified context，使「那 21 號呢？」、「如果包棟呢？」等內容經過真正的 Context/Lifecycle 處理。client 不得提交或覆蓋 server state。

## 6. HTTP 與頁面介面

### 6.1 Page

建議頁面路徑：`/admin/new-core-test`

頁面 server-side auth 通過後才可回傳。畫面包含：

- 標題：JunZan AI 新核心測試；
- Property：尼腓的家；
- Model：gpt-5.6-luna；
- Mode：人工測試／不送 LINE；
- 連續聊天訊息區；
- 訊息輸入與送出；
- 開始新對話；
- 測試紀錄入口；
- 每回合預計結果、收合 diagnostics 與人工判定控制。

### 6.2 API

建議 API root：`/api/admin/new-core-test`

- `POST /sessions`：建立新測試 session；
- `POST /sessions/:testSessionId/turns`：執行下一輪；
- `POST /sessions/:testSessionId/new-conversation`：重設該 session 的 Context generation；
- `GET /sessions/:testSessionId/turns`：取得目前 session 歷史；
- `PATCH /turns/:turnId/review`：保存人工判定、分類與 bounded note；
- `GET /records?filter=all|problem|unmarked`：取得目前 admin 最近測試紀錄；
- `GET /records/:traceId`：以 traceId 回查安全 diagnostic。

所有 route 都從 admin session 取得 owner 與 property authority；body/query 中的 propertyId 若存在，只能等於 `nephi_home`，但不能成為授權來源。

## 7. 每輪執行與顯示

資料流：

`guest message → C01 → Luna Understanding → C02–C07 → Context/Lifecycle → C08 → CanonicalRequest → Resolver/PostgreSQL(read-only) → ResponsePlan → Claim Validator → FinalDecision → FinalResponse projection`

UI 按 disposition 顯示：

- ANSWER：FinalResponse 實際預計文字；
- CLARIFY：FinalResponse 實際預計追問文字；
- HANDOFF：核准的共用人工轉接文字；
- NO_REPLY：只顯示「系統判定：不需要回覆」，不得生成假客人回覆。

若任何層 fail closed，該回合顯示安全結果及第一個錯誤位置，不得 fallback 到 legacy core、第二 classifier、第二 semantic AI call 或硬編答案。

## 8. 安全 diagnostics projection

每回合 response 與 persisted record 只包含：

- Luna 理解：bounded 中文 summary、purpose、capability、subject、日期候選、人數候選、Context action；
- validated units；
- lifecycle 與 routing disposition；
- canonical result status；
- Resolver 名稱、是否找到正式資料及安全 result status；
- FinalDecision 與預計 FinalResponse；
- earliest failure layer、failureCode 與固定中文說明；
- requestedModel／resolvedModel；
- traceId、turnId、testSessionId；
- side-effect counters；
- 人工判定資料。

禁止欄位由 recursive denylist 與 explicit allowlist 同時保護。任何 `apiKey`、authorization、cookie、credential、token、secret、header、prompt、reasoning、raw provider response、database URL、private note 或未知欄位都不得持久化或回傳。

## 9. 人工判定

每輪初始為 `UNMARKED`。業者可標記：

- `CORRECT`；或
- `PROBLEM`，並選擇：Luna理解錯、回覆內容錯、不該回卻回了、該回卻沒回、應該追問、不該轉人工、應該轉人工、Context承接錯、日期錯、房型/包棟錯、房價錯、房況錯、設備/政策資料錯、其他。

備註做長度限制與純文字處理。人工判定是 diagnostic metadata，不得改變任何核心結果、state transition、Resolver facts 或後續 routing。

## 10. 測試紀錄頁

同一 admin test page 提供簡單紀錄視圖，顯示時間、輸入、預計回覆、人工結果、問題分類與 traceId。只支援 `all`、`problem`、`unmarked` 三種 server-validated filter，使用固定最大筆數與倒序查詢。

traceId lookup 必須同時驗證 admin owner 與 `nephi_home` property scope，不能跨業者或跨 test session 洩漏資料。

## 11. Error handling

1. 未登入或無 property authority：401／403，不建立 session 或紀錄。
2. Luna unavailable、provider error 或 model identity mismatch：明確失敗，不換模型。
3. Contract rejection：保存 earliest C-layer 與 failureCode，顯示安全產品結果，不以 UI 自行修補。
4. Resolver unknown／error：保持 Unknown ≠ No，由既有 FinalDecision 決定 clarify／handoff；UI 不猜 facts。
5. test-record write 失敗：回合不得宣稱已完整保存；回傳可辨識錯誤，不轉寫正式 logs。
6. side-effect guard 非零：整輪 fail closed，標記 isolation failure。

## 12. 測試策略

先建立單一人工測試頁 contract runner，證明舊設計缺少 route、service、test repository 與 isolation gates，形成 RED。之後以 TDD 分段完成：

1. admin auth 與固定 `nephi_home` property；
2. test session namespace、連續 Context 與 new-conversation generation；
3. 真正 new-core 至 C08 orchestration；
4. existing Resolver 的唯讀 execution；
5. ANSWER／CLARIFY／HANDOFF／NO_REPLY projection；
6. diagnostics allowlist 與 trace lookup；
7. 人工 review 與 records filter；
8. fail-closed side-effect guards；
9. UI behavior 與敏感資訊 absence。

GREEN 至少驗證使用者列出的 20 項條件，包括 298/298 deterministic acceptance、48/48 Shadow、property isolation、六項零副作用與 `git diff --check`。使用 fake provider／isolated PostgreSQL 的測試只可聲明對應的 contract 或 fake-integration 證據；沒有另行授權，不呼叫真實 OpenAI、不查寫 deployed PostgreSQL、不 deploy。

## 13. 修改範圍

預計最小 allowlist：

- new-core manual-test application service 與安全 diagnostic projection；
- test-only PostgreSQL migration／repository methods；
- `server.js` 的 admin-only page/API composition；
- 新增 admin test page HTML／CSS／JS；
- 共用 HANDOFF copy authority（僅在現有位置無可重用 authority 時建立）；
- 對應 contract、integration、frontend 與 regression runners；
- 必要 package scripts；
- 本設計與 implementation plan。

明確禁止：legacy Planner、production composition root、既有 core Contract／prompt、Resolver 語意、facts、availability、price、property settings、LINE binding／transport、正式 guest state/message/review schema 或 Task 15 code。

實作計畫必須在碰程式碼前，把上述類別解析為精確 repository-relative file allowlist；若發現必須修改禁止範圍或 allowlist 外 protected surface，立即停止並重新取得授權。

## 14. Git、外部系統與完成界線

本輪允許設計、RED、最小實作、GREEN、affected regression 與 local commit。不得 push、deploy、呼叫 production endpoint、操作 Render／LINE、修改正式 PostgreSQL 或開始 Task 15。

完成狀態只代表本機已驗證。是否可供人工測試仍取決於後續另行授權的 test-only deployment；本輪不得把 local PASS 宣稱成 deployed readiness。
