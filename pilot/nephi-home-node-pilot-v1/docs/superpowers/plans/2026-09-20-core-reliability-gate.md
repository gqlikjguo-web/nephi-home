# Core Reliability Gate phase 1

Approved scope: the user's 2026-09-20 Gate implementation instruction. Baseline
production and LIVE: 8f1719c71dd590d85e9a4d1b47f1f08bb8a4af70.

## Design and trust boundary

Normal runtime stays byte-identical. Extend the existing integrity/preflight
tooling with an external release orchestrator. Read policy and protected tests
from the trusted base checkout, never the candidate's replacement policy.
An exact task manifest is reviewed separately from executing candidate code.
CI executes only after scope approval and binds every result to the candidate.
The installation PR cannot attest its own trust: the initial policy/workflow
requires human bootstrap review. Existing credentials must not be destroyed.

## Implementation sequence

- [ ] RED: isolated Git repository probes for scope, protected files, missing
  evidence, changed SHA, failed runner, and preserved dirty work.
- [ ] GREEN: external policy, incident/affected registry and sequential gate;
  existing integrity verification remains mandatory.
- [ ] Add bounded real-provider release harness, independent expectations,
  isolated PostgreSQL, no LINE delivery and no commercial quota integration.
- [ ] Add trusted CI entry and human scope approval boundary. No production push.
- [ ] Add superseded annotations only where current Git/test evidence proves
  replacement; preserve historical text and all unknown material.
- [ ] Verify original npm lifecycle and affected checks without runtime edits.
- [ ] Configure safe production PR/check protection if supported. Report
  credential/bootstrap actions separately. Commit, push dedicated branch, PR.

## Stop contract

A previously valid PASS becoming FAIL stops the sequence immediately. Keep the
worktree, modifications, stdout/stderr and evidence. No reset, revert, rollback,
restore, clean, automatic retry, or follow-up patch. Negative probes run only in
temporary repositories and are explicitly expected failures.
