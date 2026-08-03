# Codex Execution Integrity Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不部署、不接觸外部環境且不修改 Golden Matrix、Constitution 或既有核心 acceptance 的前提下，建立唯一權威的 Codex 執行規則、可執行反作弊 Gate，封閉已確認的 legacy LINE/provider 旁路，並取得乾淨 CI 與一次性獨立審查證據。

**Architecture:** Checkpoint A 只建立規則權威、兩層必讀入口、現況文件校正及 protection/integrity/canonical/uniqueness 保護。Checkpoint B 依「證據 → shared binding 測試遷移 → legacy 刪除 → provider fail-closed → canonical/uniqueness mutation → 完整本機驗證」的固定順序封口。Checkpoint C 只驗證 B 已落地的 workflow，在另行授權後建立 draft PR 與取得本次核心工作的獨立審查；任何階段都不部署。

**Tech Stack:** Node.js 24、CommonJS、`node:assert/strict`、`node:child_process.spawnSync`、Git、GitHub Actions、PostgreSQL 16 service、PGlite isolated tests、PowerShell/npm.cmd。

## Global Constraints

- 本計畫文件的核准不等於 Checkpoint A 實作授權；沒有使用者後續明確批准，不執行任何 A 檔案修改。
- 固定停點：Checkpoint A → 完成回報 → 等待使用者批准；Checkpoint B → 完成回報 → 等待使用者批准；Checkpoint C → 完成回報。
- 本次 A／B／C 中下列 immutable acceptance 檔案必須與基準 commit `5a7c018c4a409ec5b429fb191c1ad6ab84e47696` byte-identical：
  - `pilot/nephi-home-node-pilot-v1/docs/JUNZAN_AI_CONSTITUTION.md`
  - `pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md`
  - `pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json`
  - `pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js`
- 不修改 Golden Matrix 的案例、分類、預期結果或既有核心 acceptance assertion；若發現錯誤或矛盾，立即停止並回報，不在本工作修正。
- 未來只有使用者事前明確批准的獨立「驗收標準變更任務」可建立新基準；該任務不得同時修改 runtime，必須獨立審查並保存新舊案例、分類、預期結果與 hash 對照。本計畫不建立該任務或任何可供其重用的 bypass。
- 一般 unit test 可以明確 inject JSON test providers 或隔離模組；只有核心 acceptance、runtime component、signed webhook E2E 與真實 LINE 驗收可作為 production path 證據，且必須經 production entry point、provider selection、resolver、writer、FinalDecision、FinalResponse 與 transport。
- fixture、mock、PGlite、local HTTP 與 GitHub Actions PostgreSQL service 不得宣稱為真實 LINE、正式 PostgreSQL、Render 或 production runtime 證據。
- 禁止提交 bootstrap/update/skip/override/bypass；首次 manifest hash bootstrap 只能用一次性的本機命令輸出，不能留下 repository script 或可重用開關。
- 全程保留 `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`。本工作不得部署、merge、操作 Render、LINE Console、正式 PostgreSQL、credentials 或任何正式環境。
- 本計畫撰寫階段及 Checkpoint A/B 不 push、不建立 PR。Checkpoint C 的 push/draft PR 只有在 B 回報後取得使用者對 C 及該外部動作的明確批准才可執行；否則回報 `BLOCKED_C_EXTERNAL_AUTHORIZATION`。
- 不新增 approval platform、外部 audit service、大型 provenance 系統或所有小修改都要第二審查的流程。
- 所有檔案修改使用 `apply_patch`；每個 RED 必須先觀察到預期失敗原因，再寫 GREEN 實作。RED 若意外通過，停止並修正測試，不能繼續。
- 每個命令記錄工作目錄、stdout/stderr、exit code、測試分類與 HEAD；任何缺失標示 `UNPROVEN`。
- 除命令另有說明外，`node`/`npm.cmd` 命令從 `pilot/nephi-home-node-pilot-v1` 執行，所有 `git` 命令從 repository root 執行。
- 每個 checkbox step 都繼承其所在 Task 緊鄰列出的 RED、GREEN、Assertions、Test classification 與 completion evidence；步驟中的 `Expected` 是該步驟必須保存的實際證據，不是預測性成功聲明。

## File Responsibility Map

### Checkpoint A

- `AGENTS.md`: repository-wide 誠信與證據底線，指向子專案規則入口。
- `pilot/nephi-home-node-pilot-v1/AGENTS.md`: 強制先讀 `docs/RULES_INDEX.md`，不複製完整規則。
- `docs/RULES_INDEX.md`: 唯一的權威文件、責任、優先順序及 active/historical 索引。
- `docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md`: 十二項執行完整性規則、證據鏈、BLOCKED 與測試分類。
- `.github/protected-acceptance.json`: 精確 protected paths、固定 base commit 與 SHA-256 accepted baselines；不 self-hash。
- `scripts/verify-protected-acceptance.js`: 執行 manifest schema/path/hash/bypass 驗證。
- `tests/verify-protected-acceptance-runner.js`: protection Gate 的 positive、negative 與 mutation tests。
- `scripts/verify-codex-integrity.js`: 驗證兩層必讀、權威索引、必要 Gate/package/workflow 入口與 anti-skip 規則。
- `tests/verify-codex-integrity-runner.js`: Integrity Gate 的 fixture、negative 與 mutation tests。
- `docs/PROJECT_MEMORY.md`, `docs/NEXT_TASKS.md`, `docs/PRODUCT_BASELINE.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`: 各自唯一範圍的現況校正。
- `package.json`, `.github/workflows/codex-integrity.yml`: A 只串接 protection、integrity、canonical、uniqueness 與完整 suite；不引用 provider fail-closed。
- `.github/CODEOWNERS`: 只為 protected core/review workflow 提供 ownership 訊號，不宣稱 branch protection 已啟用。

### Checkpoint B

- `server.js`: 刪除 legacy query route/handler/wiring 與 unconditional return 後 dead runtime，只保留 shared binding webhook。
- `lib/test-line-webhook.js`: 在等價 shared-binding assertions 成立後刪除。
- `tests/helpers/property-scoped-line-webhook.js`: 測試專用 property binding、signature 與 HTTP request helper；不含產品判斷。
- `lib/providers/provider-factory.js`: production provider selection 缺少 DB 時 fail closed；不再 fallback JSON。
- `tests/provider-authority-fail-closed-runner.js`: factory/server/explicit test injection 與 fallback mutation assertions。
- `tests/canonical-request-golden-gate-runner.js`: 真正執行全部既定 child runners，核對本次 stdout marker 與 exit code。
- `tests/v2-runtime-uniqueness-runner.js`: 掃描完整 runtime 並逐一執行所有旁路 mutation。
- `scripts/verify-codex-integrity.js`, `tests/verify-codex-integrity-runner.js`, `package.json`, `.github/workflows/codex-integrity.yml`: B 才加入 provider fail-closed 必要入口與 isolated PostgreSQL service assertions。
- `.github/protected-acceptance.json`: 只更新本規格批准變更的 Gate/workflow hash；immutable acceptance hash 不變。

### Checkpoint C

- 原則上沒有新產品檔案。只執行乾淨 worktree/CI、draft PR metadata 與獨立審查；若發現問題，回到 A/B 對應任務修正後重跑 C。

---

## Checkpoint A — Rules, Required Entry Points, Status Correction, Acceptance Protection

### Task A0: Capture immutable and dirty-worktree baselines

**Files:**
- Read only: all files under Global Constraints immutable list
- Read only: `server.js`, `lib/providers/provider-factory.js`, `package.json`, `.github/workflows/codex-integrity.yml`

**Interfaces:**
- Consumes: base commit `5a7c018c4a409ec5b429fb191c1ad6ab84e47696`
- Produces: recorded base blob IDs, current HEAD, clean status, known legacy/provider RED evidence for later tasks

**RED:** Current source must demonstrate the defects this plan is meant to close: `/api/test-line/webhook`, the legacy marker, JSON fallback, canonical Gate that does not spawn children, and uniqueness mutations defined but not all executed.

**GREEN:** Not performed in A0. The evidence is retained for comparison; later tasks must remove each RED without changing immutable acceptance blobs.

**Assertion:** Every baseline command addresses the exact worktree and base commit; no generated result is described as runtime success.

**Test classification:** `RECORDED_REPRODUCTION`（static source audit and Git object evidence）.

- [ ] **Step 1: Record branch, HEAD, status and immutable blob IDs**

Run from repository root:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git rev-parse 5a7c018c4a409ec5b429fb191c1ad6ab84e47696:pilot/nephi-home-node-pilot-v1/docs/JUNZAN_AI_CONSTITUTION.md
git rev-parse 5a7c018c4a409ec5b429fb191c1ad6ab84e47696:pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md
git rev-parse 5a7c018c4a409ec5b429fb191c1ad6ab84e47696:pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json
git rev-parse 5a7c018c4a409ec5b429fb191c1ad6ab84e47696:pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js
git rev-parse 5a7c018c4a409ec5b429fb191c1ad6ab84e47696:pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js
```

Expected evidence: branch `codex/execution-integrity-rules`; exact HEAD recorded; no unrelated worktree changes; five non-empty blob IDs.

- [ ] **Step 2: Record the known RED conditions**

```powershell
rg -n "TEST_LINE_WEBHOOK_ROUTE|/api/test-line/webhook|legacy runtime kept|lineWebhookHandler|pushToTestLine" pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/lib pilot/nephi-home-node-pilot-v1/tests tests
rg -n "if\(!databaseUrl\).*createJsonProviders|if \(!databaseUrl\).*createJsonProviders" pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js
rg -n "spawnSync|RUNNERS|injectedMutation|second_runtime|second_final_renderer" pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js
```

Expected RED evidence: legacy route/handler/dead runtime and JSON fallback are found; canonical Gate has a RUNNERS list but does not execute each child; uniqueness defines mutations that are absent from its executed mutation loop.

- [ ] **Step 3: Do not commit**

This task is evidence-only. Preserve output for the Checkpoint A report; make no repository change.

### Task A1: Build the acceptance-protection Gate with TDD

**Files:**
- Create: `pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js`
- Create: `pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js`

**Interfaces:**
- Produces CLI: `node scripts/verify-protected-acceptance.js [--root <repo-root>]`
- Produces functions inside the script: `sha256File(filePath) -> lowercase hex`, `validateManifest(manifest) -> string[]`, `verifyProtectedAcceptance(root, manifest) -> string[]`
- Manifest schema: `{ schemaVersion: 1, baselineCommit: "5a7c018c4a409ec5b429fb191c1ad6ab84e47696", protectedPaths: string[], protectedFiles: [{ path, sha256, baseline }], manifestControl: { selfHash: false } }`.
- `baseline` is exactly `immutable` or `accepted-current`; manifest path appears in `protectedPaths` but is excluded from `protectedFiles`, so it has no self-hash.

**RED:** The new runner is written first and exits non-zero because the Gate script and manifest do not exist.

**GREEN:** Temp-repository valid fixture exits 0; missing/modified protected files, Golden mutation, duplicate/glob paths, self-hash, bypass flags and forced success all exit 1; an added ordinary unit test remains accepted. The real repository manifest is intentionally created only after A2/A3/A4 content is final.

**Assertions:**
- Protected path set is exactly the approved list, not `tests/**`.
- Golden/core `baseline: immutable` hashes equal base content.
- `--bootstrap`, `--update`, `--skip`, `CODEX_ACCEPTANCE_OVERRIDE`, branch/SHA allowlists and forced `process.exit(0)` never produce GREEN.
- Failures print `INTEGRITY_FAILURE` and set exit code 1.

**Test classification:** `STRUCTURED_CONTRACT_TEST`（static acceptance protection and integrity mutations）.

- [ ] **Step 1: Write the failing runner**

Create `tests/verify-protected-acceptance-runner.js` using `node:assert/strict`, `fs`, `os`, `path`, `crypto`, and `spawnSync`. Define:

```js
const APPROVED_PATHS = Object.freeze([
  "pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md",
  "pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json",
  "pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js",
  "pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js",
  "pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js",
  "pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js",
  "pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js",
  ".github/workflows/codex-integrity.yml",
  ".github/protected-acceptance.json",
  ".github/CODEOWNERS"
]);
const MANIFEST_PATH = ".github/protected-acceptance.json";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "protected-acceptance-"));
  const protectedFiles = [];
  for (const relativePath of APPROVED_PATHS.filter((item) => item !== MANIFEST_PATH)) {
    const content = `fixture:${relativePath}\n`;
    writeFile(root, relativePath, content);
    protectedFiles.push({
      path: relativePath,
      sha256: sha256(content),
      baseline: relativePath.includes("golden-acceptance") || relativePath.includes("CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE") || relativePath.includes("first-version-acceptance-matrix")
        ? "immutable"
        : "accepted-current"
    });
  }
  const manifest = {
    schemaVersion: 1,
    baselineCommit: "5a7c018c4a409ec5b429fb191c1ad6ab84e47696",
    protectedPaths: [...APPROVED_PATHS],
    protectedFiles,
    manifestControl: { selfHash: false }
  };
  if (typeof options.mutateManifest === "function") options.mutateManifest(manifest);
  writeFile(root, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.afterManifest) options.afterManifest(root);
  return root;
}

function runGate(root, args = [], env = {}) {
  return spawnSync(process.execPath, [gatePath, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function expectsPass(root, label) {
  const result = runGate(root);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /PASS protected-acceptance/);
}

function expectsFailure(root, label, args = [], env = {}) {
  const result = runGate(root, args, env);
  assert.equal(result.status, 1, `${label} must exit 1`);
  assert.match(result.stderr, /INTEGRITY_FAILURE/);
}
```

Add named cases for: valid manifest, missing protected file, changed protected file, changed Golden expected value, duplicate path, glob path, directory path, manifest self-hash entry, `--bootstrap`, `--update`, `--skip`, override environment, forced-success source, and unrelated `tests/new-unit-runner.js` addition.

- [ ] **Step 2: Run RED**

```powershell
node tests/verify-protected-acceptance-runner.js
```

Expected: non-zero because `scripts/verify-protected-acceptance.js` is absent. Record the exact missing-module failure; an assertion typo is not an acceptable RED.

- [ ] **Step 3: Implement the minimal Gate and fixture manifest schema**

Create `scripts/verify-protected-acceptance.js` with the three interfaces above. It must reject unknown CLI arguments before reading the manifest, use `fs.statSync(...).isFile()`, reject `*`, `?`, `..`, absolute paths and duplicate normalized paths, compare SHA-256 with `crypto.timingSafeEqual`, and print every concrete mismatch.

The runner's temp fixture manifest must use exactly these paths; Task A4 creates the real repository manifest after all A protected content is final:

```text
pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md
pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json
pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js
pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js
pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js
pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js
pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js
pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js
pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js
pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js
.github/workflows/codex-integrity.yml
.github/protected-acceptance.json
.github/CODEOWNERS
```

- [ ] **Step 4: Run GREEN and mutation cases**

```powershell
node tests/verify-protected-acceptance-runner.js
```

Expected: exit 0; runner output enumerates every case with zero failures.

- [ ] **Step 5: Commit A1**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js
git commit -m "test: add protected acceptance integrity gate"
```

Completion evidence: RED and GREEN outputs, case count, commit hash, and diff limited to the two files.

### Task A2: Establish authority documents and two-layer required reading

**Files:**
- Create: `pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md`
- Create: `pilot/nephi-home-node-pilot-v1/docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md`
- Modify: `AGENTS.md`
- Modify: `pilot/nephi-home-node-pilot-v1/AGENTS.md`
- Modify: `pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js`
- Modify: `pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js`

**Interfaces:**
- `RULES_INDEX.md`: columns `Authority`, `Scope`, `Status`, `Supersedes/Conflict action`; exactly one active authority per scope.
- `CODEX_EXECUTION_INTEGRITY_CONTRACT.md`: headings for anti-fabrication, same-path scope, forbidden shortcuts, acceptance immutability, complete delivery, bypass closure, evidence chain, BLOCKED, independent review and non-goals.
- Integrity Gate functions remain `readText`, `findSourceFiles`, `verify(root) -> string[]`; extend `verify` rather than adding a second gate.

**RED:** Extend the Integrity runner fixtures first so the current Gate fails to reject missing descendant AGENTS, RULES_INDEX, contract, duplicate authority scope and missing required links.

**GREEN:** Valid fixture and repository pass structural authority checks; each invalid fixture exits 1 with `INTEGRITY_FAILURE`.

**Assertions:**
- Both AGENTS files point to `docs/RULES_INDEX.md` before other project docs.
- Index maps one unique owner per scope without copying full rules.
- Contract contains all twelve approved invariants and the unit/runtime evidence boundary.
- Conflicting same-level authority produces failure, not precedence guessing.

**Test classification:** `STRUCTURED_CONTRACT_TEST`（policy structure and integrity mutations）; no claim of runtime behavior.

- [ ] **Step 1: Add failing Integrity fixtures**

Extend `createFixture(options)` to create root and descendant `AGENTS.md`, `docs/RULES_INDEX.md`, and `docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md`. Add negative cases for each missing file/link and duplicate active scope.

- [ ] **Step 2: Run RED**

```powershell
node tests/verify-codex-integrity-runner.js
```

Expected: non-zero because current `verify(root)` does not inspect descendant AGENTS/index/contract.

- [ ] **Step 3: Write the two authority documents and minimal AGENTS entries**

`RULES_INDEX.md` must contain only the precedence and responsibility table approved in the design spec. `CODEX_EXECUTION_INTEGRITY_CONTRACT.md` must contain the twelve invariants and exact evidence classifications. Root AGENTS adds the project RULES_INDEX as the required entry; descendant AGENTS changes its first required read to `docs/RULES_INDEX.md` and lets the index route the remaining documents.

- [ ] **Step 4: Extend `verify(root)` for authority structure**

Add exact file existence, link resolution, one-active-authority-per-scope and contract heading assertions. Package/workflow Gate-entry assertions are added only in Task A4 after those entries exist; provider fail-closed remains absent from A.

- [ ] **Step 5: Run GREEN**

```powershell
node tests/verify-codex-integrity-runner.js
node scripts/verify-codex-integrity.js
```

Expected: both exit 0; negative cases still demonstrate exit 1 internally.

- [ ] **Step 6: Commit A2**

```powershell
git add -- AGENTS.md pilot/nephi-home-node-pilot-v1/AGENTS.md pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md pilot/nephi-home-node-pilot-v1/docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js
git commit -m "docs: establish Codex execution authority"
```

### Task A3: Correct current-state documents without rewriting history

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md`
- Modify: `pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md`
- Modify: `pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md`
- Modify: `pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md`
- Modify: `pilot/nephi-home-node-pilot-v1/docs/SECURITY.md`

**Interfaces:**
- PROJECT_MEMORY = current proven facts, known limitations and current blockers only.
- NEXT_TASKS = unfinished ordered queue only.
- PRODUCT_BASELINE = accepted behavior with local/external evidence labels.
- DECISIONS = original decision content plus unique-ID crosswalk and `active/superseded` status.
- SECURITY = active credential/binding boundary and deployment blocker; no active legacy exception.

**RED:** A document audit finds duplicated `D-011/D-012/D-013`, unnumbered decisions, completed-history sections in NEXT_TASKS, repeated historical logs in PROJECT_MEMORY, and unproven external completion/deployment wording.

**GREEN:** Each file owns only its declared scope; every external claim is evidenced or labeled `UNPROVEN/BLOCKED`; duplicate decision IDs have a traceable crosswalk without changing original decision bodies.

**Assertions:**
- Preserve original decision title/date/body verbatim in a historical-record section.
- Use this exact normalization without renumbering existing unique D-001–D-024 entries:
  - old `D-011：FinalDecision 是最終回覆 action 與內容的共同權威` → `D-025`, `active`, refines D-011.
  - old `D-012 — Planner failure diagnostics are allowlisted and behavior-neutral` → `D-026`, `active`.
  - old `D-013 — Canonical Temporal Authority owns executable dates` → `D-027`, `active`, refines the semantic contract in D-013.
  - `2026-07-28 — Property-neutral runtime data authority` → `D-028`, `active`.
  - `2026-07-29 — Onboarding intake starts from a scoped invitation` → `D-029`, `active`.
  - `2026-07-29 — Test-only onboarding URLs are deployment-scoped` → `D-030`, `active`.
  - `2026-07-29 — One-time property-scoped LINE setup authority` → `D-031`, `active`.
- Mark every existing D-001–D-024 entry `active` unless its own preserved text contains an explicit supersession; record D-011 as `active; refined by D-025`. Do not invent a superseded status merely to populate the field.
- Historical files may retain old references only when crosswalk resolves them.
- Keep `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION` explicit.

**Test classification:** `RECORDED_REPRODUCTION`（document-state diff audit）; human prose is not misrepresented as runtime test.

- [ ] **Step 1: Capture RED document audit**

```powershell
rg -n "^## D-011|^## D-012|^## D-013|^## 2026-|已完成|已部署|目前沒有.*blocker|真實.*完成" pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md pilot/nephi-home-node-pilot-v1/docs/SECURITY.md
```

Expected RED: duplicate IDs, history in the active queue/memory, and claims needing evidence classification are found.

- [ ] **Step 2: Correct PROJECT_MEMORY, NEXT_TASKS and PRODUCT_BASELINE**

Retain only current facts and direct links. Move no content into a new archive. Mark real LINE migration/real external acceptance/deployment claims `UNPROVEN` unless repository evidence supports them; keep the LINE binding deployment blocker.

- [ ] **Step 3: Build the DECISIONS crosswalk**

Keep original bodies and apply the exact D-025–D-031 mapping above. Add a crosswalk keyed by old heading plus date/title, set the recorded statuses, and update references only in current authority files. Do not rewrite historical references without the crosswalk.

- [ ] **Step 4: Remove the active SECURITY legacy exception**

Replace the exception that leaves the legacy test-only webhook unaffected with the binding requirement and deployment-blocked state. Do not state that credentials or LINE Console have been migrated.

- [ ] **Step 5: Run GREEN document audit and diff review**

```powershell
rg -n "^## D-[0-9]+" pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md
rg -n "active|superseded|舊.*新|UNPROVEN|BLOCKED|DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION" pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md pilot/nephi-home-node-pilot-v1/docs/SECURITY.md
git diff --check
git diff -- pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md pilot/nephi-home-node-pilot-v1/docs/SECURITY.md
```

Expected: unique current IDs, complete crosswalk, explicit states/blocker, no whitespace error; reviewer manually confirms original decision bodies remain traceable.

- [ ] **Step 6: Commit A3**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/docs/PROJECT_MEMORY.md pilot/nephi-home-node-pilot-v1/docs/NEXT_TASKS.md pilot/nephi-home-node-pilot-v1/docs/PRODUCT_BASELINE.md pilot/nephi-home-node-pilot-v1/docs/DECISIONS.md pilot/nephi-home-node-pilot-v1/docs/SECURITY.md
git commit -m "docs: correct authoritative project status"
```

### Task A4: Wire the A-only Gate set and finalize protected hashes

**Files:**
- Create: `.github/protected-acceptance.json`
- Create: `.github/CODEOWNERS`
- Modify: `pilot/nephi-home-node-pilot-v1/package.json`
- Modify: `.github/workflows/codex-integrity.yml`
- Modify: `.github/protected-acceptance.json`
- Modify as test-first requirement demands: `scripts/verify-codex-integrity.js`, `tests/verify-codex-integrity-runner.js`

**Interfaces:**
- Add package scripts:
  - `verify:protected-acceptance`: `node scripts/verify-protected-acceptance.js`
  - `test:canonical-golden`: `node tests/canonical-request-golden-gate-runner.js`
  - `test:runtime-uniqueness`: `node tests/v2-runtime-uniqueness-runner.js`
- A workflow order: `npm ci` → protection → integrity runner/Gate → canonical → uniqueness → existing complete suites.
- Provider fail-closed script is explicitly absent from A required list.

**RED:** Integrity fixture and repository Gate fail when any A script/workflow command is absent or skipped; protection Gate fails until accepted-current hashes are inserted.

**GREEN:** All four A Gate entry points execute; ordinary test addition is allowed; manifest hashes pass; provider fail-closed is not referenced.

**Assertions:** No `continue-on-error`; no conditional exclusion; no reusable hash update command committed; package.json itself is not whole-file hash-protected.

**Test classification:** `STRUCTURED_CONTRACT_TEST`（CI structure and integrity mutations）; canonical/uniqueness child results retain their own declared classifications.

- [ ] **Step 1: Extend RED fixtures for exact A package/workflow commands**

Add negative fixture cases for missing protection, canonical and uniqueness package scripts; workflow omitting each command; workflow containing `continue-on-error`; and premature provider fail-closed requirement.

- [ ] **Step 2: Run RED**

```powershell
node tests/verify-codex-integrity-runner.js
```

Expected: non-zero until package/workflow implement the A-only contract.

- [ ] **Step 3: Add A scripts and workflow steps**

Create `.github/CODEOWNERS` with explicit entries for the approved protected paths and owner `@gqlikjguo-web`; do not add a repository-wide wildcard. Create the real `.github/protected-acceptance.json` with the exact Task A1 schema/path set. Modify package/workflow exactly as the Interfaces block. Extend Integrity Gate/runner with failing fixtures and then the A-only package/workflow assertions. Retain Node 24, clean checkout, `npm ci`, existing PostgreSQL service and complete tests. Do not add provider fail-closed execution yet.

- [ ] **Step 4: Perform the one-time non-committed hash bootstrap**

From repository root, run this local command once and manually apply its output to `.github/protected-acceptance.json` using `apply_patch`; do not save the command as a repository script:

```powershell
$protected = @(
  'pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md',
  'pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json',
  'pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js',
  'pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js',
  'pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js',
  'pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js',
  'pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js',
  'pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js',
  'pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js',
  'pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js',
  '.github/workflows/codex-integrity.yml',
  '.github/CODEOWNERS'
)
$protected | ForEach-Object { "$($_) $((Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant())" }
```

Mark the five immutable paths as `immutable`; all other hashed entries as `accepted-current`. Do not add a hash for the manifest itself.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd run verify:protected-acceptance
node tests/verify-protected-acceptance-runner.js
npm.cmd run verify:codex-integrity
node tests/verify-codex-integrity-runner.js
npm.cmd run test:canonical-golden
npm.cmd run test:runtime-uniqueness
```

Expected: every command exit 0. Evidence states canonical/uniqueness are their current A versions, not yet the B-strengthened versions.

- [ ] **Step 6: Commit A4**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/package.json .github/workflows/codex-integrity.yml .github/protected-acceptance.json .github/CODEOWNERS pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js
git commit -m "ci: enforce checkpoint A integrity gates"
```

### Task A5: Verify and report Checkpoint A, then stop

**Files:**
- Modify: none
- Evidence source: A commits and command output

**RED:** Any dirty file outside A scope, immutable blob difference, failed Gate, skipped test, premature provider Gate, or missing document crosswalk prevents A completion.

**GREEN:** All A commands exit 0; only A files changed; immutable blobs match base; no external action occurred.

**Assertions:** Checkpoint B files (`server.js`, provider factory, LINE tests, canonical/uniqueness implementation beyond A baselines) remain unchanged.

**Test classification:** `STRUCTURED_CONTRACT_TEST` for policy/integrity; complete-suite classifications reported per runner using the repository classification list.

- [ ] **Step 1: Run full local A verification**

```powershell
npm.cmd run verify:protected-acceptance
node tests/verify-protected-acceptance-runner.js
npm.cmd run verify:codex-integrity
node tests/verify-codex-integrity-runner.js
npm.cmd run test:canonical-golden
npm.cmd run test:runtime-uniqueness
npm.cmd test
```

- [ ] **Step 2: Prove immutable files and scope**

```powershell
git diff --exit-code 5a7c018c4a409ec5b429fb191c1ad6ab84e47696 -- pilot/nephi-home-node-pilot-v1/docs/JUNZAN_AI_CONSTITUTION.md pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js
git diff --check 6cb7291f4402d674ee7c31f6d49603deb7dddbdf..HEAD
git diff --name-status 6cb7291f4402d674ee7c31f6d49603deb7dddbdf..HEAD
git status --short --branch
```

- [ ] **Step 3: Report A and stop**

Report original requirements, base/HEAD, file responsibility, commands/assertions/classifications/exit codes, immutable hashes, diff review, no external actions, and all `UNPROVEN/BLOCKED` items. Explicitly state `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`.

**Mandatory stop:** Do not begin Task B0 until the user explicitly approves Checkpoint B.

---

## Checkpoint B — Close Bypasses, Strengthen Gates, Fail Closed

### Task B0: Re-prove references and the active runtime before deletion

**Files:**
- Read only: `pilot/nephi-home-node-pilot-v1/server.js`
- Read only: `pilot/nephi-home-node-pilot-v1/lib/test-line-webhook.js`
- Read only: all `pilot/nephi-home-node-pilot-v1/tests/**` and repository `tests/**` references
- Read only: `pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js`

**Interfaces:**
- Produces evidence tables for active route/handler/wiring, exports, test imports, shared-binding replacement and provider fallback consumers.

**RED:** Active source still contains the old route/handler; dead code exists after the first unconditional `return app;`; tests import/use the legacy helper; provider factory selects JSON when `databaseUrl` is empty.

**GREEN:** Not claimed in B0. B0 proves exact deletion/migration targets and stops if actual references differ materially from this plan.

**Assertions:**
- Separate active code from code after unconditional return.
- Confirm `module.exports` does not export `lineWebhookHandler`.
- Confirm shared `/api/line/webhooks/<webhookKey>` route, binding resolver, signature verification and four property-binding runners exist before deletion.
- Enumerate every `createApp` call without explicit providers; do not rely on fallback after Task B3.

**Test classification:** `RECORDED_REPRODUCTION`（static call-chain and reference evidence）.

- [ ] **Step 1: Prove active route/handler/wiring and dead boundary**

```powershell
rg -n "function createRequestHandler|TEST_LINE_WEBHOOK_ROUTE|lineWebhookHandler|sharedLineWebhookHandler|http\.createServer|return app|legacy runtime kept|module\.exports" pilot/nephi-home-node-pilot-v1/server.js
```

Expected RED: old route at request dispatch, active `lineWebhookHandler`, shared handler, handler injection, one unconditional `return app;`, then legacy marker/dead block, and only `createApp`/trace formatter exports.

- [ ] **Step 2: Enumerate all runtime and test references**

```powershell
rg -n "api/test-line/webhook|TEST_LINE_WEBHOOK_ROUTE|lineWebhookHandler|lib/test-line-webhook|verifyTestLineSignature|replyToTestLine|pushToTestLine|createFetchBackedLineClientFactory" pilot/nephi-home-node-pilot-v1 tests
rg -n "api/line/webhooks|createLineBindingService|getLineBindingByWebhookKey|property-line-binding" pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/lib pilot/nephi-home-node-pilot-v1/tests
```

Record every result in the B report evidence table. If an unlisted active import/export or alternate entry point is found, stop with `BLOCKED_LEGACY_ROUTE_REMOVAL` and amend the plan before deletion.

- [ ] **Step 3: Prove shared replacement tests exist and currently pass**

```powershell
node tests/property-line-binding-runner.js
node tests/property-line-binding-postgres-runner.js
node tests/property-line-binding-postgres-webhook-runner.js
node tests/property-line-setup-runner.js
```

Expected: each exit 0. Classification is `RUNTIME_COMPONENT_TEST` for HTTP/shared production entry-point cases and `ISOLATED_POSTGRESQL_PROVIDER` for PGlite; not REAL_LINE or REAL_POSTGRESQL_PROVIDER.

- [ ] **Step 4: Audit provider fallback consumers**

```powershell
rg -n "createApp\(" pilot/nephi-home-node-pilot-v1/tests tests
rg -n "createProviders\(|createJsonProviders\(" pilot/nephi-home-node-pilot-v1/tests tests pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js
```

Expected RED: factory JSON fallback and `createApp` tests that rely on `dataFile/seedFile` without explicit providers.

- [ ] **Step 5: Do not commit**

This task is evidence-only and creates no approval gate beyond the existing Checkpoint B approval.

### Task B1: Create the property-scoped webhook test helper and migrate direct legacy tests

**Files:**
- Create: `pilot/nephi-home-node-pilot-v1/tests/helpers/property-scoped-line-webhook.js`
- Modify: `pilot/nephi-home-node-pilot-v1/tests/test-line-official-adapter-runner.js`
- Modify direct project webhook tests:
  - `tests/answered-claim-contract-runner.js`
  - `tests/first-version-controlled-core-runner.js`
  - `tests/junzan-test-line-gateway-runner.js`
  - `tests/line-channel-identity-guard-runner.js`
  - `tests/location-google-maps-runner.js`
  - `tests/phase6-transport-e2e-runner.js`
  - `tests/phase7-final-response-e2e-runner.js`
  - `tests/planner-failure-safety-runner.js`
  - `tests/relative-date-availability-runner.js`
  - `tests/test-only-line-message-trace-http-runner.js`
- Modify direct repository-root webhook tests:
  - `../../tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-test-line-chain-runner.ps1`
- Modify legacy chain URL/configuration scripts discovered by the B0 reference audit:
  - `scripts/test-line-chain-common.psm1`
  - `scripts/start-test-line-pilot.ps1`
  - `scripts/start-test-line-pilot-with-tunnel.ps1`
- Audit only; modify only if the repeated B0 search finds a direct legacy route/helper dependency:
  - `../../tests/pilot-nephi-home-node-pilot-v1-nephi-faq-runtime-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-nephi-property-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-optional-room-type-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-precise-clarification-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-query-mode-dedupe-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-room-filter-state-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-single-date-default-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js`
  - `../../tests/pilot-nephi-home-node-pilot-v1-trailing-flush-runner.js`

**Interfaces:**
- `createMemoryLineBindingProvider() -> LineBindingProvider test double` implementing get/upsert/enable/observed/valid methods used by production `createLineBindingService`.
- `attachPropertyScopedLineBinding({ providers, propertyId, channelSecret, channelAccessToken, encryptionKey?, enabled? }) -> { binding, bindingService, lineBindingEnv, route, sign(rawBody), post(baseUrl, rawBody, signature?) }`.
- `post` always targets `/api/line/webhooks/${binding.webhookKey}` and never accepts caller-controlled property/customer query parameters.

**RED:** Change `test-line-official-adapter-runner.js` to import the new helper and assert shared-binding signature/reply/property behavior before creating the helper; runner fails with missing module.

**GREEN:** All listed direct webhook tests use the shared binding route and explicit test providers while retaining their original behavior assertions; official adapter assertions no longer import the legacy helper.

**Assertions:**
- Bound property comes only from webhook key lookup, not payload/query.
- Correct binding secret succeeds; wrong secret 401; unknown/disabled binding 404; none executes planner/reply.
- Reply uses the bound property's access token.
- FinalDecision/FinalResponse/transport success and failure assertions remain unchanged in meaning.
- Test helper contains setup/transport mechanics only; no intent, answer, resolver, FinalDecision or FinalResponse logic.
- Test-line start scripts no longer require global LINE secret/token or compose a caller-controlled property route. They require `DATABASE_URL`, `JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY`, and `NEPHI_PILOT_LINE_WEBHOOK_KEY`, and only display `/api/line/webhooks/<webhookKey>`. Their execution remains deployment-blocked until the real test-only binding migration is separately completed.

**Test classification:** `UNIT_TEST` for the helper and `RUNTIME_COMPONENT_TEST`/`FAKE_INTEGRATION` for signed local webhook with fake LINE client; explicitly not `REAL_LINE`.

- [ ] **Step 1: Write the RED official-adapter test**

Replace legacy helper imports with the desired helper interface. The test must build explicit JSON providers, bind a property, start `createApp({ providers, lineBindingEnv, ... })`, post a signed webhook and assert the production shared handler selects the binding and calls the reply client.

- [ ] **Step 2: Run RED**

```powershell
node tests/test-line-official-adapter-runner.js
```

Expected: non-zero with missing `tests/helpers/property-scoped-line-webhook.js`.

- [ ] **Step 3: Implement the minimal test helper**

The helper must delegate encryption/storage/status behavior to `createLineBindingService`; it may provide only an in-memory binding provider and HMAC/request utilities. It must not copy server handler logic or validate expected replies itself.

- [ ] **Step 4: Run first GREEN**

```powershell
node tests/test-line-official-adapter-runner.js
```

Expected: exit 0 with signature, binding identity and reply assertions executed through `createApp` and the shared route.

- [ ] **Step 5: Migrate project webhook tests in small batches**

For each file, explicitly create/inject `createJsonProviders({ dataFile, seedFile, now })` when it does not already inject providers, call `attachPropertyScopedLineBinding`, pass `lineBindingEnv`, and replace only the route/signature setup. Preserve every existing business assertion.

Batch 1 commands:

```powershell
node tests/answered-claim-contract-runner.js
node tests/first-version-controlled-core-runner.js
node tests/junzan-test-line-gateway-runner.js
node tests/line-channel-identity-guard-runner.js
node tests/location-google-maps-runner.js
```

Batch 2 commands:

```powershell
node tests/phase6-transport-e2e-runner.js
node tests/phase7-final-response-e2e-runner.js
node tests/planner-failure-safety-runner.js
node tests/relative-date-availability-runner.js
node tests/test-only-line-message-trace-http-runner.js
```

Expected: each command exit 0. If a changed test loses an assertion count/marker, restore it before continuing.

- [ ] **Step 6: Migrate repository-root direct webhook tests**

First update `Get-TestLineWebhookUrl` to accept `-WebhookKey` and return `/api/line/webhooks/<escaped webhook key>`. Update both start scripts to require the database, binding-encryption and webhook-key inputs instead of global LINE credentials; do not run either tunnel-start script in this task. Update the PowerShell runner's static/missing-environment assertions accordingly.

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ../../tests/pilot-nephi-home-node-pilot-v1-test-line-chain-runner.ps1
```

Expected: each exit 0 and uses the shared route. The PowerShell runner's expected webhook URL becomes `/api/line/webhooks/<webhookKey>` supplied by its setup, not a hard-coded tunnel URL or `customerId` query.

- [ ] **Step 7: Re-run the reference audit**

```powershell
rg -n "api/test-line/webhook|lib/test-line-webhook|verifyTestLineSignature|replyToTestLine|pushToTestLine" pilot/nephi-home-node-pilot-v1/tests tests
```

Expected before deletion: no test dependency remains; only production legacy source and historical/non-executable explanation may remain. Any test hit must be migrated before B2.

- [ ] **Step 8: Commit B1**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/tests/helpers/property-scoped-line-webhook.js pilot/nephi-home-node-pilot-v1/tests/test-line-official-adapter-runner.js pilot/nephi-home-node-pilot-v1/tests/answered-claim-contract-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-controlled-core-runner.js pilot/nephi-home-node-pilot-v1/tests/junzan-test-line-gateway-runner.js pilot/nephi-home-node-pilot-v1/tests/line-channel-identity-guard-runner.js pilot/nephi-home-node-pilot-v1/tests/location-google-maps-runner.js pilot/nephi-home-node-pilot-v1/tests/phase6-transport-e2e-runner.js pilot/nephi-home-node-pilot-v1/tests/phase7-final-response-e2e-runner.js pilot/nephi-home-node-pilot-v1/tests/planner-failure-safety-runner.js pilot/nephi-home-node-pilot-v1/tests/relative-date-availability-runner.js pilot/nephi-home-node-pilot-v1/tests/test-only-line-message-trace-http-runner.js pilot/nephi-home-node-pilot-v1/scripts/test-line-chain-common.psm1 pilot/nephi-home-node-pilot-v1/scripts/start-test-line-pilot.ps1 pilot/nephi-home-node-pilot-v1/scripts/start-test-line-pilot-with-tunnel.ps1 tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js tests/pilot-nephi-home-node-pilot-v1-test-line-chain-runner.ps1
git commit -m "test: migrate LINE webhook coverage to property bindings"
```

### Task B2: Delete the legacy route, handler, helper and dead runtime

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/server.js`
- Delete: `pilot/nephi-home-node-pilot-v1/lib/test-line-webhook.js`
- Modify: `pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js` only enough to replace the deleted marker/old-route positive expectation with full-source no-legacy/one-shared-route expectations; Task B4 adds the complete mutation matrix
- Modify: `tests/pilot-nephi-home-node-pilot-v1-contract-runner.js`

**Interfaces:**
- `createRequestHandler(service, options)`: consumes only `sharedLineWebhookHandler` for production LINE webhook dispatch.
- `createApp(options)`: constructs only `sharedLineWebhookHandler`, injects it once, returns one app, exports unchanged `{ createApp, formatSafeTestOnlyConversationTrace }`.

**RED:** Contract runner first asserts legacy helper/route/handler/dead marker are absent and shared route is present; current source fails.

**GREEN:** Legacy route/handler/wiring/helper and all source after the first `return app;` up to `module.exports` are removed; shared binding tests and the minimally updated normal uniqueness Gate stay GREEN.

**Assertions:**
- No active runtime references or required exports were lost.
- `/api/line/webhooks/<webhookKey>` remains the only LINE webhook route.
- No comment-preserved copy, environment revival flag, push fallback, second app, second renderer or second writer remains.

**Test classification:** `STRUCTURED_CONTRACT_TEST`, `RUNTIME_COMPONENT_TEST`, and `FAKE_INTEGRATION`; not `REAL_LINE`.

- [ ] **Step 1: Write RED absence assertions**

Update the root contract runner to assert `lib/test-line-webhook.js` does not exist; full `server.js` does not contain `TEST_LINE_WEBHOOK_ROUTE`, `/api/test-line/webhook`, `lineWebhookHandler`, legacy marker or `pushToTestLine`; and does contain the shared webhook route and exactly one `createApp` export. Update the uniqueness runner's normal-source boundary/assertions first, without yet adding the B4 mutation list.

- [ ] **Step 2: Run RED**

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-contract-runner.js
node tests/v2-runtime-uniqueness-runner.js
```

Expected: both non-zero because the legacy helper/source still exists and the source still violates new no-legacy uniqueness assertions.

- [ ] **Step 3: Delete only the proven legacy code**

In `createRequestHandler`, remove `options.lineWebhookHandler` and the old POST branch. In `createApp`, remove the global-secret `lineWebhookHandler` and its server injection. Keep `sharedLineWebhookHandler`. Delete the block after the first app return through the line before `module.exports`, then delete `lib/test-line-webhook.js` with `apply_patch`.

- [ ] **Step 4: Run GREEN contract and replacement path tests**

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-contract-runner.js
node tests/v2-runtime-uniqueness-runner.js
node tests/property-line-binding-runner.js
node tests/property-line-binding-postgres-webhook-runner.js
node tests/test-line-official-adapter-runner.js
node tests/phase6-transport-e2e-runner.js
node tests/phase7-final-response-e2e-runner.js
```

Expected: every command exit 0. This proves the normal post-deletion source and the previously existing five mutations only; it does not claim the complete mutation matrix until Task B4.

- [ ] **Step 5: Prove source absence**

```powershell
rg -n "TEST_LINE_WEBHOOK_ROUTE|/api/test-line/webhook|lineWebhookHandler|legacy runtime kept|pushToTestLine|createFetchBackedLineClientFactory" pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/lib pilot/nephi-home-node-pilot-v1/scripts
rg -n "fetch\([^\r\n]*api/test-line/webhook|require\([^\r\n]*test-line-webhook" pilot/nephi-home-node-pilot-v1/tests tests
```

Expected: neither command finds an executable runtime/script or test consumer. Absence assertions and in-memory mutation strings in contract/uniqueness runners are allowed and must be reported as guards, not consumers. Historical docs may mention the deletion only when clearly past tense.

- [ ] **Step 6: Commit B2**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/lib/test-line-webhook.js pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js tests/pilot-nephi-home-node-pilot-v1-contract-runner.js
git commit -m "refactor: remove legacy LINE runtime path"
```

### Task B3: Make production provider selection fail closed

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js`
- Create: `pilot/nephi-home-node-pilot-v1/tests/provider-authority-fail-closed-runner.js`
- Modify: `tests/pilot-nephi-home-node-pilot-v1-postgres-provider-runner.js`
- Add explicit JSON provider injection where still absent:
  - `pilot/nephi-home-node-pilot-v1/tests/answered-claim-contract-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/final-decision-contract-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/first-version-controlled-core-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/first-version-public-admin-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/junzan-test-line-gateway-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/line-channel-identity-guard-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/location-google-maps-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/operator-data-form-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/phase6-transport-e2e-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/phase7-final-response-e2e-runner.js`
  - `pilot/nephi-home-node-pilot-v1/tests/planner-failure-safety-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js`
  - `tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js`

**Interfaces:**
- `createProviders(options = {})`: requires non-empty `databaseUrl`; throws error with `code === "DATABASE_URL_REQUIRED"`; returns PostgreSQL providers only.
- JSON test setup imports `createJsonProviders` directly and passes `{ kind: "json", ...createJsonProviders(...) }` through `createApp({ providers })`.
- `provider-authority-fail-closed-runner.js` functions: `loadFactoryFromSource(source)`, `runMutation(name)`, `expectDatabaseUrlRequired(fn)`.
- Root provider runner uses `PROVIDER_TEST_DATABASE_URL` when present for PostgreSQL 16 CI service, otherwise PGlite; both remain isolated test evidence.

**RED:** New runner asserts factory and uninjected `createApp` throw `DATABASE_URL_REQUIRED`; current JSON fallback causes RED. Root provider runner changes its old JSON-fallback expectation to a throw and fails before factory change.

**GREEN:** Production factory never returns JSON; explicit test injection remains usable; fallback source mutation makes child Gate non-zero; all affected tests pass with explicit providers.

**Assertions:** No dual read/write provider authority; missing DB fails before server start; tests cannot accidentally select JSON by omitting configuration.

**Test classification:** `UNIT_TEST`, `STRUCTURED_CONTRACT_TEST` for provider mutation, `FAKE_INTEGRATION` for isolated PostgreSQL/PGlite, and `RUNTIME_COMPONENT_TEST`; not `REAL_POSTGRESQL_PROVIDER`.

- [ ] **Step 1: Write RED provider tests**

Create the new runner with literal error-code assertions. In the root provider runner replace `assert.equal(jsonProviders.kind, "json")` with `assert.throws(() => createProviders({ databaseUrl: "" }), error => error.code === "DATABASE_URL_REQUIRED")` and retain all PostgreSQL assertions.

- [ ] **Step 2: Run RED**

```powershell
node tests/provider-authority-fail-closed-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-postgres-provider-runner.js
```

Expected: non-zero because `createProviders({})` currently returns JSON.

- [ ] **Step 3: Implement minimal factory fail-closed**

Remove the production import/use of `createJsonProviders`. On empty `databaseUrl`, throw an Error whose message is `DATABASE_URL is required for production provider selection` and whose code is `DATABASE_URL_REQUIRED`; otherwise keep existing PostgreSQL selection.

- [ ] **Step 4: Convert all listed isolated tests to explicit injection**

For each test, import `createJsonProviders`, create it with the same `dataFile`, `seedFile`, and `now` previously passed to `createApp`, then pass `providers`. Do not change business fixtures or expected replies. Tests already migrated in B1 reuse their explicit providers rather than receiving a second setup.

- [ ] **Step 5: Make the root provider runner usable with both local PGlite and CI PostgreSQL service**

Select the connection with:

```js
const serviceUrl = String(process.env.PROVIDER_TEST_DATABASE_URL || "").trim();
const connection = serviceUrl
  ? { kind: "pg", databaseUrl: serviceUrl }
  : { kind: "pglite", dataDir: databasePath };
```

Retain identical provider assertions in both modes. Only create/remove the local PGlite directory in local mode; the GitHub PostgreSQL service is job-scoped and must not be called formal PostgreSQL evidence.

- [ ] **Step 6: Add and verify fallback mutation**

`loadFactoryFromSource` compiles an in-memory mutated copy of the factory with the original filename so relative requires resolve normally. Parent mode spawns child mode with `JUNZAN_PROVIDER_GUARD_MUTATION=json_fallback`; child replaces the throw branch with JSON fallback source and must fail the same fail-closed assertion. This environment value is recognized only by the test runner, never by production factory or package scripts.

- [ ] **Step 7: Run targeted GREEN**

```powershell
node tests/provider-authority-fail-closed-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-postgres-provider-runner.js
node tests/final-decision-contract-runner.js
node tests/first-version-public-admin-runner.js
node tests/operator-data-form-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js
```

Then rerun all B1 direct webhook batches. Expected: every command exit 0; the provider mutation child is non-zero while the parent runner exits 0.

- [ ] **Step 8: Prove no production fallback and no uninjected test consumer**

```powershell
rg -n "createJsonProviders|kind:\s*[\"']json[\"']" pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js pilot/nephi-home-node-pilot-v1/server.js
rg -n "createApp\(" pilot/nephi-home-node-pilot-v1/tests tests
```

Expected: no JSON reference in production factory/server. Review every `createApp` result and record that it injects providers or deliberately asserts fail-closed.

- [ ] **Step 9: Commit B3**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js pilot/nephi-home-node-pilot-v1/tests/provider-authority-fail-closed-runner.js tests/pilot-nephi-home-node-pilot-v1-postgres-provider-runner.js pilot/nephi-home-node-pilot-v1/tests/answered-claim-contract-runner.js pilot/nephi-home-node-pilot-v1/tests/final-decision-contract-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-controlled-core-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-public-admin-runner.js pilot/nephi-home-node-pilot-v1/tests/junzan-test-line-gateway-runner.js pilot/nephi-home-node-pilot-v1/tests/line-channel-identity-guard-runner.js pilot/nephi-home-node-pilot-v1/tests/location-google-maps-runner.js pilot/nephi-home-node-pilot-v1/tests/operator-data-form-runner.js pilot/nephi-home-node-pilot-v1/tests/phase6-transport-e2e-runner.js pilot/nephi-home-node-pilot-v1/tests/phase7-final-response-e2e-runner.js pilot/nephi-home-node-pilot-v1/tests/planner-failure-safety-runner.js tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js
git commit -m "refactor: fail closed on missing database provider"
```

Before committing, inspect `git diff --cached --name-status`; any file not explicitly listed in Task B3 is an error and must not be committed.

### Task B4: Strengthen full-source runtime uniqueness mutations

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js`

**Interfaces:**
- Add `MUTATIONS` frozen list with exactly:
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
- Add `injectMutation(name, sources) -> mutated sources` and `runMutation(name) -> child evidence`.

**RED:** Expand the mutation loop to all 11 names and assert each child non-zero before adding missing injection branches/current no-legacy assertions; current Gate fails.

**GREEN:** Normal full source passes; every individual mutated source child fails; output contains 11 mutation status records.

**Assertions:**
- Set `runtime = server`; never slice at a legacy marker.
- Normal source contains no old query route/handler/dead marker/push fallback and exactly one shared binding route plus one composition root.
- Existing semantic/resolver/writer/FinalDecision/FinalResponse assertions remain; mutation injection is in-memory test code only.

**Test classification:** `STRUCTURED_CONTRACT_TEST`（static architecture and mutation execution）.

- [ ] **Step 1: Write RED all-mutation loop and normal no-legacy assertions**

Remove the old marker boundary requirement, use the full server string, add the exact MUTATIONS list, child evidence and new no-legacy/one-shared-route assertions.

- [ ] **Step 2: Run RED**

```powershell
node tests/v2-runtime-uniqueness-runner.js
```

Expected: non-zero because the new mutation names do not yet mutate source and therefore incorrectly pass.

- [ ] **Step 3: Implement every in-memory mutation**

Append or insert a minimal forbidden construct for each name. `second_runtime` must no longer depend on the deleted marker. `legacy_query_line_route`, caller-controlled handler and dead-runtime mutations must be detectable by the normal assertions. Retain existing five writer mutations.

- [ ] **Step 4: Run GREEN twice**

```powershell
node tests/v2-runtime-uniqueness-runner.js
$env:JUNZAN_GUARD_MUTATION='legacy_query_line_route'; node tests/v2-runtime-uniqueness-runner.js; $code=$LASTEXITCODE; Remove-Item Env:JUNZAN_GUARD_MUTATION; if ($code -eq 0) { throw 'mutation unexpectedly passed' }
```

Expected: parent command exit 0 with all 11 rejected; explicit mutated child non-zero.

- [ ] **Step 5: Commit B4**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js
git commit -m "test: enforce complete runtime uniqueness mutations"
```

### Task B5: Make the canonical Gate execute every child runner

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js`

**Interfaces:**
- Preserve the exact frozen `RUNNERS` pairs and expected markers.
- Add `runRunner(runner, passMarker) -> { runner, passMarker, status, signal, stdout, stderr, executed: true }` using `spawnSync(process.execPath, [path.join(__dirname, runner)])`.

**RED:** Add assertions that every evidence entry has `executed === true`, `status === 0`, no signal and its marker in current stdout while evidence construction still only scans source/package membership; current Gate fails.

**GREEN:** Gate executes all 15 existing runners, including the already-strengthened B4 uniqueness runner, fails on spawn error/signal/timeout/non-zero/missing current marker, and prints per-child evidence.

**Assertions:** RUNNERS membership and markers do not change; Golden Matrix/core acceptance files do not change; no child is considered covered because its name appears in pretest.

**Test classification:** `STRUCTURED_CONTRACT_TEST` for the orchestration Gate plus each child runner's own repository classification.

- [ ] **Step 1: Add RED execution assertions without implementation**

Add the four evidence assertions and remove the `coveredBy` success inference, but do not yet call `spawnSync`.

- [ ] **Step 2: Run RED**

```powershell
node tests/canonical-request-golden-gate-runner.js
```

Expected: non-zero because entries are not executed/current stdout is absent. The B4 uniqueness child itself must already be GREEN when run directly.

- [ ] **Step 3: Implement `runRunner` and sequential execution**

Use an explicit timeout, capture UTF-8 stdout/stderr, keep all evidence, and set final failure only after processing the complete list so every child exit is reportable. Do not read PASS markers from child source.

- [ ] **Step 4: Run GREEN**

```powershell
node tests/canonical-request-golden-gate-runner.js
```

Expected: exit 0, 15 executed child records, each status 0 and current stdout marker present.

- [ ] **Step 5: Commit B5**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js
git commit -m "test: execute canonical acceptance runners"
```

### Task B6: Add provider Gate to package, Integrity and isolated PostgreSQL workflow

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/package.json`
- Modify: `pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js`
- Modify: `pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js`
- Modify: `.github/workflows/codex-integrity.yml`
- Modify: `.github/protected-acceptance.json`

**Interfaces:**
- Add package script `test:provider-fail-closed`: `node tests/provider-authority-fail-closed-runner.js`.
- B Integrity required Gate list becomes protection, integrity, canonical, uniqueness and provider fail-closed.
- Workflow provides PostgreSQL 16 health-checked service and `PROVIDER_TEST_DATABASE_URL=postgresql://codex_test:codex_test_password@localhost:5432/codex_admin_test` only to isolated provider integration commands.

**RED:** Integrity runner fixtures fail when provider package entry, Gate file, workflow execution, PostgreSQL service or health check is missing/skipped.

**GREEN:** Package/Integrity/workflow all require and actually execute provider Gate; local PGlite and workflow PostgreSQL service classifications remain explicit.

**Assertions:** No provider requirement existed in A; it is introduced only now. No `continue-on-error`; no production credentials; no claim that CI service is formal PostgreSQL.

**Test classification:** `STRUCTURED_CONTRACT_TEST` for CI/integrity and `FAKE_INTEGRATION` for isolated PostgreSQL service behavior.

- [ ] **Step 1: Add RED B-stage fixtures**

Add negative cases for missing/wrong provider package script, missing provider runner, workflow missing service, missing health check, missing provider command, conditional/continue-on-error provider step.

- [ ] **Step 2: Run RED**

```powershell
node tests/verify-codex-integrity-runner.js
```

Expected: non-zero until B package/workflow/Integrity entries exist.

- [ ] **Step 3: Add package, Integrity and workflow entries**

Update the five required Gate assertions. Retain `postgres:16`, existing isolated credentials and health command. Add:

```yaml
- run: npm run test:provider-fail-closed
- run: npm run test:postgres
  env:
    PROVIDER_TEST_DATABASE_URL: postgresql://codex_test:codex_test_password@localhost:5432/codex_admin_test
```

Place provider integration after migrations-dependent tests or otherwise reset its isolated DB state so it cannot pollute earlier tests.

- [ ] **Step 4: Manually update only approved accepted-current hashes**

Run `Get-FileHash` only for canonical Gate, uniqueness Gate, Integrity script/runner and workflow, then apply those five exact values to manifest. Do not change immutable entries and do not add a hash update script.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd run test:provider-fail-closed
npm.cmd run test:postgres
npm.cmd run verify:codex-integrity
node tests/verify-codex-integrity-runner.js
npm.cmd run verify:protected-acceptance
node tests/verify-protected-acceptance-runner.js
```

Expected: every command exit 0; provider mutation child fails as intended inside its parent Gate.

- [ ] **Step 6: Commit B6**

```powershell
git add -- pilot/nephi-home-node-pilot-v1/package.json pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js .github/workflows/codex-integrity.yml .github/protected-acceptance.json
git commit -m "ci: enforce provider authority gate"
```

### Task B7: Run complete local verification, report B, then stop

**Files:**
- Modify: none

**RED:** Any old route/helper/provider fallback match, mutation escape, changed immutable blob, failed targeted/full test or file outside approved/direct-reference scope blocks B completion.

**GREEN:** Targeted tests, every Gate, full local suite and immutable/scope audits all pass with recorded exit codes.

**Assertions:** Local success does not解除 LINE deployment blocker and does not prove REAL_LINE, REAL_POSTGRESQL_PROVIDER or deployment.

**Test classification:** all results use the repository list per command; PGlite/service data are `FAKE_INTEGRATION`, never `REAL_POSTGRESQL_PROVIDER`.

- [ ] **Step 1: Run all Gates and complete local suites**

```powershell
npm.cmd run verify:protected-acceptance
node tests/verify-protected-acceptance-runner.js
npm.cmd run verify:codex-integrity
node tests/verify-codex-integrity-runner.js
npm.cmd run test:provider-fail-closed
npm.cmd run test:postgres
npm.cmd run test:canonical-golden
npm.cmd run test:runtime-uniqueness
npm.cmd run test:custom-replies
npm.cmd test
```

- [ ] **Step 2: Run root tests changed by LINE/provider migration**

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-contract-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-ai-first-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-behavior-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-event-lifecycle-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-openai-adapter-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-timeout-runner.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ../../tests/pilot-nephi-home-node-pilot-v1-test-line-chain-runner.ps1
```

- [ ] **Step 3: Prove bypass absence and immutable acceptance**

```powershell
rg -n "TEST_LINE_WEBHOOK_ROUTE|/api/test-line/webhook|lineWebhookHandler|legacy runtime kept|pushToTestLine|createFetchBackedLineClientFactory" pilot/nephi-home-node-pilot-v1/server.js pilot/nephi-home-node-pilot-v1/lib pilot/nephi-home-node-pilot-v1/scripts
rg -n "fetch\([^\r\n]*api/test-line/webhook|require\([^\r\n]*test-line-webhook" pilot/nephi-home-node-pilot-v1/tests tests
rg -n "if\s*\(!databaseUrl\).*createJsonProviders|createJsonProviders" pilot/nephi-home-node-pilot-v1/lib/providers/provider-factory.js pilot/nephi-home-node-pilot-v1/server.js
git diff --exit-code 5a7c018c4a409ec5b429fb191c1ad6ab84e47696 -- pilot/nephi-home-node-pilot-v1/docs/JUNZAN_AI_CONSTITUTION.md pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js
git diff --check 6cb7291f4402d674ee7c31f6d49603deb7dddbdf..HEAD
git status --short --branch
```

Expected: all three `rg` commands return exit 1 because no executable match exists; immutable diff and diff-check exit 0; worktree clean. Guard-only mutation/absence strings are separately visible in the Gate source and are not runtime consumers.

- [ ] **Step 4: Review the complete B diff**

```powershell
$checkpointAHead = git log --format=%H --grep='ci: enforce checkpoint A integrity gates' -n 1
if ([string]::IsNullOrWhiteSpace($checkpointAHead)) { throw 'Checkpoint A commit not found' }
git diff --name-status "$checkpointAHead..HEAD"
git diff --stat "$checkpointAHead..HEAD"
```

Confirm the resolved commit equals the exact A commit already reported and approved. Inspect every file against Tasks B1–B6 and record direct-reference additions.

- [ ] **Step 5: Report B and stop**

Report deletion evidence, shared production call chain, provider authority, all mutation results, complete commands/classifications/exit codes, file list, commits, immutable hashes, no external actions and all unproven items. Repeat `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION` verbatim.

**Mandatory stop:** Do not begin Checkpoint C until the user explicitly approves it and any required push/draft-PR external action.

---

## Checkpoint C — Clean Environment, Draft PR, Independent Review

### Task C0: Reproduce the complete suite in a clean local worktree

**Files:**
- Modify: none in the implementation worktree
- Create outside the implementation worktree: one temporary clean Git worktree for the exact B HEAD

**Interfaces:**
- Consumes: exact Checkpoint B HEAD already reported and approved.
- Produces: clean-install and complete-suite evidence tied to that HEAD.

**RED:** A dirty checkout, reused `node_modules`, missing lockfile install, immutable mismatch or any non-zero test means C is not ready.

**GREEN:** Fresh worktree at exact B HEAD, `npm ci`, all Gates/suites exit 0, worktree remains clean.

**Assertions:** No source fix is made inside C. A failure returns to the owning A/B task, creates a scoped fix commit there, and restarts C from a new clean worktree.

**Test classification:** `RECORDED_REPRODUCTION` for clean install evidence, `STRUCTURED_CONTRACT_TEST` for integrity/architecture, and `FAKE_INTEGRATION` for isolated PostgreSQL.

- [ ] **Step 1: Record the exact B HEAD and create a clean worktree**

```powershell
$checkpointBHead = git rev-parse HEAD
$cleanRoot = Join-Path 'C:\tmp' ("nephi-home-integrity-ci-" + $checkpointBHead.Substring(0,12))
git worktree add --detach $cleanRoot $checkpointBHead
git -C $cleanRoot status --short
```

Expected: empty status. Verify the resolved `$cleanRoot` is under `C:\tmp` before any later cleanup.

- [ ] **Step 2: Install from the lockfile**

```powershell
npm.cmd ci
```

Working directory: `$cleanRoot\pilot\nephi-home-node-pilot-v1`.

Expected: exit 0 using `package-lock.json`. This proves reproducible install only, not product/runtime behavior.

- [ ] **Step 3: Run the complete clean suite**

```powershell
npm.cmd run verify:protected-acceptance
node tests/verify-protected-acceptance-runner.js
npm.cmd run verify:codex-integrity
node tests/verify-codex-integrity-runner.js
npm.cmd run test:provider-fail-closed
npm.cmd run test:postgres
npm.cmd run test:canonical-golden
npm.cmd run test:runtime-uniqueness
npm.cmd run test:custom-replies
npm.cmd test
```

Expected: every command exit 0 with complete outputs retained.

- [ ] **Step 4: Recheck immutable content and cleanliness**

```powershell
git -C $cleanRoot diff --exit-code 5a7c018c4a409ec5b429fb191c1ad6ab84e47696 -- pilot/nephi-home-node-pilot-v1/docs/JUNZAN_AI_CONSTITUTION.md pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js
git -C $cleanRoot status --short
```

Expected: both exit 0/empty status. Do not delete the clean worktree until C evidence has been independently reviewed.

### Task C1: Run GitHub Actions only after explicit C external authorization

**Files:**
- Modify: none
- External collaboration state: branch push and draft PR only; no merge/deployment.

**Interfaces:**
- Draft PR base: the repository's existing integration target selected by the user at C authorization.
- Draft PR head: `codex/execution-integrity-rules` at exact clean-verified B HEAD.
- Required check: `.github/workflows/codex-integrity.yml` job `verify-codex-integrity`.

**RED:** Without explicit push/draft-PR authorization, report `BLOCKED_C_EXTERNAL_AUTHORIZATION`. With authorization, any failed/missing/skipped check or SHA mismatch is RED.

**GREEN:** Remote branch SHA equals local verified SHA; draft PR exists; GitHub Actions clean checkout, PostgreSQL 16 health service and all required commands pass on that same SHA.

**Assertions:** PR remains draft/unmerged; workflow cannot deploy; CI PostgreSQL is isolated and not formal evidence.

**Test classification:** `RECORDED_REPRODUCTION` for exact-SHA GitHub CI evidence, `RUNTIME_COMPONENT_TEST` for production entry points, and `FAKE_INTEGRATION` for isolated PostgreSQL.

- [ ] **Step 1: Reconfirm authorization and SHA**

Do not run any remote command unless the user has explicitly approved Checkpoint C and push/draft PR. Record:

```powershell
git rev-parse HEAD
git status --short --branch
git remote -v
```

- [ ] **Step 2: Push only the approved branch**

```powershell
git push -u origin codex/execution-integrity-rules
git ls-remote --heads origin refs/heads/codex/execution-integrity-rules
```

Expected: remote SHA exactly equals the locally verified SHA.

- [ ] **Step 3: Create a draft PR**

The PR body must include A/B file responsibility, removed bypasses, Gate commands/assertions/classifications/exit codes, immutable hash comparison, `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`, every `UNPROVEN` item, and `DO NOT DEPLOY`.

- [ ] **Step 4: Wait for the exact-SHA workflow**

Verify the `codex-integrity` workflow checks the PR head SHA and record every job/check URL and conclusion. A queued, skipped, neutral, cancelled or stale-SHA check is not GREEN.

### Task C2: Obtain one independent review for this closure only

**Files:**
- Modify: none unless reviewer identifies a scoped defect; any fix returns to its A/B task.
- Evidence: reviewer report attached to the draft PR/task.

**Interfaces:**
- Reviewer receives design spec, this plan, base SHA, head SHA, complete diff, Gate output and CI links.
- Reviewer returns blocking/non-blocking findings with file/line/evidence.

**RED:** Missing review, reviewer who implemented the change, unexamined files, blocking finding, immutable acceptance change or unsupported completion claim.

**GREEN:** Independent reviewer covers every approved requirement and reports no unresolved blocking finding; any fix has been re-run through clean C0/C1.

**Assertions:** This review requirement applies only to this core closure, not future ordinary small changes.

**Test classification:** `RECORDED_REPRODUCTION`（independent diff review and evidence-chain audit）.

- [ ] **Step 1: Provide the bounded review packet**

Include only this task's spec/plan/diff/evidence; do not create an external audit platform or new approval workflow.

- [ ] **Step 2: Require explicit review checks**

Reviewer checks: complete original-requirement coverage; authority uniqueness; immutable acceptance; legacy route/dead code/helper absence; shared-binding call chain; provider fail-closed; every mutation actually executed; test classification accuracy; deployment blocker retained.

- [ ] **Step 3: Resolve findings by returning to A/B**

For every blocking finding, add a failing test in the owning task, observe RED, implement minimal GREEN, rerun B7 and all of C0/C1, then request re-review. Do not fix by weakening the reviewed assertion.

### Task C3: Final C evidence report

**Files:**
- Modify: none

**RED:** Any mismatch among local HEAD, remote HEAD, PR HEAD, CI SHA or review SHA; any unreported failure/unproven external claim; any deployment action.

**GREEN:** Clean local evidence, exact-SHA CI, draft PR, independent review and full evidence chain are complete; PR remains unmerged and deployment blocker remains active.

**Assertions:** No completion claim exceeds its test classification. REAL_LINE, REAL_POSTGRESQL_PROVIDER, REAL_RENDER_DEPLOYMENT and test-only binding migration remain unproven unless separately authorized and executed outside this work.

**Test classification:** `RECORDED_REPRODUCTION`（final evidence audit）.

- [ ] **Step 1: Produce the final report**

Include complete file list/responsibility, removed bypasses, production call chain, Gate assertions and mutation records, all command exit codes, base/A/B/C commits, immutable hash comparison, clean-worktree proof, CI links, draft PR/download link, independent review result, and unproven items.

- [ ] **Step 2: State prohibited actions and blocker**

State explicitly: no merge, no deployment, no Render/LINE/formal PostgreSQL/credentials operation, and `DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION` remains active.

## Plan Self-Review Checklist

- [ ] Every approved design requirement maps to A, B or C.
- [ ] A does not require provider fail-closed; B adds it to package/Integrity/workflow.
- [ ] Golden Matrix, Constitution and core acceptance paths are never modification targets.
- [ ] Future acceptance-standard changes require a separate pre-approved task and are not implemented here.
- [ ] Unit isolation is allowed but cannot be called runtime evidence.
- [ ] DECISIONS original bodies and old/new ID traceability are preserved.
- [ ] B contains the six user-required ordered internal steps without new approval gates.
- [ ] Workflow PostgreSQL service is landed in B, not improvised in C.
- [ ] Every production change has a RED-before-GREEN test cycle.
- [ ] Every task names files, interfaces, commands, assertions, classification and evidence.
- [ ] No bootstrap/update/skip/bypass is committed.
- [ ] No external action occurs before explicit C authorization.
- [ ] Deployment blocker remains in A, B and C reports.
- [ ] No unresolved marker, deferred implementation note or vague testing instruction remains.

## Authorization Stop

Saving and committing this plan does not authorize implementation. Stop after the plan commit and wait for the user's explicit approval to start Checkpoint A. Do not execute Task A0 or any later task before that approval.
