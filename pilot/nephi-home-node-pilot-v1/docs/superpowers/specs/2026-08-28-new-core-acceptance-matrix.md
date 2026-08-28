# JunZan AI 新核心 Acceptance Matrix

**Status:** `DESIGN_FROZEN`; these are acceptance definitions, not current PASS claims.

**Evidence classification:** deterministic contract/component tests are not REAL_OPENAI/REAL_POSTGRESQL/REAL_LINE/REAL_RENDER evidence. Every result report must retain its actual level.

## Global gates

1. Existing protected PASS behavior may not regress. A regression stops the phase; acceptance is never edited in the same runtime change.
2. REAL_OPENAI variance-sensitive cases run at least 5 independent calls on the exact candidate SHA and record semantic shape plus C11 execution markers. Any variance increases the sample and blocks stability claims until analyzed.
3. A target PASS without the expected new boundary/rule marker is `SAMPLING_DRIFT`, not proof.
4. Shadow side-effect counters for state, message, review, Resolver, PostgreSQL mutation, and LINE must all equal zero.
5. Unknown formal data is never asserted as No. Fake/mock/seed/recorded inputs never answer production.
6. Every multi-unit assertion checks coverage, unit outcome, lifecycle, canonical item ownership, and final partial aggregation—not only final text.

## Contract and evidence (37 cases)

| IDs | Cases | Required oracle |
|---|---|---|
| AC-CON-001..004 | valid bounded input; duplicate source ID; unverified property; unbounded/invalid history | only valid C01 reaches OpenAI |
| AC-WIR-001..008 | valid 0/1/N units; duplicate unit/turn-wide slot ID; unknown field; invalid enum; cardinality overflow; facts/canonical field injection | invalid C02 fails at Wire Schema Validator with owned code |
| AC-EVD-001..010 | exact span; unique relocated exact span; ambiguous quote; unknown event; message/event conflict; range errors; quote mismatch; cross-source; Unicode offsets; evidence mutation attempt | one evidence authority; no semantic changes |
| AC-SEM-001..010 | valid capability/subject/stay tuples; closed temporal and slot candidates (including non-canonical partial dates); invalid catalog ID; cross-property ID; capability-subject conflict; stay conflict; missing evidence; unsupported purpose; duplicate ownership; semantic field mutation | valid unit preserved byte-for-byte; conflict rejects unit |

Additional semantic ownership cases `AC-SEM-011..015` cover inventory-vs-property family separation, structural-vs-semantic validity, orphan unit ownership, duplicate unit ownership, and an unsupported tuple that must be rejected without a replacement capability.

## Unit routing and historical failure classes (29 cases)

| IDs | Coverage | Required oracle |
|---|---|---|
| AC-RTE-001..004 | valid ANSWER/CLARIFY/HANDOFF/NO_REPLY | exact C07 truth-table shape |
| AC-RTE-005..008 | ANSWER without executable need; CLARIFY without guest field; HANDOFF without operator/risk basis; NO_REPLY with executable item | owned routing failure, no fallback route |
| AC-RTE-009..012 | acknowledgement, correction, supplement, social | non-actionable unit can route NO_REPLY independently of lifecycle |
| AC-RTE-013..016 | lodging question ready/missing input; operator request; high risk | ANSWER/CLARIFY/HANDOFF according to explicit basis |
| AC-RTE-017..020 | unknown intent; unknown official fact; context-only update; active pending operator continuation | unknown does not choose route; other three follow their verified contract |
| AC-FCL-001..009 | semantic contract validation; attributable semantic path; capability; room scope; bundle scope; evidence; clarification stability; mixed question; multi-turn continuation | each historical failure class has one earliest boundary and unit-level oracle |

## Availability, price, temporal, readiness (40 cases)

| ID | Input/condition | Expected |
|---|---|---|
| AC-AVL-001 | explicit date + room availability | ANSWER, room subject, stay dependent, availability resolver |
| AC-AVL-002 | explicit date + bundle availability | same for verified bundle |
| AC-AVL-003 | relative date + room | existing Temporal resolves from event/property timezone |
| AC-AVL-004 | generic “還有房嗎” without date | CLARIFY missing stay date; no Resolver |
| AC-AVL-005 | matched room set | complete verified set, no arbitrary room selection |
| AC-AVL-006 | 2026/10/09–10/10 bundle reservability | availability never rewrites to property_fact |
| AC-AVL-007 | named 302 four-person room + date | room identity retained |
| AC-AVL-008 | next-year 2/4–2/7 booking-open question | availability/available_dates unit, canonical Temporal outcome |
| AC-AVL-009 | inventory subject collides with property fact ID | registry rejects conflict; no semantic rewrite |
| AC-AVL-010 | missing/unreliable inventory row | Unknown, never No |
| AC-PRI-001 | room price + exact date | ANSWER through formal price authority |
| AC-PRI-002 | bundle price + exact date | bundle identity retained |
| AC-PRI-003 | “包棟多少” without required date | CLARIFY, not handoff |
| AC-PRI-004 | date price | canonical date retained |
| AC-PRI-005 | total price + nights | total_price, no availability rewrite |
| AC-PRI-006 | price + facility condition | separate units; neither swallowed |
| AC-PRI-007 | missing formal price | Unknown policy, never fabricated/No |
| AC-PRI-008 | same property labels across properties | property-scoped result only |
| AC-TMP-001 | absolute date | canonical Temporal sole executable dates |
| AC-TMP-002 | relative day | property timezone/event clock |
| AC-TMP-003 | relative weekday | correct future date |
| AC-TMP-004 | cross-month range | exact checkIn/checkOut/nights |
| AC-TMP-005 | cross-year range | exact year transition |
| AC-TMP-006 | month-qualified weekday | narrower Planner span cannot erase month |
| AC-TMP-007 | explicit nights | consistent checkout |
| AC-TMP-008 | contradictory dates/nights | unresolved/clarify, no Resolver |
| AC-TMP-009 | partial stay fields | valid field retained; missing companion clarified |
| AC-TMP-010 | two stay-dependent units with different spans | no cross-unit date leakage |
| AC-TMP-011 | approved context date reuse | only validated link reuses date |
| AC-TMP-012 | current unresolved date with old state | old date expires; no stale query |
| AC-RDY-001..010 | capability required-field table: availability, available_dates, price, total_price, property fact, policy, location, capacity, operator, high-risk | CLARIFY only for guest-required missing fields; no capability selection in readiness |

## Facts, amenity, policy, location (20 cases)

| ID | Case | Expected |
|---|---|---|
| AC-FCT-001 | breakfast provided by property | property fact authority |
| AC-FCT-002 | amenity list | amenity collection; no external-place confusion |
| AC-FCT-003 | parking convenience/rain/holiday | official parking fact |
| AC-FCT-004 | drinking water | official fact |
| AC-FCT-005 | elevator | official fact |
| AC-FCT-006 | TV | official fact |
| AC-FCT-007 | pet policy | policy authority |
| AC-FCT-008 | KTV/hours | facts/policy units as understood; no time->availability rewrite |
| AC-FCT-009 | address | official address fact |
| AC-FCT-010 | room-specific bathtub | verified room fact |
| AC-FCT-011 | equipment unknown | Unknown, not No |
| AC-FCT-012 | fact plus unrelated inventory | separate units |
| AC-FCT-013 | catalog alias ambiguity | reject/clarify; no alias-based semantic routing |
| AC-FCT-014 | duplicate FAQ/structured subject | formal authority resolves facts without changing capability |
| AC-LOC-001 | nearby breakfast shop | location + external place |
| AC-LOC-002 | nearby restaurant with delivery/use description | remains location unless separate operator request is explicit |
| AC-LOC-003 | nearby convenience store | location |
| AC-LOC-004 | nearby station | location |
| AC-LOC-005 | omitted property subject with current verified property | location tied to C01 property scope |
| AC-LOC-006 | property-owned service request | not location; operator/fact route as explicit unit |

## No-reply, lifecycle, Context, pending (50 cases)

| IDs | Cases | Required oracle |
|---|---|---|
| AC-NRP-001..008 | “好”; “了解，謝謝您”; “好的”; “可以”; “了解”; “哈哈哈好喔謝啦”; “？”; “？？？” | NO_REPLY, no canonical/Resolver/FinalResponse/LINE |
| AC-NRP-009..012 | native sticker/image/video/file | input-level NO_REPLY; no OpenAI where existing native contract says ignore |
| AC-CTX-001..004 | continue with slot; supplement; “我們4位”/“改成4位”; “改成包棟” | OpenAI link candidate validated; guest count maps only to V3 `guestCount`; product is current-property catalog validated and maps only to existing lodging-product fields; no raw-text state write |
| AC-CTX-005..008 | explicit “不用了” END active; end ended; target expired/unknown; cross-property target | unique valid END applies with zero executable item; unavailable targets share the honest unavailable result when C01 cannot distinguish their history; scope conflicts reject; never guessed |
| AC-CTX-009 | capability switch | new unit START; old capability cannot overwrite it |
| AC-CTX-010 | “想了解包棟的” after active relevant cycle | unique link or CLARIFY; no generic handoff from parser failure |
| AC-CTX-011 | same capability/same product continuation | CONTINUE |
| AC-CTX-012 | same product/new capability | new capability retained |
| AC-CTX-013 | latest answered continuation within TTL | reference allowed |
| AC-CTX-014 | answered continuation outside TTL | target rejected |
| AC-CTX-015 | “有開車”; “我們4位、有開車，謝謝” | context-only MODIFY; guest count may persist through the sole V3 reducer, transport remains validated turn context with no fake field; NO_REPLY is Task 7 authority; zero C08/Resolver |
| AC-CTX-016 | “不是這個” | correction NO_REPLY with validated MODIFY/NONE; no fake task |
| AC-CTX-017 | “不是這個，我要問停車” | correction NO_REPLY plus parking ANSWER |
| AC-CTX-018 | “謝謝，取消剛才那個” | acknowledgement NO_REPLY plus lifecycle-only END; booking cancellation remains distinct |
| AC-LIF-001..005 | START/CONTINUE/MODIFY/END/NONE valid shapes | exact target cardinality and ownership |
| AC-LIF-006..010 | duplicate lifecycle ID; unknown unit; start target; missing continue target; scope conflict | fail closed at lifecycle owner |
| AC-LIF-011..014 | lifecycle-only END/MODIFY/NONE; no-reply update | zero executable items; END and allowlisted existing V3 slots persist through the sole reducer, turn-context-only slots do not mutate V3 |
| AC-LIF-015..018 | task-owned continue; active pending; ended pending; ambiguous targets | actionable valid continuation preserved; invalid not silently downgraded |
| AC-PND-001..004 | active lodging continuation with verified slot; no useful slot; new independent request; dormant pending | exact validated behavior; no automaticPendingRelation |
| AC-PND-005..008 | pending availability date, product, guests, and capability switch | canonical slots and explicit links only |

## Multi-intent, partial answer, operator and safety (34 cases)

| ID/range | Case | Expected |
|---|---|---|
| AC-MUL-001 | acknowledgement + availability | ack NO_REPLY; availability ANSWER/CLARIFY |
| AC-MUL-002 | correction + parking | correction NO_REPLY; parking ANSWER |
| AC-MUL-003 | acknowledgement + lifecycle END | silent end, no task |
| AC-MUL-004 | parking + availability + operator request | three unit outcomes retained |
| AC-MUL-005 | facts + price | both covered |
| AC-MUL-006 | formal fact + unknown fragment | formal answer retained; unknown unit explicit, not global handoff |
| AC-MUL-007 | external place + independent service request | separate location and operator units |
| AC-MUL-008 | two date/product questions | no slot/evidence leakage |
| AC-MUL-009 | one invalid sibling | valid sibling proceeds; invalid diagnostic retained |
| AC-MUL-010 | duplicate semantic meaning | OpenAI units may be deduplicated only by explicit identity/evidence contract, never raw text |
| AC-MUL-011..014 | 1->2, 2->1, orphan, duplicate ownership mutations | fail at ownership validator |
| AC-PAR-001..005 | answer+handoff; answer+clarify; two answers+handoff; failed unit+answer; location+operator | safe partial aggregation, no sibling erasure |
| AC-PAR-006..010 | downstream Unknown + answer; claim rejection + answer; Composer failure + answer; no-reply sibling; ordering | existing FinalDecision rules preserve scoped safe result |
| AC-HOF-001 | access credential | explicit high-risk HANDOFF |
| AC-HOF-002 | payment claim | explicit high-risk/operator HANDOFF |
| AC-HOF-003 | operator action request | explicit operator basis required |
| AC-HOF-004 | reservation cancellation/refund approval | HANDOFF; dialogue END alone cannot claim cancellation |
| AC-HOF-005 | date change requiring booking mutation | HANDOFF |
| AC-HOF-006 | special arrangement/commitment | HANDOFF |
| AC-HOF-007 | protected active pending lodging continuation | remains HANDOFF when verified operator need persists |
| AC-HOF-008 | unknown intent only | neither automatic HANDOFF nor NO_REPLY; understanding failure policy records it |
| AC-HOF-009 | missing guest date | CLARIFY, not HANDOFF |
| AC-HOF-010 | missing official fact | capability-specific Unknown handling, not automatic operator claim |

## Property, integrity, observability, shadow, rollback (53 cases)

| IDs | Coverage | Required oracle |
|---|---|---|
| AC-ISO-001..004 | verified binding; forged propertyId; cross-property Context target; cross-property catalog ID | only verified property scope survives |
| AC-CAN-001..012 | valid C08 for major capability families; non-answer item; missing evidence; ownership mismatch; resolver mismatch | only canonicalizer writes executable semantics |
| AC-INT-001..006 | Resolver/PostgreSQL sole facts; Claim rejection cannot revive; FinalDecision sole action; FinalResponse sole text; no-reply no LINE; production missing DB fails closed | unchanged downstream authority |
| AC-OBS-001..012 | boundary success/failure; earliest code; unit IDs; lifecycle/route/canonical enums; privacy allowlist; unknown code; diagnostic exception; provider timeout vs schema; target marker; bounded count; exact core version | diagnostic is sufficient and behavior-neutral |
| AC-SHD-001..010 | same input; no state write; no message; no review; no Resolver; no DB mutation; no LINE; safe record; canonical diff; shadow exception isolation | all side effects zero |
| AC-MUT-001..006 | keyword route; regex route; exact phrase; property patch; automaticPendingRelation; second facts writer | static/mutation tests fail when injected |
| AC-MNT-001..010 | one writer per C01-C11; one failure owner; no god function; independent tests; no duplicate semantic/evidence/reply/context authority; adapter-only index; no shadow writer | architecture lint/ownership manifest passes |
| AC-ORC-001..006 | broad action alternative; fixture-only PASS; recorded replay; isolated DB; single OpenAI run; fake helper semantic inference | cannot satisfy formal/real acceptance |
| AC-ATT-001..002 | target result without marker; marker on wrong case | classified sampling drift/false attribution |
| AC-OAI-001..003 | equivalent acknowledgement, availability, clarification inputs repeated >=5 | shape distribution recorded; no single-run claim |
| AC-RBK-001..012 | each proven/unknown rollback family | forbidden approach absent; conservative invariant passes |
| AC-REG-001 | complete protected baseline comparison | zero prior-PASS regression |

## Historical 113-review preservation (1 coverage set)

`AC-113-001` imports the **behavior taxonomy**, not fixture authority, from the complete repository set loaded by `scripts/run-deployed-conversation-acceptance.js`: `real-guest-fixed-matrix.json` (53 cases/61 turns), `real-guest-supplemental-matrix.json` (24 cases/29 turns), and `real-guest-generalization-matrix.json` (36 cases/45 turns). Together they preserve **113 cases/135 turns**. Every stored turn must map to one or more new unit/routing/lifecycle acceptance assertions. The separate `HIGH_FREQUENCY_6X3_MATRIX` adds 18 repeated-run cases/24 turns and remains variance evidence, not another source case set. No prompt may be invented or silently removed.

Required mapped categories include colloquial/typo availability, room facts, fees, assumptions, mixed booking, multi-question, context sibling, correction, incremental context, high-risk cancellation/payment/access/refund/media, unknown fact, acknowledgement, punctuation, and conflicting external claims.

## Latest production real-provider suite (minimum 5 each)

| ID | Trace-linked input | Expected stable unit shape |
|---|---|---|
| AC-PRD-001 | A “好” | acknowledgement NO_REPLY/NONE |
| AC-PRD-002 | B “了解，謝謝您” | acknowledgement NO_REPLY/NONE |
| AC-PRD-003 | C driving/guest-count thanks | context updates NO_REPLY; no executable item |
| AC-PRD-004 | D next-year 2/4–2/7 booking-open | availability/available_dates + temporal candidate; not amenity/property fact |
| AC-PRD-005 | D follow-up bundle | validated continuation/product link or scoped clarification |

## Count

The enumerated matrix contains **306 individual acceptance IDs** when numeric ranges are expanded, including the single `AC-113-001` protected-artifact coverage set. This count is a design inventory, not a pass count. Implementation must machine-check ID uniqueness, evidence crosswalk references, and replacement coverage before any old implementation-bound test is retired.
