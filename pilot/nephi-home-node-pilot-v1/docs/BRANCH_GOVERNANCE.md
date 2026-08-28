# Branch governance and 2026-08-28 audit

Canonical long-lived branches:

- `production`: the only branch authorized for the `junzan-ai` production Render service (`srv-d9b630reo5us73e0rk8g`).
- `test-only/node-pilot-integration`: the only development, shadow, and test branch.

All production changes are verified on the test branch, integrated into `production` without rewriting history, and deployed only from `production`. Temporary branches are deleted in the task that integrates them. No third long-lived branch is allowed.

Audit baseline: Render-bound branch `test-only/node-pilot-integration` at `6e1dab197ca2`. `ahead` and `behind` are relative to that baseline. `merge-base` values are abbreviated to 12 characters. Every branch with `ahead=0` is fully contained by the baseline and has no unique commit.

| Remote branch | HEAD | merge-base | ahead/behind | Classification | Unique commits / consumer evidence |
| --- | --- | --- | --- | --- | --- |
| codex/admin-navigation-and-simple-replies | 45dca6893591 | 45dca6893591 | 0/244 | SAFE_DELETE | Fully contained |
| codex/admin-usability-fixes | 4ba1f0c2ac40 | 4ba1f0c2ac40 | 0/253 | SAFE_DELETE | Fully contained |
| codex/core-authority-closure-20260803 | c56c7df564fe | c56c7df564fe | 0/229 | SAFE_DELETE | Fully contained |
| codex/deployed-acceptance-closure-20260804 | b692351c0d0d | a260a9d4d30b | 1/225 | MERGE_REQUIRED | Documentation-only `b692351`; preserve on test branch |
| codex/execution-integrity-rules | 6e6703d21f93 | 6e6703d21f93 | 0/231 | SAFE_DELETE | Fully contained |
| codex/final-response-empty-reply-guard | aae57802f27f | aae57802f27f | 0/268 | SAFE_DELETE | Fully contained |
| codex/guest-line-inquiry-pricing | 0e2f8fb9cc5a | 0e2f8fb9cc5a | 0/240 | SAFE_DELETE | Fully contained |
| codex/integrate-guest-line-inquiry-0e2f8fb | 5a7c018c4a40 | 5a7c018c4a40 | 0/239 | SAFE_DELETE | Fully contained |
| codex/integrate-guest-line-inquiry-d5f60f0 | afda379e9b9b | d5f60f0c096c | 1/243 | SAFE_DELETE | Unique object is a merge commit; both content parents and equivalent pricing change are contained |
| codex/integration-admin-usability-test-only | 8a87987e89c9 | 8a87987e89c9 | 0/245 | SAFE_DELETE | Fully contained; same HEAD as integration alias |
| codex/integrity-gate | 7f567f1f62a1 | 7f567f1f62a1 | 0/295 | SAFE_DELETE | Fully contained |
| codex/junzan-release-closure-20260805 | 1bf02919d190 | 1bf02919d190 | 0/159 | SAFE_DELETE | Fully contained |
| codex/junzan-step3-core-20260811 | 298fc06c8595 | 298fc06c8595 | 0/129 | SAFE_DELETE | Fully contained |
| codex/junzan-step4-readonly-20260811 | 2cad3aa491e5 | 2cad3aa491e5 | 0/127 | SAFE_DELETE | Fully contained |
| codex/junzan-step4-targeted-fixes-20260811 | 0c97fb845d5e | 0c97fb845d5e | 0/123 | SAFE_DELETE | Fully contained |
| codex/junzan-v1-inventory-toggle-20260811 | 4debea00a2ea | 4debea00a2ea | 0/128 | SAFE_DELETE | Fully contained |
| codex/post-v1-backlog-20260813 | 5bdebbc4cb58 | ce4cda3d09d2 | 1/108 | MERGE_REQUIRED | Documentation-only `5bdebbc`; preserve on test branch |
| codex/postgres-availability-authority-fix | 73107fd34974 | 73107fd34974 | 0/262 | SAFE_DELETE | Fully contained |
| codex/remove-availability-startup-diagnostic | 0f3a683c9250 | 0f3a683c9250 | 0/260 | SAFE_DELETE | Fully contained |
| codex/repair-semantic-audit-failures | 610a3a747d63 | 610a3a747d63 | 0/271 | SAFE_DELETE | Fully contained |
| codex/test-only-availability-diagnostic | 3203f522f393 | 3203f522f393 | 0/266 | SAFE_DELETE | Fully contained |
| codex/test-only-availability-diagnostic-merge | 880601e33625 | 880601e33625 | 0/252 | SAFE_DELETE | Fully contained |
| codex/test-only-startup-availability-diagnostic | d70bfdd67a93 | d70bfdd67a93 | 0/264 | SAFE_DELETE | Fully contained |
| codex/unique-core-convergence | 4d01299c7db2 | 4d01299c7db2 | 0/297 | SAFE_DELETE | Fully contained |
| codex/v3-semantic-integration | 803bbefc72f9 | 803bbefc72f9 | 0/276 | SAFE_DELETE | Fully contained |
| diagnose/line-entertainment-red-20260826 | 02fd480f0e12 | 85aeb4c951df | 20/14 | SAFE_DELETE | Production-equivalent commits are in the candidate; `eac0645`/`02fd480` are rolled-back prompt-only experiments |
| fix/admin-remove-scope-bottle-cleaning-20260827 | 2adb86156e1c | 85aeb4c951df | 19/14 | MERGE_REQUIRED | Exact current production LIVE_SHA and required admin change; base of production candidate |
| fix/availability-semantic-grounding-20260828 | 3358f701e4e0 | 85aeb4c951df | 20/14 | MERGE_REQUIRED | Only `3358f701` is promoted after affected regression verification |
| fix/independent-relationship-contract-20260827 | c834479ac182 | 85aeb4c951df | 19/14 | SAFE_DELETE | `c834479` is a rolled-back relationshipCandidates experiment; shared production commits are already covered |
| integration/admin-usability-test-only | 8a87987e89c9 | 8a87987e89c9 | 0/245 | SAFE_DELETE | Fully contained; duplicate branch name for same HEAD |
| main | e967c7987bc9 | bd3acf5eb57f | 3/457 | MERGE_REQUIRED | GitHub default and Pages source; `fb55c08`, `8bd9fb0`, `e967c79` price-page assets must be preserved on test branch before Pages migration |
| phase1-4-authoritative | 94c5d30b29c5 | 94c5d30b29c5 | 0/313 | SAFE_DELETE | Fully contained |
| release/v1-rc-20260825 | ac50fffe1fe9 | 85aeb4c951df | 8/14 | SAFE_DELETE | All eight release commits are ancestors of current production candidate |
| test-only/conversation-contract-phase-1 | 1d82674a4555 | 1d82674a4555 | 0/302 | SAFE_DELETE | Fully contained |
| test-only/conversation-core-v3-runtime | 2c35d7ab9efe | 2c35d7ab9efe | 0/301 | SAFE_DELETE | Fully contained |
| test-only/core-90-fixes | 00cc6b3494f6 | 00cc6b3494f6 | 0/303 | SAFE_DELETE | Fully contained |
| test-only/friendly-onboarding-intake | 45cf4efcb952 | 45cf4efcb952 | 0/308 | SAFE_DELETE | Fully contained |
| test-only/node-pilot-integration | 6e1dab197ca2 | 6e1dab197ca2 | 0/0 | KEEP_TEST | Render and GitHub Actions test consumer; preserves non-production diagnostics and Context work |
| test-only/planner-90-validation | 7b5807aeaafd | 7b5807aeaafd | 0/310 | SAFE_DELETE | Fully contained |
| test-only/property-line-connection-page | 1e7664094f71 | 1e7664094f71 | 0/307 | SAFE_DELETE | Fully contained |

External consumers at audit time:

- Production Render service `srv-d9b630reo5us73e0rk8g` was bound to `test-only/node-pilot-integration`; cutover must change it to `production` only after candidate verification.
- GitHub Actions `test-only-ci` consumes `test-only/node-pilot-integration`.
- GitHub Pages consumes `main`; Pages must move to `test-only/node-pilot-integration` after the three unique price-page commits are merged.
- GitHub default branch was `main`; it must move to `production` before `main` is deleted.
- No remote branch was protected at audit time.
