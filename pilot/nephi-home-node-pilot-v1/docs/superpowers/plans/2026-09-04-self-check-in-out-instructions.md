# Self Check-in/out Instructions Implementation Plan

1. Add a failing contract/storage/UI/execution characterization runner for the approved `policy/self_check_in_out_instructions` design.
2. Add the structured property setting to existing JSON and PostgreSQL property-profile wiring without a migration.
3. Project the setting as one property-catalog policy fact and apply its month/expiry metadata in the existing property-catalog executor.
4. Extend the shared policy guidance so Luna, C03, and C07 use the same declarative capability policy.
5. Add the four fields to the existing Other Settings form using only existing form classes and controls.
6. Run targeted GREEN, affected regressions, integrity checks, then fast-forward production and verify Render health/SHA.
