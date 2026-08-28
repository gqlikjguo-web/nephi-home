# Change and rollback policy

- Every runtime change starts from one baseline commit and one explicit scope.
- Keep one test-only LINE route, one V2 composition root, one engine, one coordinator, one state reducer, one resolver adapter, one response planner, and one controlled composer.
- Do not add a second route, gateway, coordinator, engine feature flag, bridge, identity guard, destination guard, SHA256 guard, push fallback, or alternative conversation path.
- A change that alters runtime wiring must update the architecture and constitution contract tests in the same commit.
- Golden Matrix cases are versioned acceptance contracts: add a case before changing the covered behavior; do not weaken or delete an assertion to make a regression pass.
- Do not solve a failure by deleting, skipping, narrowing, or conditionally bypassing a test. A Constitution or Golden Matrix change requires a written reason, affected contract, and review evidence in the same change.
- Do not roll back to, or reintroduce, a dual runtime, old coordinator/planner/composer, resolver bypass, transport fallback, or identity/destination/SHA256 guard.
- Run the focused checks and `npm test` before committing; a failure blocks the commit.
- The only long-lived branches are `production` and `test-only/node-pilot-integration`.
- `production` is the only branch authorized for the `junzan-ai` production Render service.
- `test-only/node-pilot-integration` is the only development, shadow, and test branch. New understanding/dialogue core work remains there until acceptance and explicit production promotion.
- Every production change flows through `test-only/node-pilot-integration` verification, then a non-force integration into `production`, then deployment from `production`.
- At task start, verify repository, branch, HEAD, and Render target. Stop before modifying files when any one does not match the authorized line.
- A temporary task branch must be tested, merged into one canonical branch, and deleted in the same task. Never create a third long-lived branch or force-push `production`.
- Commit only the reviewed scope. Push only one of the two canonical branches; test work goes to `test-only/node-pilot-integration` and reviewed release integration goes to `production`.
- Test-only deployment verification, when separately authorized, is Verify 200, one event claim, one V2 execution, and one reply. No production environment is used.
- A rollback is a new, explicit test-only commit restoring the prior verified commit; never layer a fallback over the active runtime.
