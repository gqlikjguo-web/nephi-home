# Change and rollback policy

- Every runtime change starts from one baseline commit and one explicit scope.
- Keep one test-only LINE route, one V2 composition root, one engine, one coordinator, one state reducer, one resolver adapter, one response planner, and one controlled composer.
- Do not add a second route, gateway, coordinator, engine feature flag, bridge, identity guard, destination guard, SHA256 guard, push fallback, or alternative conversation path.
- A change that alters runtime wiring must update the architecture and constitution contract tests in the same commit.
- Golden Matrix cases are versioned acceptance contracts: add a case before changing the covered behavior; do not weaken or delete an assertion to make a regression pass.
- Run the focused checks and `npm test` before committing; a failure blocks the commit.
- Commit only the reviewed scope. Push only `test-only/node-pilot-integration`.
- Test-only deployment verification, when separately authorized, is Verify 200, one event claim, one V2 execution, and one reply. No production environment is used.
- A rollback is a new, explicit test-only commit restoring the prior verified commit; never layer a fallback over the active runtime.
