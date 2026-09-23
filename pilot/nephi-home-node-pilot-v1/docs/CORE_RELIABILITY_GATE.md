# Core Reliability Gate phase 1

This is external release protection. No normal runtime imports the gate.

## Trusted task approval

Every task supplies `.github/core-reliability-task.json`: baseline SHA, approved
objective, exact allowed paths, contract-change permission and affected capability
declaration. A declaration does not choose the test set: trusted policy maps the
actual baseline-to-candidate diff. Renames expose both source and destination.

The production-base `pull_request_target` workflow reads the immutable PR head's
task and presents its SHA/digest for human review. The `core-scope-approval`
environment must require the repository owner's review before candidate code is
executed. The scope digest cannot be supplied by candidate code. The gate and
policy are read from the base checkout, not from changed candidate files.
Review the actual scope and PR diff; an arbitrary task manifest is not approval.

## Public text/CSS fast path

The production-base trusted classifier reads the exact baseline and candidate
Git blobs and the complete binary diff. It admits only regular-file changes to
`public/assets/guest.js` display-string literal contents at the enumerated DOM
text assignments, `public/assets/guest.css` pure styles, and the exact task
manifest. The manifest must match the actual changed paths and declare no
Contract or Gate change. A JS operator, API string, non-display literal, CSS
import/resource reference, other file, or mixed diff takes the existing full
Gate route. A task declaration alone never selects the fast route.

The fast route checks `git diff --check`, runs
`first-version-public-admin-runner.js`, binds every result and log digest to the
candidate SHA, and publishes the existing required candidate status only after
the PR head and production base are rechecked. A failed runner stops and keeps
its evidence. The fast route has no `core-scope-approval` environment, live E2E,
or full core regression. Integrity and protected-acceptance checks still run.
All other changes retain the human-reviewed full Gate, incident runners,
affected regression and REAL qualification rules below. Governance changes
that install or alter this route use that full reviewed Gate.

Protected tests cannot change in ordinary runtime PRs, including changes that
set `contractChangeAllowed=true`: they return CONTRACT_CHANGE_REQUIRED. A
contract change needs its own approved review and trusted-baseline installation.
Gate maintenance is separate, explicitly approved, and cannot include runtime.
UNKNOWN and mixed conflicting acceptance files are not newly protected. Existing
lifecycle tests remain executed; that preserves their valid safety assertions
without adopting their old prose as current product authority.

## Execution and evidence

The incident registry records evidence commits separately from responsible
commits; null responsibility is not a reconstructed cause. Required incident
runners always execute. Capability paths add affected runners. The baseline npm
pretest/test/posttest commands are extracted, validated and deduplicated. Missing
commands, nonzero exit, timeout, skips or missing evidence cannot count as PASS.
Every command result and log digest is bound to the exact candidate SHA.
The checkout is checked before and after execution, including untracked files
outside the explicitly reviewed pre-existing paths. Incomplete runner sets and
reused evidence directories are rejected. The trusted workflow publishes
`Core Reliability Gate / candidate` directly on the PR head SHA, only after
rechecking both the current head and production baseline. Repeated workflow
attempts cannot create a passing release status.

On failure, stop immediately and preserve the checkout, dirty work, logs and
report. No reset/revert/rollback/restore/clean or retry is performed. This current
user-approved STOP policy supersedes older automatic-rollback wording for agent
verification failures; emergency recovery requires a separate explicit request.

## REAL release qualification

REAL qualification is selected separately from deterministic affected tests.
The trusted baseline policy's `realE2e.requiredPaths` covers Understanding,
OpenAI contracts, Context, CanonicalRequest, the AI/core decision boundary and
shared server wiring. Actual Git diff paths (including deletions and both sides
of a rename) determine qualification; task `skipRealE2e` or similar candidate
claims have no effect. `--require-real true` may only add a requirement.

Pure UI, image storage/attachments and separate LINE transport changes do not
require live model understanding. Shared core/server files remain REQUIRED
unless their exact before/after regular-file SHA-256 contents match a reviewed
attachment-only transition in that trusted policy. This is an exact content
review, not a path-wide exemption: changing a decision alongside an attachment,
changing one additional byte, deleting or replacing the file invalidates it.

A reviewed HTTP mount may include `candidateFiles`: exact path/content hashes
for its newly introduced handlers and dependencies. Every listed file must be a
regular `100644` blob with the reviewed content. A change to any guarded module
(including a later helper-only change with unchanged server wiring) is considered
for REAL qualification; the original server transition and all guarded hashes
must match together. This prevents a reviewed mount from admitting an unreviewed
handler that intercepts AI requests. These guards and their actual-diff fixtures
are protected governance, never candidate-provided exceptions.

Classification lives in the existing protected governance policy; ordinary
runtime candidates cannot change it. Policy updates use the independent,
explicitly approved Gate-maintenance flow and the existing scope approval.
Every required deterministic/incident/affected/lifecycle runner still runs.
A NOT_REQUIRED result records the candidate SHA, zero calls and the trusted
classification evidence. Missing credentials still block genuinely required
REAL qualification. A baseline without this new classification retains its
previous rules while the Gate update is being installed.

For changes that require REAL, the real harness runs after deterministic checks.
It calls the real OpenAI adapter and the current core with an isolated native
PostgreSQL database. It rejects non-local/non-dedicated/existing databases before
migration or writes. It never loads the LINE or commercial quota entrypoint.
13 representative turns cover the recorded availability dates, range/room,
capacity, normal NO_REPLY, property isolation, known policy/ABSENT sibling,
human responsibility and Context date replacement. The source-bound correction
controller can make at most two calls per turn: 13 turns, at most 26 API calls.
Correction occurrence is not forced or invented. Deterministic incident runners
force the rejection/preservation cases. LINE_DELIVERY_E2E remains NOT_RUN.

Set the test-only `CORE_GATE_OPENAI_API_KEY` environment secret only after review.
Never copy production DB or LINE credentials into this environment. No live
OpenAI result is claimed by the local real-harness contract tests.
Missing `CORE_GATE_OPENAI_API_KEY` yields `BLOCKED_CREDENTIAL` with a nonzero
exit when REAL qualification is required; production credentials are never a
fallback. `--require-real true` can require REAL qualification for a Gate
installation candidate, but cannot disable qualification for core changes.

## Bootstrap and credentials

The initial Gate PR cannot approve its own protection. Before the workflow exists
on production, its trusted-base check is unavailable. The owner must independently
review/install this first PR, configure the protected environment and required
check, then verify the first ordinary PR is blocked without approval and GREEN.
No bootstrap fallback reads a candidate policy in normal CI. The local explicit
bootstrap-policy/digest arguments are self-tests, not a release qualification.

An admin credential can change repository protection. Keeping the owner's
emergency ability while preventing Codex from using it requires a separate,
non-admin Codex credential. Do not delete or silently alter existing credentials.
Until that separation is completed, report USER_ACTION_REQUIRED; never claim the
current admin token is cryptographically prevented from bypassing protection.

On 2026-09-20 the GitHub API confirmed production protection requiring one
review, stale-review dismissal, approval after the last push, CODEOWNERS review,
conversation resolution, an up-to-date branch and both `verify-codex-integrity`
and `Core Reliability Gate / candidate` from GitHub Actions. Force pushes and
deletion are disabled. Admin enforcement remains disabled for the owner's
emergency access. The new `core-scope-approval` environment requires the owner's
review and disables admin bypass of that environment; self-review is allowed
while the owner is the only identity. Separate non-admin Codex credentials and
the first trusted-base installation remain USER_ACTION_REQUIRED. No passing
GitHub Gate run is claimed before that installation.

No Render configuration or deployment is part of this Gate installation.

## Controlled Contract-change installation (2026-09-21)

The installation mechanism now implements the separate review requirement above.
Default protected-path rejection is unchanged; `contractChangeAllowed=true` is a
request, never approval. Ordinary runtime PRs cannot use this exception.

A Contract-change candidate may modify only explicitly scoped protected paths
under `tests/` or `pilot/nephi-home-node-pilot-v1/tests/`, plus its task manifest. Runtime, dependencies, other files and Gate
policy/implementation changes cannot be mixed into that candidate. Governance
paths remain excluded even if they are also classified as protected.

Before the existing `core-scope-approval` environment pauses, the trusted base
workflow publishes a descriptor binding repository, PR, run/attempt, baseline,
candidate, task/policy digests, exact changed/protected paths and the SHA-256 of
the full binary Git diff. An independent review must assess that exact candidate.
The configured reviewer approves the run with this exact comment:

`CONTRACT_CHANGE_APPROVED <descriptor SHA-256> REVIEW_SHA256=<independent review evidence SHA-256>`

The review digest identifies the independently reviewed evidence retained with
the PR/release records; the GitHub reviewer attests that review passed. It is not
an AI-generated self-approval or a candidate-supplied approval file. The Gate reads
GitHub's run/review/PR/production APIs directly with a read-only Actions token,
verifies the configured reviewer/environment and exact bindings, then issues an
in-process admission receipt. Serialized or candidate-created receipts fail.
Changing candidate, diff, scope, baseline or run invalidates the approval. No
matching review, API failure or missing read token means STOP. Rerunning to pick a
passing result remains prohibited. The token is not forwarded to test runners.

All existing incident, affected and npm lifecycle checks still execute; approved
Contract changes receive no test-result exemptions. A passing, current-SHA PR
may merge through the existing production requirements; the merge becomes the
next trusted baseline. Never edit protectedPaths or manufacture a success status
to install a Contract change.

This uses the existing GitHub approval authority, not a new key/service. It
prevents candidate code from generating approval evidence. As documented above,
GitHub proves the approving account, not whether a human or an agent sharing its
admin credential operated it. This feature does not claim credential separation.

Protected files outside those test directories remain ineligible. Files also
covered by `.github/protected-acceptance.json` still have to satisfy its existing
hash checks; this mechanism grants no exemption from that separate protection.
