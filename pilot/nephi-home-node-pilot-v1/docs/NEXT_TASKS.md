# JunZan AI 下一步任務

目前狀態與完成定義見 [專案記憶入口](PROJECT_MEMORY.md)，不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。本文件只保存尚未完成且有明確順序的工作。

## 目前順序

1. 審查 `test-only/property-line-connection-page` 的一次性 setup-link、原子 credential 儲存、平台管理 UI 與業者設定頁；本輪不得部署。
2. 經使用者另行明確授權後，僅部署至 `nephi-home-node-pilot-test-only`，確認 encryption key 存在但不得讀回，再以兩個假 test-only property／Channel 驗收隔離、用兩個獨立 PostgreSQL connection/process 驗證同一 setup token 真並行兌換只有一次成功，最後精確清理。
3. 部署目前通用 V2 語意修正至 test-only，並以真實 LINE 驗收最近可住、指定日期、房型類別與多問題回覆。
4. 由使用者在後台切換 7/18 的 301：
   - 可售後，下一次 LINE 查詢立即回答有房。
   - 不可售後，下一次 LINE 查詢立即回答無房。
5. 真實 test-only LINE 驗收 `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？`，確認三個 task 都回答且住宿需求優先。
6. 驗收 Conversation State 修改鏈：
   - `兩個人住兩晚，要有浴缸`
   - `改四個人`
   - `不用浴缸了，那多少錢？`
7. test-only 全部通過後建立正式切換前回退點。
8. 只有取得使用者逐次明確授權後，才執行正式 LINE webhook 切換與真實正式驗收。

## 2026-07-26 Phase 6 local transport E2E

- 已完成：FinalDecision 與 LINE transport action 對齊；reply／clarification／handoff 的成功與失敗、以及 no_reply 均由 E2E runner 驗證。
- 未完成：真實 test-only LINE 驗收仍依上列既定項目執行；本次未部署、未切換 LINE、未接觸 credentials。

## 2026-07-26 Phase 7 final response authority

- 已完成：唯一 final response renderer 讓 FinalDecision 同時控制 action 與最終內容；reply／clarification／handoff／no_reply、claim rejection 與 Composer exception 均有自動驗證。
- 已完成：signed webhook E2E 經既有 Coordinator、ConversationEngineV2 與 LINE mock 驗證六條路徑；runtime uniqueness 為 28/28，完整 `npm test` exit 0。
- 未完成：真實 test-only LINE 驗收仍依上列既定項目執行；本次未部署、未切換 LINE、未接觸 credentials。

## 不得提前執行

- test-only 驗收未完成前，不得宣稱第一版完成。
- 未建立回退點前，不得切正式 LINE。
- 未經使用者明確授權，不得修改正式 LINE、Render、環境變數、資料庫、Secret 或 Token。
## 2026-07-26 Planner failure diagnostics

- Required OpenAI invalid-request field tests, Phase 6/7 regressions, runtime uniqueness, and full `npm.cmd test` verification are complete with exit 0.
- The safe diagnostic checkpoint `5f862ff2be3c45c8383efcec2b502f8886a775ac` is pushed.
- Do not deploy; operational verification on Render remains a separately authorized task.

## 2026-07-26 OpenAI strict Planner schema compatibility

- Required strict-schema, semantic, relation/evidence, Planner fallback, Phase 6/7, runtime uniqueness, and full `npm.cmd test` verification is complete with exit 0.
- Preserve the local commit `fix: make planner schema strict-output compatible` for final review.
- Do not push, deploy, operate Render or LINE, or change model, credentials, or environment variables without explicit authorization.

## 2026-07-26 Safe context-validation diagnostics

- The safe formatter checkpoint `35acec8d070726df1029d324028f665d76e8493f` is pushed; no additional behavior work is required in that task.
- Preserve Planner, validator, relation rules, and fallback unchanged.
- Do not deploy, operate Render or LINE, or change credentials without explicit authorization.

## 2026-07-26 Canonical Planner evidence coordinates

- Review the local deterministic evidence-normalization fix and its RED/GREEN production-equivalent replay.
- Preserve exact-only matching and the unchanged context validator; do not add fuzzy matching or repair ambiguous evidence.
- Do not push, deploy, operate Render or LINE, or change model, credentials, or environment variables without explicit authorization.

## 2026-07-27 Parking routing and mixed results

- Review the local canonical parking route and mixed-result partial-answer regression before any deployment.
- After separate authorization, deploy only to test-only and repeat `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？`; confirm room availability, official parking fact, and official BBQ fact are all present.
- Preserve scoped safe clarification/review text and mandatory high-risk handoff. Do not push, deploy, operate Render or LINE, or change credentials in the implementation task.

## 2026-07-27 Deterministic Composer claim contract

- Review the local exact-output Composer contract and signed-webhook RED/GREEN evidence before any external operation.
- Preserve Claim Validator coverage, fact-source, and fabricated-text rejection; do not replace them with a general deterministic-reply bypass.
- Do not push, deploy, operate Render or LINE, or change credentials without separate authorization.

## 2026-07-27 Canonical Temporal Authority

- Review the local single-authority temporal diff and fixed-clock signed-webhook evidence before any external operation.
- Preserve the runtime-uniqueness mutation guard: Engine invokes one canonical resolver, while State, FormalRequest, QueryPlan, pending logic, and Executor remain non-authoritative consumers.
- If separately authorized in an environment with the existing test-only OpenAI settings, run the 20-times-per-phrase real-provider stability gate before deployment.
- Do not push, deploy, operate Render or LINE, or change credentials or environment variables without separate authorization.

## 2026-07-27 Persistent safe Planner provider diagnostics

- Review the local allowlisted provider-failure projection and its timeout, HTTP, empty-response, parse, structured-output, network, log-persistence, no-retry, and sensitive-data-exclusion tests.
- Preserve the existing Planner request, `planner_parse_failed` handoff, final response, and LINE transport.
- Do not push, deploy, operate Render or LINE, or read/change credentials or environment variables without separate authorization.

## 2026-07-28 Property-neutral runtime cleanup

- Review the local authenticated-scope onboarding, formal bundle-member mapping, generic availability import, and explicit seed-input diff together with its RED/GREEN evidence.
- Preserve property-specific values only in fixtures or historical migrations; do not restore a runtime property whitelist or implicit room/bundle mapping.
- Do not push, deploy, operate Render or LINE, read/change credentials or environment variables, run a production seed, or modify formal data without separate authorization.

## 2026-07-29 Friendly operator onboarding intake

- Deploy only the reviewed `test-only/friendly-onboarding-intake` commit to `nephi-home-node-pilot-test-only`.
- Verify one new invitation uses the dedicated test-only host, then complete draft save, read-back, submission, admin visibility, and formal-data non-pollution.
- Rotate any exposed test-only Deploy Hook after the final verification and never read back the replacement value.
- Do not reuse an invitation across applications or restore unauthenticated public draft creation.

## 2026-07-27 Bounded Planner provider retry

- Review the local two-attempt provider boundary, category allowlist, bounded delay, retry diagnostics, and no-retry matrix.
- Preserve the hard two-attempt maximum and do not add retries for invalid request, parse, structured-output, empty-response, configuration, unknown, or local contract failures.
- After separate authorization, push and deploy only to test-only before repeating the real-provider stability gate.
- Do not push, deploy, operate Render or LINE, or read/change credentials or environment variables in this implementation task.

## 2026-07-27 Canonical Request core convergence

- Review the five local gate commits and their Golden, operator-roundtrip, temporal-range, mixed-request, Phase 6/7, signed-webhook, and duplicate-writer mutation evidence.
- Preserve the single Canonicalizer and immutable CanonicalRequest boundary; future capabilities must enter through the property-neutral registry and property-scoped facts.
- Do not push, deploy, operate Render or LINE, or read/change credentials or environment variables without separate authorization.

## 2026-07-29 Limited core fixes from the 90-run validation

- Review `test-only/core-90-fixes`, especially final-candidate Claim Validation and exact property-catalog grounding for pool.
- Preserve real Claim Validator rejection, mandatory high-risk handoff, Canonical Temporal rejection, property isolation, and the single Canonicalizer boundary.
- After review and separate test-only deployment authorization, rerun the complete 90-case real-provider matrix from the latest integrated commit. Do not infer 90/90 from local deterministic regressions.
- Do not deploy, operate Render or LINE, change credentials, or modify onboarding/LINE setup/formal data in this implementation task.

## 2026-07-29 Provider-shaped pool and parking routing follow-up

- Review the `policy`-shaped pool fixture, single-definition canonical route, and unique exact source-grounding guard on `test-only/core-90-fixes`.
- Preserve rejection for ambiguous and unregistered aliases, non-empty conflicting Planner entity text, and every capability outside the current property's catalog.
- After review and separate authorization, deploy only the reviewed test-only commit and rerun the complete 90-case real-provider matrix from the beginning.
- Do not deploy, rerun the 90-case matrix, operate Render or LINE, or modify credentials, onboarding, LINE setup, formal data, or production in this implementation task.

## 2026-07-29 Final parking recovery and shared location contract

- Complete local verification and review of the non-empty/unresolvable parking provider shapes, conflict/ambiguity guards, broad location map-only behavior, two-property isolation, missing-map fallback, and location-plus-parking mixed reply.
- After separate deployment authorization, deploy only the reviewed `test-only/core-90-fixes` commit and rerun the complete 90-case real-provider matrix from the beginning.
- Do not infer true-provider stability from deterministic regressions. Do not deploy, run the 90-case matrix, operate Render or LINE, or modify credentials, onboarding, LINE setup, formal data, or production in this implementation task.

## 2026-07-30 Conversation State V3 runtime review

- Review the V3 single-writer reducer, compatibility-read projection, unified readiness calls, normalized lodging Resolver task, and bundle-before-readiness routing.
- Preserve automatic recovery only for one unexpired pending task and a structurally isolated missing slot. Explicit new questions, multiple pending tasks, ambiguity, and expired state must not be guessed.
- After separate authorization, deploy only the reviewed test-only commit and run bounded real-provider multi-turn smoke sequences before any broader validation.
- Do not deploy, operate Render or LINE, read or change credentials, or modify formal property data in the implementation task.
