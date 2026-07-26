# JunZan AI 專案記憶入口

Repository 是 JunZan AI 專案唯一可信知識來源。ChatGPT 對話、Memory 與 Codex Session 只是暫時協作介面；未寫入 Repository 的內容，不視為永久專案知識。

## 目前目標

完成 JunZan AI 第一版在尼腓的家正式導入：先讓 test-only LINE 的 Conversation Engine V2 通過真實驗收，再建立回退點；只有取得使用者逐次明確授權後，才能處理正式 LINE 切換。

## 第一版完成定義

第一版完成必須同時符合：

- 尼腓的家既有 `nephi_home` property、房型、包棟、價格、FAQ 與安全知識正確套用且隔離。
- 後台房況是唯一事實來源；開房或關房後，下一次查詢立即讀到最新資料。
- Conversation Engine 能理解日期、房型、人數、多問題與多輪修改，且不受舊 state 污染。
- 回覆只使用 Resolver 與 property 授權資料；Unknown 不得回答成 No。
- 可回答的子問題完整回答；真正需要人工的子問題才 scoped review／轉真人。
- test-only LINE、完整測試、部署與 health 驗收通過。
- 正式 LINE 有明確回退點，且只在使用者明確授權後切換；真實正式 LINE 驗收通過。

詳細不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。

## 必讀文件

1. [本入口](PROJECT_MEMORY.md)
2. [產品基準](PRODUCT_BASELINE.md)
3. [核心產品憲法](JUNZAN_AI_CONSTITUTION.md)
4. [重大決策](DECISIONS.md)
5. [永久安全規則](SECURITY.md)
6. [下一步任務](NEXT_TASKS.md)

需要查事件原因與產品演進時，再讀 [經驗教訓](LESSONS_LEARNED.md) 與 [重要產品演進](CHANGELOG_INTERNAL.md)。

## 目前最高優先

真實 test-only LINE 驗收 V2 短日期與即時房況鏈路：

1. 連續三次詢問 `7/18 的301可以預訂嗎？`，結果必須 deterministic。
2. 後台將 7/18 的 301 設為可售後，下一次 LINE 查詢立即回答有房。
3. 將同一筆改為不可售後，下一次 LINE 查詢立即回答無房。
4. 驗收 `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？` 的 multi-task 完整性。

## 已知 blocker

- 目前沒有已由程式或部署證據確認的 blocker。
- 真實 test-only LINE 人工驗收尚未完成，因此不得宣稱第一版完成或建議切正式 LINE。
- 多業者共用 service 的 property-scoped LINE binding 核心與最小 platform-admin API 已完成自動驗證；尚缺總後台 LINE 管理 UI，且本次未部署。

## 第一版驗收狀態

- PostgreSQL、multi-property、property 隔離、admin identity、platform admin：完成。
- Onboarding、既有 property 套用、room／bundle mapping、交易與回滾：完成。
- 後台房況、每日／月曆、備註、價格矩陣與手機版：完成。
- LINE 正式／test-only Channel Identity 安全硬隔離：完成。
- Conversation Engine V2 已部署至 test-only；短日期 trust boundary 修正 commit：`0c743642b69c9d671410bb44dc1e8b42735c938a`。
- 完整 `npm test`：最近一次驗證 exit 0（V2 generic availability／available-dates schema、property-backed setting catalog、回覆順序回歸後）。
- Phase 6 local transport E2E：完成（reply／clarification／handoff success+failure、no_reply，以及 FinalDecision/transport alignment）。
- Phase 7 local final response authority：完成（單一 renderer、11-case unit matrix、6-path signed webhook E2E、runtime uniqueness 28/28；完整 `npm test` exit 0）。
- 真實 test-only LINE 最終驗收：進行中。
- 正式 LINE 切換與真實正式驗收：未開始，需使用者明確授權。

## 永久知識維護規則

- 同一知識只由一份主要文件負責，其他文件使用連結，不複製全文。
- 重大決策 append 到 `DECISIONS.md`，不得改寫既有決策歷史。
- 已驗收且不得退步的行為更新 `PRODUCT_BASELINE.md`。
- 重要 bug 與可重複避免的事件更新 `LESSONS_LEARNED.md`。
- 核心能力或安全邊界的重要 commit 以一句摘要更新 `CHANGELOG_INTERNAL.md`。
- 每次正式驗收或優先順序改變，同步更新本文件與 `NEXT_TASKS.md`。
## 2026-07-26 Planner failure diagnostics

- The safe Planner failure diagnostic checkpoint is on `phase1-4-authoritative` at `5f862ff2be3c45c8383efcec2b502f8886a775ac`. It extracts only sanitized OpenAI `error.type`, `error.code`, and `error.param` from non-2xx JSON responses; non-JSON responses retain the original HTTP failure with empty provider fields.
- Targeted safety coverage includes 400 JSON and non-JSON responses, field allowlisting/truncation, 401, 404, 429, 5xx, timeout, empty response, parse, configuration, generic failure, sensitive-field exclusion, callback isolation, FinalDecision stability, and signed webhook LINE delivery.
- Phase 6/7 regressions and runtime uniqueness pass; the completed full `npm.cmd test` returned OS exit 0, reached the final runner, and produced empty stderr.
- The diagnostic extension has been pushed; deployment and operational Render/LINE verification remain separately authorized work.

## 2026-07-26 OpenAI strict Planner schema compatibility

- The confirmed OpenAI `invalid_json_schema` at `text.format.schema` traced to `contextRelationCandidates[].evidenceRefs[]`: `eventId` and `messageRef` were declared properties but absent from `required`.
- The local fix requires both fields while retaining empty-string support, relation/evidence validation, offsets, quote rules, strict mode, and all Planner semantics.
- The recursive schema audit, targeted contracts, Phase 6/7 regressions, runtime uniqueness, and one complete `npm.cmd test` all pass with exit 0 and empty stderr.
- The strict-schema fix remains local for review; no push, deployment, Render operation, LINE operation, model, credential, or environment change is part of this task.

## 2026-07-26 Safe context-validation diagnostics

- Test-only traces now expose allowlisted `context_validation` rejection paths and candidate summaries: index, relation kind, request-cycle reference count, evidence count, and per-evidence source-match booleans.
- Integration coverage includes accepted evidence, real validator rejection, hostile sensitive payload exclusion, and unchanged `context_relation_invalid` handoff behavior.
- Relation/evidence, Planner-failure, Phase 6/7 transport, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0 and empty stderr.
- The safe diagnostic checkpoint `35acec8d070726df1029d324028f665d76e8493f` is pushed; no deployment, Render operation, LINE operation, or credential change occurred.

## 2026-07-26 Canonical Planner evidence coordinates

- A production-equivalent replay of `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？` reproduced three source mismatches and `context_relation_invalid` before the fix.
- Deterministic normalization now replaces Planner coordinates only for a unique exact task `sourceText` occurrence in a uniquely identifiable source event, immediately before the unchanged context validator.
- The replay now produces three successful evidence source matches and continues through temporal, FormalRequest, QueryPlan, and executor without a parking classification change.
- Exact-match edge cases, relation/evidence defenses, Planner semantics/fallback, Phase 6/7, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0 and empty stderr.
- The fix remains local pending review; no push, deployment, Render operation, LINE operation, model, credential, or environment change occurred.

## 2026-07-27 Parking routing and mixed results

- A real test-only replay proved that canonical `parking` was structurally valid but incorrectly retained the `availability` capability, so it requested stay dates instead of reading the property-scoped parking fact.
- The local fix deterministically maps canonical `parking` to the shared property-catalog amenity capability and prevents the availability Resolver from running for parking questions.
- Mixed answer plus clarification/review plans now preserve deterministic per-task sections; a scoped unknown no longer converts safe answered sections into `claim_validation_failed`, while high-risk tasks still require handoff.
- The real three-question regression, single parking variants, Phase 6/7 regressions, runtime uniqueness, and one complete `npm.cmd test` pass with exit 0. No push, deployment, Render operation, LINE operation, or credential change is authorized here.
