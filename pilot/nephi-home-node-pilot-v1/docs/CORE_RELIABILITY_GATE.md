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

Only actual core-path changes invoke the real harness after deterministic checks.
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
