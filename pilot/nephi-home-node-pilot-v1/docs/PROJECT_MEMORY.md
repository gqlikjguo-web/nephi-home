# JunZan AI 目前專案事實

本文件只記錄目前可由 Repository、Git 歷史與已執行命令核對的狀態。規則權威與優先順序以 [RULES_INDEX](RULES_INDEX.md) 為準；未完成工作是否已獲授權以使用者當次明確指示為準。

## Codex 執行完整性規則狀態

- Codex 執行完整性規則的制定與 Checkpoint A 已完成。
- 規則分支為 `codex/execution-integrity-rules`，且已 push 至 GitHub。
- 規則包含兩層 `AGENTS.md` 必讀入口、`RULES_INDEX.md`、執行完整性契約、acceptance protection Gate、integrity Gate、CI 執行入口及必要的狀態文件校正。
- Checkpoint B 與 Checkpoint C 未獲授權，不是目前工作；不得因其存在於規格或 implementation plan 而自動執行。

## 尚未完成或尚未證明

- Legacy `/api/test-line/webhook` route、相關 handler／helper 與 `return` 後 dead runtime 尚未在本次規則制定工作中修正或刪除。
- Production provider factory 的 JSON fallback 與 provider fail-closed 尚未在本次規則制定工作中修正。
- `REAL_LINE`、`REAL_POSTGRESQL_PROVIDER`、`REAL_RENDER_DEPLOYMENT` 與真實 OpenAI Planner 行為均沒有由本次文件收尾新增外部驗收證據。
- GitHub 上的 workflow、CODEOWNERS 或 branch protection 實際強制結果，不得僅由本機 Gate 或檔案存在推定為已完成外部驗收。

## 部署阻塞

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

在另行授權並完成 test-only LINE binding 遷移與真實驗收前，不得宣稱 LINE 已可直接切換或部署阻塞已解除。

## 證據原則

- 本機 Gate exit 0 只證明 Gate 實際檢查的 Repository 不變量，不等於真實 provider 或正式部署成功。
- 沒有可獨立核對的 assertion、exit code、commit、push或 runtime／外部證據時，必須標示 `UNPROVEN` 或精確 blocker，不得宣稱完成。

## 2026-08-04 deployed acceptance checkpoint

- The secure post-deployment test-only conversation acceptance channel is implemented and fully verified locally on `codex/deployed-acceptance-closure-20260804`.
- The route is dual-gated, preserves platform-admin access, and adds commit-bound GitHub Actions OIDC with safe FinalResponse and execution evidence.
- The deployed matrix has not been pushed, run in GitHub Actions, deployed, or executed against Render; independent review and later integration remain required.

## 2026-08-05 active first-version release closure

- `test-only/node-pilot-integration` is deployed at `7ddf5bd69d7b634690c136f7f3bf56fa068b7065`; Render health is `ready`, `testOnly=true`, and reports that exact commit.
- GitHub Actions run `30972750105` passed the complete verify job. Its real OpenAI + PostgreSQL deployed matrix produced 64 PASS, 9 FAIL, and 4 non-executable cases across 77 cases / 90 turns (73 cases / 81 turns executable).
- The remaining FAIL case IDs are `rg-003`, `rg-006`, `rg-013`, `rg-015`, `rg-037`, `rg-038`, `rg-039`, `rgs-019`, and `rgs-020`. The private artifact is `8917333233`, digest `sha256:96ed55788c5d4d34bdb067f605c2091a45c928271d04feadf7151839450fff4f`.
- Exact current-event evidence normalization fixed the prior `rg-018` context-relation failure. The only prior-PASS regression was `rg-015`, where OpenAI merged the BBQ and ingredient-order questions into one unknown task; the active uncommitted repair isolates a verified property-catalog subtask while preserving the unknown remainder as fail-closed.

## 2026-08-05 deployed acceptance run 30976898838

- Commit `fdbcbe69121f70f501ae8c00e063990e0d480ae5` passed the complete GitHub Actions verify job and Render health reported that exact commit with `testOnly=true`.
- Real OpenAI + PostgreSQL acceptance produced 61 PASS, 12 FAIL, and 4 non-executable cases. The private artifact is `8918810222`, digest `sha256:b2d4ea025ec2acc07e114ec6c646f4a2c9bbafd4839baf7040461da7fdeeb93f`.
- `rg-015` and `rg-037` improved, but `rg-032`, `rg-051`, `rg-052`, `rgs-007`, and `rgs-017` regressed from the prior PASS set. Trace comparison shows those five runs did not execute merged-unknown catalog isolation; they are independent real-Planner contract drift and remain failures.
- The active repair targets `rg-052`: an acknowledgement-labeled Planner result whose task has a verified `new_request` relation must not be changed to no-reply by the contract compiler. Pure acknowledgement cases retain relation-uncertain task evidence, while Unicode-only punctuation remains covered by the separate deterministic non-substantive rule.

## 2026-08-05 deployed acceptance run 30981512276

- Commit `0863dac095bf87be08ea664c8da8f53d1565240f` passed the complete verify job, and Render health reported that exact commit with `testOnly=true`.
- Attempt 1 produced 58 PASS, 15 FAIL, and 4 non-executable cases. Artifact `8920588490` has digest `sha256:68fd9ecb3e6e218b52fdb51fec9ec0e6c731ca48022f06c53047b5fd492e8643`.
- Attempt 2 on the same commit produced 64 PASS, 9 FAIL, and 4 non-executable cases. Artifact `8921143672` has digest `sha256:873bcb66ec5a8149e51e5d560b51a87635ec2fec1c08a18accabd24a32c61c3d`.
- `rg-052` and the no-reply controls `rg-046` through `rg-049` passed both attempts. Neither real Planner run reproduced the prior acknowledgement-plus-new-request shape, so the new relation guard is locally and CI verified but its exact malformed OpenAI shape remains unobserved after deployment.
- Attempt 1 exposed a known catalog-grounding regression in `rgs-010`: the formal `pets` entity resolved as a policy, but an incompatible amenity-shaped Planner type caused CanonicalRequest capability `unknown`. Attempt 2 passed through a different Planner shape; the compiler defect remains real and is the active repair.
- Attempt 2 FAIL cases are `rg-001`, `rg-003`, `rg-006`, `rg-013`, `rg-038`, `rg-039`, `rg-051`, `rgs-019`, and `rgs-020`.

## 2026-08-05 deployed acceptance run 30986959230

- Commit `eb41d56d326a92e6c6782142bfbf17a6a45eb196` passed the complete verify job, and Render health reported that exact commit with `testOnly=true`.
- Attempt 1 produced 62 PASS, 11 FAIL, and 4 non-executable cases. Artifact `8922860200` has digest `sha256:7f6e432c9d257f7ffd9352a270bd25396361e394fec5a96faab5bd270fcef47f`.
- Attempt 2 produced 60 PASS, 13 FAIL, and 4 non-executable cases. Artifact `8923590609` has digest `sha256:a7d621d962938b8f2e5b6358c1dfa53c99201254c0b0f1e19836700936b9e987`.
- `rgs-010` and `rgs-015` passed both attempts with formal `policy:pets` facts. Attempt 2 observed a real amenity-shaped `rgs-010` Planner task grounded to the policy capability, but its detail intent was `general`; the earlier non-general malformed shape remains covered by the deployed-motivated deterministic regression tests rather than a post-fix identical OpenAI sample.
- Cross-attempt changes (`rg-028`, `rg-037`, `rg-051`, and `rgs-017`) came from different Planner outputs or timeout behavior; no trace shows the catalog-category guard rewriting an otherwise compatible formal task into a failure.
- `rg-003` and `rg-006` repeatedly produced controlled `past_date` FinalResponses, but the safe deployed CanonicalRequest trace omitted the deterministic `expressionType` and `repairReasonCode`. That evidence-projection defect is the active isolated repair; `rg-013` may retain a later FinalDecision defect after the projection is restored.

## 2026-08-05 deployed acceptance run 30994404471

- Commit `23d102fe3c666c72c0664e1165ea8c86f64d6bd7` passed the complete Linux verify job, including the exact `npm test`; Render health reported that commit with `testOnly=true`.
- The complete real OpenAI + PostgreSQL matrix produced 62 PASS, 11 FAIL, and 4 non-executable cases. Artifact `8925912656` has digest `sha256:33011236a8ed006da3ddf13f2182709394b8a4a23c99fab3cee53224ca0616d5`.
- `rg-003` and `rg-006` changed from false `expected_date_range_missing` failures to PASS because the safe CanonicalRequest trace now proves `past_date/date_range`; `rg-013` remained a real separate temporal-parse failure in this sample. `rg-032` and `rgs-017` also changed to PASS through different real Planner outputs.
- `rg-036` and `rgs-008` changed from PASS to FAIL through Planner drift. `rg-036` exposed the next contract root: two otherwise valid policy tasks shared task ID `policy`, and structural validation discarded all three tasks as `planner_schema_invalid`.
- The active repair normalizes duplicate task IDs only within stateless property-catalog task groups. Stateful availability, pricing, and capacity duplicates remain fail-closed because task IDs become request-cycle identities.

## 2026-08-05 deployed acceptance run 31002137147

- Commit `2c694f82b1294232330432b364f3016f59c7e1de` passed the complete GitHub Actions verify job; Render health reported HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 63 PASS, 10 FAIL, and 4 non-executable cases. Artifact `8929108597` has digest `sha256:6aa6de5deb97132fc08915cb14990a09743ca348e5638231359cc67f06672afc`.
- `rg-036` changed from FAIL to PASS and retained three tasks, but this OpenAI sample used three unique task IDs. It proves no deployed regression, not a second real duplicate-ID observation; the exact prior duplicate shape remains covered by deterministic RED/GREEN.
- `rg-001`, `rgs-008`, and the first turns of `rgs-020` changed to PASS through different Planner outputs. `rg-049` regressed from PASS to FAIL because pure punctuation produced a structurally invalid unknown task and fell into `planner_schema_invalid`; this is the next active isolated repair.
- `rgs-018` newly failed through Planner and relation drift, while `rg-013`, `rg-028`, `rg-038`, `rg-039`, `rg-051`, `rgs-007`, `rgs-019`, and the second turn of `rgs-020` remain unresolved roots.

## 2026-08-05 deployed acceptance run 31008310498

- Commit `6950b5aa5d195ed1e053c3e6b651d51c8599454f` passed the complete verify job; Render health reported HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix remained 63 PASS, 10 FAIL, and 4 non-executable cases. Artifact `8931837955` has digest `sha256:ef10e756beca7543109032e56af3f3804e791b1cedff6df45cd777a0afccf1f3`.
- `rg-049` passed with a real OpenAI response that still classified `？` as a substantive malformed unknown request; the compiler normalized it to an evidence-bound unknown no-reply contract, produced `no_reply_gate_hit`, executed no resolver, and emitted an empty no-reply FinalResponse.
- `rg-028` and `rgs-018` also returned to PASS through different Planner outputs. `rg-001`, `rg-009`, and `rg-032` regressed through Planner drift or provider timeout, so the overall count did not improve.
- `rg-009` and turn 1 of `rgs-020` each exhausted two OpenAI attempts at the exact configured 15-second boundary. `rg-028` also timed out once at 15 seconds before its second attempt succeeded. The active isolated repair raises only the finite test-only Planner attempt limit to 30 seconds while retaining two attempts and the existing retry categories.

## 2026-08-05 deployed acceptance run 31016215442

- Commit `1f8b19ed403fef19a672a491b96fdc291c301c51` passed the complete GitHub Actions verify job; Render health reported HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 66 PASS, 7 FAIL, and 4 non-executable cases. Artifact `8935106408` has digest `sha256:cc9e31b4d892b7efaa791f5294d42c077df1c022a781dbebd1360545ca5de5b8`.
- `rg-009` and turn 1 of `rgs-020` completed within the new bounded timeout; no OpenAI attempt timed out. `rg-001`, `rg-032`, and `rgs-007` also returned to PASS, while `rgs-017` regressed through a different duration span.
- Remaining FAIL cases are `rg-013`, `rg-038`, `rg-039`, `rg-051`, `rgs-017`, `rgs-019`, and `rgs-020`. `rgs-019` and the first turn of `rgs-020` use dates that are now in the past and correctly receive the controlled past-date FinalResponse; their expected room-scope assertions conflict with the current formal date policy and remain unchanged.
- The active isolated repair targets the Temporal Resolver boundary: recover a unique source-grounded range or duration from malformed Planner spans while preventing whole-message dates from crossing between multiple stay-dependent tasks.
