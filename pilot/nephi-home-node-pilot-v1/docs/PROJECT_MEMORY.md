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

## 2026-08-06 deployed acceptance run 31022352540

- Commit `1140e5040dd6825d5ba40fefc58fcc6a789cb68b` passed the complete GitHub Actions verify job; Render health reported `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 66 PASS, 1 partial-not-executable, 6 FAIL, and 4 non-executable cases across 77 cases / 90 turns. Artifact `8937651304` has verified digest `sha256:b59a7db7c9f186d6a1f50903cf8e2ff923ffadacd55ba9fb7cb8550f49679a35`.
- Remaining FAIL cases are `rg-001`, `rg-038`, `rg-051`, `rgs-007`, `rgs-019`, and `rgs-020`. `rg-013`, `rgs-017`, and both later turns in the multi-cycle modification cases passed this deployed run.
- In `rg-038` trace `a434a255-9b65-4e46-9ca8-96f8339a15aa`, OpenAI supplied the contained weekday span from an explicit month-plus-weekday request. Temporal recovery dropped the month, resolved `2026-08-08`, executed one PostgreSQL-backed availability plan, and incorrectly replied that the date was full.
- The active local repair makes the shared temporal grammar retain the broader month constraint and fail closed when it does not identify one date. Its production-entry RED/GREEN proves null CanonicalRequest and State dates, zero availability QueryPlans and provider calls, a clarification FinalDecision/FinalResponse, and continued execution of an independent property fact in the same turn. Full local `npm test` passes; deployment evidence is pending the single root-cause commit.

## 2026-08-06 deployed acceptance run 31034106516

- Commit `8f629189d94c035b0535f752deaec89182da1083` passed the complete GitHub Actions verify job. Render health returned HTTP 200, `ready`, `testOnly=true`, and that exact commit before the acceptance matrix began.
- The complete real OpenAI + PostgreSQL matrix produced 63 PASS, 1 partial-not-executable, 9 FAIL, and 4 non-executable cases across 77 cases / 90 turns. Private artifact `8942265827` has locally verified digest `sha256:438a1bee6909e72e1cf0d4fc0481972b84d228cc83248f21c2568a59ce2343fb`.
- The `rg-038` temporal root is fixed in deployed trace `71b65731-4a6b-4a2a-a555-91b8441a3b95`: CanonicalRequest is unresolved with `temporal_expression_ambiguous`, no check-in or checkout is present, State remains pending for both fields, availability QueryPlan and PostgreSQL query count are zero, FinalDecision is clarification, and FinalResponse is `請補充入住日期。`. The case remains FAIL only because its separate date-clarification capability expectation is not yet represented as another task.
- `rg-001` improved from FAIL to PASS. Four prior PASS cases regressed through different OpenAI task shapes before Temporal Resolver: `rg-028`, `rg-032`, `rg-037`, and `rgs-008`. Other FAIL cases are `rg-051`, `rgs-007`, `rgs-019`, and `rgs-020`; the last two retain the existing past-date versus scope expectation conflict.
- The active local compiler repair preserves controlled capabilities across contradictory Planner fields without scanning guest text. Provider-shaped RED reproduced four semantic losses; targeted compiler tests are 28/28, full Engine regressions pass, and a second complete local `npm test` passed in 416.5 seconds. Deployment evidence for this repair is pending its single root-cause commit.

## 2026-08-06 deployed acceptance run 31037333449

- Commit `22a07681a575a586fc4479085d06957b66ba307d` passed GitHub Actions verify job `92412647450`, including the complete remote `npm test`. Render returned HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 66 PASS, 7 FAIL, and 4 non-executable cases across 77 cases / 90 turns. Private artifact `8943541801` has locally verified digest `sha256:9f5877f8162491276ac147abc8b9933884dffebf7f5c543fae94d74a8bddf2c2`.
- `rg-037`, `rgs-007`, `rgs-008`, and `rgs-020` improved to PASS. `rg-001` regressed from the immediately prior artifact, while `rg-028` and `rg-032` remained older prior-PASS regressions. Other FAIL cases are `rg-038`, `rg-039`, `rg-051`, and `rgs-019`.
- `rg-038` retained the temporal safety fix in trace `e6e3827e-e16e-41b1-8604-1af5b5018cad`: ambiguous month-qualified weekday, null dates, zero QueryPlans, clarification FinalDecision, and `請補充入住日期。` FinalResponse. Its separate `date_clarification` capability expectation remains unmet.
- The active local shared repair normalizes policy restriction detail across availability/amenity shapes and permits one formal amenity/FAQ alias inside a verified Planner time-detail phrase. RED covered the `rg-001`, `rg-032`, and `rg-028` shapes; GREEN is 31/31 for Planner semantic contract and 5/5 for the production Engine suite, including formal 08:00-22:00 output plus ambiguous, unbound, and high-risk negative controls. Broad property, Planner, temporal, multi-cycle, and safety regressions pass; the complete local `npm test` passed in 448.5 seconds, followed by protected acceptance, Codex integrity, Constitution, runtime uniqueness 52/52, canonical golden, and `git diff --check`.

## 2026-08-06 deployed acceptance run 31040750260

- Commit `62bb3348f3db702abeda40c948873c245601a260` passed GitHub Actions verify job `92424200892`, including the complete remote `npm test`. Render returned HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 65 PASS, 8 FAIL, and 4 non-executable cases across 77 cases / 90 turns. Private artifact `8944853419` has GitHub and locally verified digest `sha256:8694e2e631c75f9a0d92d497bad5860095bbdf6f9d7b4065eac14760ffa671e2`.
- Compared with artifact `8943541801`, `rg-028` and `rg-032` changed to PASS, but prior-PASS `rg-014`, `rg-037`, and `rgs-020` regressed; `rg-001` remained FAIL. The `rg-028` PASS is not accepted as completion because trace `79a8df1a-39b6-43b1-9fa5-13e45644e83a` still failed to ground the formal singing FAQ and returned only an unrelated soundproofing handoff instead of the formal 08:00-22:00 hours.
- `rg-038` remained temporally safe in trace `edbacf51-87d8-4aff-8549-9f021116c96b`: ambiguous month-qualified weekday, empty CanonicalRequest and State dates, zero QueryPlans, clarification FinalDecision, and `請補充入住日期。` FinalResponse. Its separate date-clarification capability remains missing.
- The earliest new failure was `rg-014`: two same-message tasks were labeled `supplement_existing` with zero request-cycle references, causing strict context validation to reject all three tasks. A targeted RED/GREEN now normalizes only verified unreferenced supplements inside an explicitly new turn; continuations, referenced relations, invalid evidence, multi-cycle, and temporal boundaries remain fail closed. Planner semantic contract is 32/32, complete local `npm test` passed in 430.2 seconds, and all explicit safety gates pass. Deployment evidence is pending the single relation-recovery commit.

## 2026-08-06 deployed acceptance run 31043298051

- Commit `0932bcccf13dc92dcf8edb59ea5404b119916847` passed GitHub Actions verify job `92432622531`, including complete remote `npm test`. Render returned HTTP 200, `ready`, `testOnly=true`, and that exact commit.
- The complete real OpenAI + PostgreSQL matrix produced 66 PASS, 7 FAIL, and 4 non-executable cases across 77 cases / 90 turns. Private artifact `8945791121` has GitHub and locally verified digest `sha256:5ab03a03be65c17350f73de14c8386e05af23dfaf06c28245e62f7e486e95d03`.
- The relation root succeeded: `rg-014` returned to PASS, and `rg-001` plus `rg-037` also returned to PASS. `rg-032` and `rgs-007` became new prior-PASS regressions, while `rgs-020` remained the earlier scope regression. Other FAIL cases are `rg-038`, `rg-039`, `rg-051`, and `rgs-019`.
- `rg-032` trace `1ab75251-745a-4568-8c44-b13c0b16ae1f` changed the same common-space permission request to `amenity + general`; `rgs-007` trace `7b56cfb2-e6eb-4519-8190-786239079805` changed the same generic lodging-cost request to `policy + general`. Both shapes were schema-valid but lost an expected capability at the Planner layer, while previous runs classified the identical fixed inputs differently.
- The active local root sets only the real OpenAI Planner's supported sampling temperature to zero. RED proved the production request previously omitted this control; GREEN covers the exact request body and forbids simultaneous `top_p`. Provider observability, retry, failure safety, strict schema, adapter, complete local `npm test` in 452.6 seconds, and all explicit safety gates pass. Deployment evidence is pending its single provider-stability commit.

## 2026-08-06 deployed acceptance run 31045656667 and mandatory rollback

- Commit `cca314b339b061628efbd54e58121af93bab9695` passed verify job `92440410121`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact commit. The complete matrix artifact is `8946684391`, with GitHub and local digest `sha256:9063783fee772678cdf59e8d06abc877bfeaf953106a20f08c89cc1793b6abb6`.
- The result regressed to 63 PASS, 9 FAIL, 1 partial, and 4 non-executable cases across 77 cases / 90 turns. Compared with artifact `8945791121`, prior-PASS `rg-001`, `rg-006`, and `rg-037` became FAIL; `rg-039` only became partial-not-executable.
- The regressions were all Planner-layer semantic changes despite valid schema: `rg-001` became date-less availability, `rg-006` changed the named-room preference into policy, and `rg-037` changed total price into pool policy. The explicit `temperature: 0` override is therefore rejected and must be rolled back before further release repair.
- The next repair must use deterministic, source-evidenced shared compiler boundaries. It must not rely on repeated sampling, average score, Case IDs, exact guest sentences, modified expectations, or relaxed acceptance.

## 2026-08-06 rollback run 31047883614 and verified task-source detail root

- Rollback commit `a6cad4c25dcdf3ae8715e75394bdb6a86859e123` passed verify job `92447802780`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8947515401` has GitHub and local digest `sha256:658c8c3598f8cb1a7abdfbbe3cc81e130fe57dc9f6d74b1b6b886c4ac8f619e4`.
- The complete rollback matrix still produced 63 PASS, 9 FAIL, 1 partial, and 4 non-executable cases across 77 cases / 90 turns. `rg-006` recovered from the sampling run, but prior-PASS `rg-001`, `rg-028`, and `rg-037` were FAIL; this confirms provider-default sampling is also not a correctness boundary.
- `rg-028` trace `9a40f061-6f33-451b-a61b-daa0c40cdd59` emitted `availability + time` with an empty entity. CanonicalRequest incorrectly retained stay-dependent availability, created no formal singing answer, and FinalResponse contained only the unrelated soundproofing handoff.
- The active compiler root permits only the verified task source of a stateless time-detail candidate to recover one formal current-property fact and writes the exact matched mention into the normalized entity. RED/GREEN covers empty time detail, unverified source, multiple facts, unrelated non-empty entity, price preservation, complete-message general-source non-recovery, formal 08:00-22:00 Engine output, temporal fail-closed, and multi-cycle boundaries. The complete local `npm test` passed in 481.6 seconds, including OIDC 10/10, deployed contract 18/18, and matrix contract 8/8; protected acceptance 17/17, Codex integrity 36/36, Constitution, runtime uniqueness 52/52, canonical golden, and `git diff --check` also pass.

## 2026-08-06 deployed acceptance run 31050759163 and structured price grammar root

- Commit `a861e5a21231bfbc32f402a3849ea1ca5f697a7e` passed verify job `92457121074`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8948576835` has GitHub and locally verified digest `sha256:2ffe90b8e9b14b4db397e1d26b6b27b9a026b1c889628bd984daffbcfc37e92e`.
- The complete 77-case / 90-turn real OpenAI + PostgreSQL matrix produced 68 PASS, 5 FAIL, and 4 non-executable cases. There were no regressions against the stable 66-PASS artifact `8945791121`; `rg-032` and `rg-051` improved. `rg-028` trace `acd4b73e-b368-4a95-bde3-e0a351c17360` returned the formal singing-equipment answer including 08:00-22:00 and retained the independent soundproofing handoff.
- Remaining FAIL cases are `rg-038`, `rg-039`, `rgs-007`, `rgs-019`, and `rgs-020`. The first three fail at Planner capability coverage; the latter two fail at CanonicalRequest scope while past-date and ambiguity rejection remain correct.
- `rgs-007` was `price` and PASS in artifact `8944853419`, then became ungrounded `policy` in four consecutive complete artifacts through `8948576835`. The active root adds no question wording or alias: it defines monetary lodging price versus property policy in the OpenAI instructions and strict schema, couples price to its requested output and stay dependency, and requires semantic task-coverage self-checking. Targeted provider/schema/compiler/safety tests pass; temporal, past-date, relative weekday, date-range, multi-cycle, core-90, semantic, and matrix regressions pass; complete local `npm test` passed in 507.2 seconds with posttest OIDC 10/10, deployed contract 18/18, and matrix contract 8/8.

## 2026-08-06 deployed acceptance run 31052969756 and mandatory regression repair

- Commit `c3fc2e871d601cc9207f1ba4c4007f7c794d0859` passed verify job `92464180705`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8949414624` has GitHub and locally verified digest `sha256:75f10adc6a9414d65ca83f62cbfa43afda10988720a9e5149eea0807a69ea5f7`.
- The complete matrix produced 67 PASS, 6 FAIL, and 4 non-executable cases across 77 cases / 90 turns. `rgs-007` improved to PASS with canonical `price`, null dates, zero QueryPlans, clarification FinalDecision, and `請補充入住日期。`; however prior-PASS `rgs-009` and `rg-051` regressed, so this artifact is not an acceptable release result.
- `rgs-009` trace `a72abc27-0212-42a8-ac89-f5e515dbc96c` emitted the correct `price` type but combined `dependsOnStayContext:true` with `stayCandidate:null`, causing pre-compiler local contract rejection. `rg-051` trace `34231125-3470-438b-89ee-6438eb042120` changed sensitive access from high-risk `unknown` handoff to low-risk `policy`.
- The active regression repair projects the empty top-level stay only into a sole explicitly stay-dependent task and requires sensitive credential disclosure to remain `high_risk`. Targeted RED/GREEN proves stateless null preservation and multi-task non-projection; Planner adapter, failure safety, strict schema, semantic compiler, core-90, high-risk Engine, temporal, past-date, relative weekday, date-range, and multi-cycle regressions pass. Complete local `npm test` passed in 506.1 seconds with posttest OIDC 10/10, deployed contract 18/18, and matrix contract 8/8.

## 2026-08-06 deployed acceptance run 31054783967 and lodging-arrangement regression repair

- Commit `4844df1751452c5da01902828708b3328d58ba19` passed verify job `92469816441`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8950072765` has GitHub and locally verified digest `sha256:b8fe92fb8f1fa2a7d12a11d9baf1346b6e586ad69f82af4026807fc8b76ed9aa`.
- The complete 77-case / 90-turn matrix produced 68 PASS, 5 FAIL, and 4 non-executable cases. `rgs-007`, `rgs-009`, and `rg-051` retained their repaired price/high-risk behavior, but prior-PASS `rgs-017` regressed, so this artifact is not an acceptable release result.
- `rgs-017` trace `0a110dc5-1c1d-44f7-aa65-8cdcc916ab8a` emitted `unknown` even though CanonicalRequest recovered `duration_only`, `nights=2`, and `planner_temporal_span_recovered` from verified source evidence. The resulting human-handoff QueryPlan and FinalResponse lost the expected booking-process capability; the earliest failure remains Planner capability coverage.
- The active local root defines lodging reservation arrangement and booking-process semantics as `booking_request` in the real OpenAI instructions and strict schema, while duration alone cannot promote an unrelated task. Targeted RED/GREEN and Planner/schema/semantic/safety/temporal/past-date/relative-weekday/date-range/multi-cycle/golden regressions pass. Complete local `npm test` passed in 573.6 seconds with posttest OIDC 10/10, deployed contract 18/18, and matrix contract 8/8; protected acceptance 17/17, Codex integrity 36/36, Constitution, runtime uniqueness 52/52, and `git diff --check` also pass.

## 2026-08-06 deployed acceptance run 31056916745 and mandatory grammar rollback

- Commit `5279cf6fdba98d9e90b8b549d091ac6a52edb77b` passed verify job `92476291989`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8950851806` has GitHub and locally verified digest `sha256:db5aacf43f6cab0b05d56a5159eb20033accd9c47c3ff0e60707fbfdc6d6f390`.
- The complete 77-case / 90-turn matrix produced 66 PASS, 7 FAIL, and 4 non-executable cases. `rgs-017` improved to PASS, but prior-PASS `rg-007`, `rg-015`, and `rg-021` became FAIL. Prior-PASS turns also regressed at `rg-038` turn 2, `rgs-019` turn 2, and `rgs-020` turns 2 and 3.
- The `rgs-020` regressions demonstrate a safety loss: date modifications became stateless `booking_request` handoffs and FinalResponse stopped explicitly rejecting past dates. The artifact is rejected regardless of its isolated `rgs-017` improvement.
- The active worktree reverts the Planner and schema grammar change. The next acceptable `rgs-017` repair must use a deterministic, verified-source compiler boundary with non-lodging duration, policy, amenity, room-feature, context-relation, ambiguity, and past-date negative controls.

## 2026-08-06 rollback acceptance run 31058670756 and catalog-isolation experiment

- Rollback commit `32ff2fe1bf7ee80f444fa595ee7e2eb43ce627a1` passed verify job `92481635554`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8951474217` has verified digest `sha256:92dd21dfe489f723291f4340d9c40e5a7a144271cef013bbf7509f93d5efd4d8`.
- The complete matrix produced 67 PASS, 6 FAIL, and 4 non-executable cases. It recovered all seven turns regressed by artifact `8950851806`, but provider variance introduced two different prior-PASS regressions: `rg-024` trace `7779c1a0-02f7-4af1-ba8e-c256271fe1c9` and `rgs-018` trace `5c7ddf98-fd67-436d-a178-62af2f3d7b77`.
- Both traces attached a stateless property subject to `price`, which controlled price normalization erased. A deterministic compiler experiment isolated only verified current-event raw subjects, retained price readiness, prohibited early availability queries, preferred raw evidence over conflicting canonical candidates, and deduplicated unresolved subjects across categories. Local semantic contract reached 45/45, full Engine safety passed, and complete `npm test` passed in 564.2 seconds.

## 2026-08-06 deployed acceptance run 31062128940 and mandatory catalog-isolation rollback

- Commit `1f56c8c02d444513d80da727035f2d9c04288974` passed verify job `92492094876`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8952679740` has GitHub and locally verified digest `sha256:d17bf72e9dc2d638594554bfee6595ba526b24f70dd0799f7bd2c66f34d3a749`.
- The complete 77-case / 90-turn matrix produced 66 PASS, 7 FAIL, and 4 non-executable cases. Prior-PASS regressions versus artifact `8951474217` were `rg-007`, `rg-023`, `rg-036`, `rg-038` turn 2, and `rgs-020` turn 1; the first four also regressed versus stable artifact `8950072765`.
- `rg-024` trace `911d07a8-915c-4f47-b62f-c31e784a322c` and `rgs-018` trace `9b0a1514-49f3-4d42-83d6-5908ffd3732b` returned PASS, but neither target trace contained `stateful_inventory_catalog_task_isolation`. The repair executed only on `rgs-007`, `rgs-009`, and `rgs-012`, proving the target recovery was OpenAI sampling drift rather than the deployed code change.
- The artifact is rejected. The active worktree restores runtime and tests exactly to `32ff2fe1bf7ee80f444fa595ee7e2eb43ce627a1` while retaining this evidence; real LINE acceptance remains blocked.
- The exact rollback passed complete local `npm test` in 543.0 seconds with 3,883 output lines and exit 0; posttest OIDC was 10/10, deployed contract 18/18, and matrix contract 8/8.

## 2026-08-06 rollback acceptance run 31063654762 and duplicate-source root

- Rollback commit `7f9edf2a4ef6c055cf4bda0a67b03b625abfc0de` passed verify job `92496720488`; Render returned HTTP 200, `ready`, `testOnly=true`, and that exact SHA. Artifact `8953248983` has GitHub and locally verified digest `sha256:13830d0c25b81b2f139fc4c2fb6be07723dee2999b42d03655efe16e1baaf7b8`.
- The complete matrix produced 67 PASS, 1 partial-not-executable, 5 FAIL, and 4 non-executable cases. It recovered `rg-007`, `rg-023`, and `rg-039` turn 1 from rejected artifact `8952679740`, but prior-PASS `rg-022`, `rg-036`, and `rg-038` turn 2 remain regressed versus stable artifact `8950072765`.
- `rg-022` trace `1d682877-5c92-4a1c-8184-f6a580246775` formally resolved `pool` and executed only the property catalog, but raw matching selected a FAQ duplicate while the canonical candidate selected the structured subject. Semantic routing changed the policy-shaped seasonal task to generic `property_fact`, losing the accepted amenity/policy capability.
- Targeted RED reproduced the duplicate-source downgrade without a guest phrase. A review-discovered second RED proved that an otherwise non-inventory property fact with canonical ID `price` could inherit the stateful availability resolver. GREEN is property routing 19/19: same canonical IDs retain policy authority only through a compatible stateless `property_catalog` definition, conflicting IDs retain verified raw authority, and capability-ID collisions create neither an availability QueryPlan nor resolver call. Planner semantic 37/37, failure safety, canonical golden, temporal, multi-cycle, semantic core 35/35, and golden matrix 22/22 pass. Focused read-only review returned Ready with no Critical or Important finding.
- Complete local `npm test` on the final reviewed code passed in 725.3 seconds with 3,883 output lines and exit 0; posttest OIDC was 10/10, deployed contract 18/18, and matrix contract 8/8.
