# Phase 1: scoped reply responsibility and operator arrival/departure text

Baseline: c021f812fdd9e51ca07b028da9ede706e9cf8b21. Changes are developed in the isolated candidate; deployment requires the existing full verification sequence.

## Proven incident boundaries

- Acknowledgment + official policy: FinalDecision previously issued public actions only for presentation sections, omitting ABSENT obligations. Actual byte validation rejected the missing decision and rebuilt the known answer. Issue explicit, scoped silent decisions from existing ABSENT/SUPPRESSED evidence; permitted missing outcomes remain invalid. No validator relaxation.
- A catalog identity with no answer/status was treated as answered, invoking composer fallback text. The formal catalog Resolver now reports Unknown for missing general answer evidence or an empty registered amenity collection. Explicit positive/negative facts, nonempty collections, registered details and static capacity retain their original handling.
- Risk responsibility: high_risk required an other_verified catalog ID, eliminating the supported provider schema branch in properties with no such catalog item. Existing HANDOFF policies now share nullable other_verified admission. C03 safety evidence and C07 responsibility validation remain required. This never creates a facts identity, catalog item, database row or handoff for arbitrary failure.
- A cited conversation message without any C01 request binding cannot be a Context target. Once C05 formally rejects this targeted relation, the existing correction controller permits its single correction using the same C01 snapshot. Trusted semantics, quantity and siblings remain preserved; no cycle or dates are inferred. Expired/ambiguous targets retain their validation behavior.

Evidence: property-scoped production message-log reads and isolated REAL OpenAI/PostgreSQL captures in `/home/gqlik/junzan-phase1-policy-text-20260914`. New incident timestamps precede c021 deployment; the 12:37 availability/price event occurred after it and failed initial schema validation followed by correction timeout. Its missing historical raw violation details are not reconstructed from a later successful replay.

## Operator text contract

`commonAnswers.checkInGuestText` and `checkOutGuestText` are optional strings in the existing property JSONB and existing authenticated profile writer. No SQL migration or new persisted container. Structured `checkInTime` and `checkOutTime` remain unchanged. Each string is at most 500 code units, matching the existing profile explanation limit; invalid types/overlength fail before writing. Nonblank text is stored verbatim; blank clears; omitted keys preserve existing values for older clients.

The operator profile fields override only the same base check_in/check_out catalog identity while nonempty. Clearing restores existing base policy/time resolution. Early arrival, latest arrival, self-service policy, temporal facts, room inventory and other property scopes are untouched. The existing Resolver, claim validation and FinalResponse carry the operator text without an AI rewrite.

## Consumers and regression

- profile API / service-data-access / existing PostgreSQL JSONB writer / catalog / Resolver / FinalResponse: `custom-arrival-departure-text-runner` covers save, clear, omitted keys, reload, exact bytes, auth and foreign-property rejection.
- actual admin load/submit/payload handlers: `admin-arrival-departure-text-runner` uses DOM/API doubles; this is not a browser or production-admin claim.
- FinalDecision / render obligations / actual bytes / safety rebuild: `new-core-absent-sibling-reply-runner` plus existing typed coverage, public reply, safety and presentation runners.
- catalog Resolver / Unknown provenance / scalar and collection facts: `new-core-catalog-answer-evidence-runner` plus existing collection/capacity/policy/reliability runners.
- schema / C03 / C07 / final handoff: `new-core-risk-admission-runner` covers all registered risk classes, with no catalog item.
- correction / Context / preserved typed values: `new-core-unbound-context-correction-runner` plus existing correction, semantic obligation and context lifecycle runners.

Permanent natural-language observations are in `tests/fixtures/phase1-latest-incidents-20260914.json` and appended to `phase1-real-eval.json`. The originals are recorded observations, not newly executed REAL tests. Generalized regressions are included in the existing `test:new-core-phase1-boundaries` entry.

Unregistered roomCompositionV1 and unregistered applicability/payment conditions remain missing formal data. No count, eligibility, concession, or bank account is invented. User LINE acceptance remains required after deployment.

## Candidate verification

117/117 current-core runners passed, including all 17 retained historical regression runners; five changed consumer groups are covered. The read-only REAL OpenAI + PostgreSQL production-adapter evaluation passed 20/20 cases, including three new incidents and a two-turn booking continuation. Protected, integrity and core-change preflight passed. These are isolated-candidate results, not user LINE acceptance. Exact logs and source hashes are saved in the evidence directory above.
