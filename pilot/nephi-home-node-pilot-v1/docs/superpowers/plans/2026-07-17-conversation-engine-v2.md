# JunZan AI Conversation Engine v2 Implementation Plan

> **For agentic workers:** Execute inline with test-driven development; each production change requires a failing test first.

**Goal:** 在 test-only feature flag 後完成安全、版本化、多任務且可回滾的自然語言對話引擎。

**Architecture:** Planner v2 產生無事實的結構化 plan；deterministic state、temporal、entity 與 capability layers 查詢 property 資料；response planner、controlled composer 及 claim validator 產生唯一 LINE 回覆與 scoped review。

**Tech Stack:** Node.js CommonJS、OpenAI Responses strict JSON schema、既有 provider/persistence contracts、runner-style Node tests。

## Global Constraints

- 基準 commit `62d0cb0`，branch `test-only/node-pilot-integration`。
- 僅 test-only feature flag；不碰正式 LINE、正式資料或 secrets。
- 不新增 database migration；若現有 JSON state/message/review contract 無法承載則停止。
- 不寫死 property、房號、日期、價格或設備；不以逐句 regex/substring 為主要語意解法。
- 房況、價格、容量、設備與政策只能來自當前 property resolver。

---

### Task 1: Capability matrix and v2 schema

**Files:**
- Create: `tests/conversation-engine-v2-runner.js`
- Create: `lib/conversation-engine-v2/planner-schema.js`

- [ ] 先測單問、多問、錯字/口語改寫的 canonical tasks 與 strict schema validation，確認因 v2 模組不存在而失敗。
- [ ] 建立 version 2 schema、validator 與 planner adapter；只允許規定 task/entity/state operation enum。
- [ ] 重跑聚焦測試至通過。

### Task 2: Catalog, temporal resolver and state reducer

**Files:**
- Create: `lib/conversation-engine-v2/property-catalog.js`
- Create: `lib/conversation-engine-v2/temporal-resolver.js`
- Create: `lib/conversation-engine-v2/state-reducer.js`
- Modify: `tests/conversation-engine-v2-runner.js`

- [ ] 先測 catalog 公開欄位、timezone/event timestamp、相對/星期/週末/跨年/無效日期及 SET/REPLACE/CLEAR/KEEP/NEW_TOPIC。
- [ ] 實作精簡 catalog、deterministic calendar operations 與 versioned state migration/reducer。
- [ ] 驗證舊 state 不安全時清空、property/channel/user scope 不變。

### Task 3: Entity resolution and capability execution

**Files:**
- Create: `lib/conversation-engine-v2/entity-resolver.js`
- Create: `lib/conversation-engine-v2/capability-executor.js`
- Modify: `lib/providers/service-data-access.js`
- Modify: `tests/conversation-engine-v2-runner.js`

- [ ] 先測唯一/多候選/無候選、room/bundle/amenity/policy、房況/容量/指定日 override/多晚價格與 yes/no/unknown。
- [ ] 實作 property catalog entity matching；canonical candidate 必須由 catalog 驗證。
- [ ] 統一 resolver 結構，價格與房況聯合驗證，task 個別回傳狀態並建立 scoped review requests。

### Task 4: Response safety pipeline

**Files:**
- Create: `lib/conversation-engine-v2/response-planner.js`
- Create: `lib/conversation-engine-v2/controlled-composer.js`
- Create: `lib/conversation-engine-v2/claim-validator.js`
- Modify: `tests/conversation-engine-v2-runner.js`

- [ ] 先測單問簡短、多問合併、partial success、未知/高風險、prompt injection、內部資料與 forbidden claims。
- [ ] response plan 僅收 resolver facts/action records；composer 僅模板化 plan；validator 驗證來源、property 與禁語。
- [ ] 驗證失敗產生安全 fallback、scoped review 且仍回覆。

### Task 5: Coordinator and test-only LINE integration

**Files:**
- Create: `lib/conversation-engine-v2/engine.js`
- Modify: `lib/conversation-coordinator.js`
- Modify: `server.js`
- Modify: `config/runtime.js`
- Modify: `tests/conversation-engine-v2-runner.js`

- [ ] 先測 feature flag off 維持 legacy、on 使用 v2、快速連發、多輪重新整合、受影響 resolver 重跑、正常流程不沉默。
- [ ] v2 engine 串接 Planner、state、resolver、response/review；使用 event timestamp 和 property timezone。
- [ ] duplicate 僅擋同 event 或短時間同 canonical result，不永久沉默合理重問。

### Task 6: Remove v2 legacy dependencies and full verification

**Files:**
- Modify: `lib/mvp-service.js`
- Modify: `package.json`
- Modify: relevant existing runner tests only where v2 contract replaces legacy assumptions.

- [ ] 測試證明 v2 不呼叫單 intent resolver、設備 substring fallback 或 legacy price table path。
- [ ] 將 capability data access 抽離 legacy reply branches；legacy 僅保留 flag-off 回滾入口。
- [ ] 執行 v2 matrix、`npm test`、sensitive scan、hardcode scan、`git diff --check` 與 status。
- [ ] commit、push、等待 Render deploy，確認 health HTTP 200/status=ready。
- [ ] 提供真實 test-only LINE 人工驗收題目；未驗收前 Task completed 回報 NO。
