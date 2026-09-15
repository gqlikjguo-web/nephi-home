# Public content and internal metadata

Baseline: 00170c08be5e3b8840f0669d16288250607e65c8.

The property-catalog Resolver (`executeQueryPlan`) returns an unknown qualified condition separately from `knownFacts.answer`, with `answerScope=general_policy`. `taskResultForExecution` projects the known facts into a FACTUAL_ANSWER. Claim validation verifies this scope and execution provenance; FinalDecision authorizes its reply. ResponsePlan preserves the facts in per-task render obligations. `fragmentsFor` calls `composeSection`, which previously translated the internal scope into the guest prefix `一般政策：`. This was the first text contamination point; the actual stored operator answer did not contain that prefix.

The composer now returns the original `facts.answer` for this typed partial-answer path. Scope, outcome, provenance, claim validation, State and public decision remain unchanged. There is no text filtering or model rewrite. The two former prefix expectations in the policy responsibility runner are intentionally updated for the approved public-content Contract; their scope, Unknown, provenance, forged-facts and foreign-task assertions are retained.

Direct consumers: response planner/composition comparison, render obligation fragments and grouping, claim text validation, FinalResponse byte validation, and the compatibility composed-section consumer. Public content may come from owner-authored answer/custom reply, catalog public names and registered fact values, business applicability names/notes, authorized clarification prompts and public references. `answerScope`, source/property/task identifiers, claim/outcome classes and diagnostic values may select/validate a path but are not public text.

Other label mappers inspected in the same composer are OPERATOR_REQUEST_LABELS, RISK_REQUEST_LABELS and detailLabel. The current scoped public path intercepts HANDOFF with its authorized fixed text, suppresses internal Unknown/processing outcomes, and renders only known `facts.answer` for detailNeedsConfirmation. Those compatibility/internal templates are not newly enabled or changed. Public bundle applicability and registered-price qualifications convey formal business facts and must not be stripped as engineering metadata.

Generalized regression: parking, checkout, another policy, custom check-in/out text, multiple tasks and original owner wording which itself contains the former label. These traverse the official core with queued Understanding; they are not REAL provider tests. Existing policy/claim/coverage controls remain required. Run via the existing `test:new-core-phase1-boundaries` entry. Evidence is saved under `/home/gqlik/junzan-metadata-boundary-20260914`.

## Fixed-upstream verification

Evidence: `/home/gqlik/junzan-metadata-fixed-20260915`. Replayed the exact captured Understanding against baseline 00170c08 and candidate, with separate native provider instances and the same validation clock. All 23 comparisons preserve source input (except diagnostic traceId), canonical requests, Resolver semantic outcomes, FinalDecision and unaffected bytes; no baseline PASS becomes candidate FAIL. Current-core 118/118 and historical 17/17 passed.

The 21 REAL OpenAI/PostgreSQL captures pass the metadata check. Broader behavioral expectations pass 20/21: the payment request with upstream relation NONE yields NO_REPLY in both versions. Replaying NEW_REQUEST yields HANDOFF in both. This pre-existing upstream difference is retained as an unresolved issue, not relabeled as a metadata regression or a repaired payment flow. No additional OpenAI calls were made to obtain a passing relation.
