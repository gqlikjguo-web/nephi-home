# JunZan AI 下一步任務

目前狀態與完成定義見 [專案記憶入口](PROJECT_MEMORY.md)，不可退步行為見 [產品基準](PRODUCT_BASELINE.md)。本文件只保存尚未完成且有明確順序的工作。

## 目前順序

1. 建立 platform-admin LINE binding 管理 UI：安全輸入／輪替 credential、顯示 webhook URL、設定狀態與啟用／停用；不得提供 credential 或密文讀回。
2. 經另行授權後部署 property-scoped LINE binding migration 與 runtime，再以兩個 test-only Channel 驗收隔離；本次不得部署。
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

## 2026-07-27 Bounded Planner provider retry

- Review the local two-attempt provider boundary, category allowlist, bounded delay, retry diagnostics, and no-retry matrix.
- Preserve the hard two-attempt maximum and do not add retries for invalid request, parse, structured-output, empty-response, configuration, unknown, or local contract failures.
- After separate authorization, push and deploy only to test-only before repeating the real-provider stability gate.
- Do not push, deploy, operate Render or LINE, or read/change credentials or environment variables in this implementation task.
