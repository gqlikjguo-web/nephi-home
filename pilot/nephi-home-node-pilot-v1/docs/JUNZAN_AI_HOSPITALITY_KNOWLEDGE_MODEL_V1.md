# JunZan AI Hospitality Knowledge Model V1

## Status and scope

This is the approved design specification for the first JunZan AI hospitality knowledge model. It is a design contract, not a runtime implementation.

V1 automatically answers only questions made before arrival or before booking that can be answered from property-scoped, publicly authorized facts. It covers:

- availability, room type, price, whole-property booking, and occupancy;
- facilities, activities, and lodging rules;
- extra guests, extra beds, children, pets, booking, payment, cancellation, arrival, parking, and location; and
- other property-authorized pre-booking or pre-arrival policies.

V1 never executes a cancellation, reschedule, refund, payment confirmation, booking change, identity verification, or any other business operation. It may explain a policy, but it must never claim that an operation was completed.

All during-stay and post-stay matters use Human Handoff: faults, lockouts, outages, leaks, lost property, complaints, deposits or damage disputes, invoice reissue, and emergencies.

When one message contains both answerable and Human Handoff questions, answer every supported question and hand off only the unsupported or human-required part.

## Normative architecture

The only permitted direction for customer-facing facts is:

```text
Natural language
  -> Planner
  -> Capability
  -> Fact Contract
  -> Property Facts
  -> Policy
  -> Controlled Composer
  -> Reply
```

| Layer | Responsibility | Must not do |
|---|---|---|
| Planner | Understand natural language, typo and synonym variants, context, and split independent questions into tasks. | Decide facts, prices, availability, or wording. |
| Capability | Define a reusable lodging ability requested by the guest. | Contain a property-specific answer. |
| Fact Contract | Define the structured evidence, statuses, validation, and public boundary required by one Capability. | Contain property data. |
| Property Facts | Store property-authorized facts under exactly one `propertyId`. | Appear in Core, prompts, fixtures used at runtime, or hardcoded maps. |
| Policy | Determine public eligibility, answer status, sensitive-data protection, and whether Human Handoff is required. | Guess missing facts or execute business operations. |
| Controlled Composer | Combine only Policy-approved Resolver facts into a natural multi-part reply. | Add facts, promises, actions, or unsupported inferences. |

The Resolver is the only source of customer-facing facts. Availability remains the sole source for availability and date answers; every non-availability capability resolves only through its own Fact Contract and property-scoped facts.

## V1 capability catalog

| Capability | V1 responsibility |
|---|---|
| Availability | Dates, availability, room types, prices, capacity, and whole-property availability. |
| Occupancy | Room capacity, extra guests, extra beds, children, infants, fees, and restrictions. |
| Facilities | In-room amenities, supplies, shared facilities, Wi-Fi, kitchen, elevator, bathtub, and other facilities. |
| Activities | BBQ, pool, singing, mahjong, board games, game equipment, fees, hours, and use restrictions. |
| Policies | Check-in/out, pets, smoking, visitors, quiet hours, cleaning, and lodging rules. |
| BookingPolicy | Booking channel, deposit, final payment, payment methods, transfer process, and invoice or receipt policy. |
| ChangeAndCancellationPolicy | Cancellation, refund, postponement, rescheduling, weather policy, and change policy. It explains policy only. |
| Arrival | Arrival time, latest arrival, self check-in, luggage storage, pre-arrival information, parking, and pickup. |
| Location | Property location, address, navigation, nearby locations, distance, route, travel time, and transportation questions. |
| HumanHandoff | During-stay failures, emergencies, lost property, complaints, disputes, and every required human operation. |

The names may align with existing implementation names, but their meaning and responsibility must not be reduced.

## Location contract: Google Maps only

Every location, route, distance, transport, and surrounding-area question maps to the single `Location` Capability. This includes property address, navigation, night markets, interchanges, convenience stores, supermarkets, stations, attractions, travel duration, convenience, and nearby recommendations.

The only V1 public fact for this Capability is the property-scoped `google_maps_url`.

The Resolver returns that URL if it is present and publicly authorized. The Composer returns that URL without adding distance, time, nearby merchant names, or a claim that somewhere is near. If `google_maps_url` is missing, Location is `not_provided` and fails closed with a local Human Handoff or confirmation boundary.

V1 must not:

- calculate kilometres or travel time;
- decide whether a place is near or convenient;
- search for the nearest merchant or attraction;
- create per-place keyword branches;
- hardcode any property map URL; or
- synthesize a map-search URL when the property did not provide one.

## Fact Contract standard

Every Capability contract defines:

- required facts and optional facts;
- type, validation, and property scope for every fact;
- one public status;
- relevant constraints and public boundary;
- missing-data behavior; and
- whether Human Handoff is required.

### Shared status model

| Status | Meaning | Customer behavior |
|---|---|---|
| `yes` | The property explicitly provides it. | Answer the authorized facts. |
| `no` | The property explicitly does not provide it. | Clearly say it is not provided. |
| `conditional` | It is available only with stated conditions. | State the known conditions, fees, hours, and limits. |
| `not_provided` | The property has not supplied a fact. | Never convert this to `no`; give a local confirmation or handoff boundary. |
| `unavailable` | The fact cannot currently be relied on, such as an unavailable source. | Do not infer an answer; use a local confirmation or handoff boundary. |
| `requires_human` | The subject is a human action, sensitive case, or non-automatable operation. | Explain that the property team must handle it; never promise completion. |

Each contract must distinguish these statuses in data and tests. Free text may be a public note, but it must not be the sole representation of fields that require structured policy decisions.

### Missing-fact policy

`not_provided` is permanently distinct from `no`. Policy chooses the customer-facing boundary according to the impact of the missing fact:

| Missing-fact situation | Policy result |
|---|---|
| Low-risk general information | State only that the specific detail is not yet confirmed. For example, if a hair dryer is confirmed but its brand is not supplied, answer that a hair dryer is available and its brand is not confirmed. |
| Some facts are known | Preserve and answer every known fact. Only the missing detail receives a local not-confirmed statement or local handoff. A generic whole-message fallback is prohibited. |
| It affects price, eligibility to stay, use rights, transport, or arrival arrangements | Hand off only the missing consequential detail. Examples include extra guests, extra beds, child fees, pickup fees, and facility reservation conditions. |
| It needs execution, emergency handling, or dispute resolution | Always use Human Handoff. This includes cancellation execution, rescheduling, refund execution, payment confirmation, faults, lockouts, lost property, complaints, and deposit disputes. |

`unavailable` follows the same no-invention boundary, but communicates that a normally relevant source cannot presently be relied on. Neither status permits the Composer to infer a negative answer.

### Required V1 contract fields

#### Availability

- Required: `check_in`, `check_out`, inventory scope, availability source result, and property scope.
- Optional: guests, room type, whole-property mode, price override, and nights.
- Public boundary: only current Resolver facts; no reservation promise.
- Missing or unreliable availability: `unavailable` or a targeted clarification, never a fabricated no-availability answer.

#### Occupancy

- Required: `extra_guest_allowed`, `extra_bed_allowed`, and `public_note`.
- Optional: `max_extra_guests`, `extra_guest_fee`, `extra_bed_type`, `extra_bed_fee`, `child_age_rules`, and `notice_required`.
- Constraints: capacity validation remains Availability's responsibility; Occupancy only states policy.
- Missing facts: `not_provided`, with only this sub-question handed off.

#### Facilities

- Required: stable canonical fact identifier, `status`, and public display name.
- Optional: `public_note`, availability scope, fee, hours, reservation requirement, and restrictions.
- Constraints: Wi-Fi passwords, lock codes, internal notes, and non-public access information are never public facts.

#### Activities

- Required: stable canonical fact identifier, `status`, and `public_note`.
- Optional: `usage_scope`, `fee`, `reservation_required`, `available_hours`, `equipment`, `weather_restriction`, and `noise_rule`.
- Constraints: conditional use must retain every known condition. A conditional activity is not a blanket yes.

#### Policies

- Required: stable canonical policy identifier, `status`, and `public_note`.
- Optional: applicability scope, notice requirement, fee, time window, and restrictions.
- Constraints: policy explanation is not authorization for an exception.

#### BookingPolicy

- Required: `status` and `public_note`.
- Optional: booking channel, deposit policy, payment methods, transfer instructions, payment deadline, invoice or receipt policy, and notice requirement.
- Constraints: transfer confirmation, payment reconciliation, and order changes are always `requires_human`.

#### ChangeAndCancellationPolicy

- Required: `cancellation_allowed`, `refund_rules`, `postponement_allowed`, and `public_note`.
- Optional: `postponement_limit`, `weather_policy`, `change_policy`, and cutoff conditions.
- Constraints: cancellation, refund, postponement, and rescheduling execution are always `requires_human`; this Capability only explains rules.

#### Arrival

- Required: check-in and check-out public policy where supplied.
- Optional: latest arrival, self check-in status, luggage storage, pre-arrival information, parking instructions, and pickup policy.
- Constraints: actual door codes and other sensitive arrival secrets are never public facts.

#### Location

- Required: `google_maps_url` for an answer.
- Optional: none in V1.
- Missing fact: `not_provided`; no generated link, distance, time, or nearby recommendation.

#### HumanHandoff

- Required: category and public handoff note.
- Constraints: it never claims a ticket, reservation, refund, change, or notification has already been completed unless a separately approved execution system provides a confirmed fact.

## Property Facts ownership

Property Facts are property-scoped, admin-maintained records. They use stable generic identifiers and are resolved only for the requested `propertyId`.

Property Facts must preserve:

- canonical identifier and display label;
- status;
- structured contract fields;
- public note;
- source and update metadata suitable for audit; and
- public/sensitive classification.

Canonical identifiers and aliases are generic capability metadata, never individual property answer text. A property’s FAQ answer must not rely solely on an arbitrary question string being repeated exactly by a guest.

## Onboarding and admin responsibility

Onboarding has three tiers.

| Tier | Data |
|---|---|
| V1 required | Basic property information, room types and prices, check-in/out, parking, deposit and payment policy, cancellation/refund/postponement policy, extra guest and child policy, core facilities and activities, pets and critical lodging rules, and `google_maps_url`. |
| High-frequency | Self check-in, luggage storage, visitor/smoking/quiet rules, kitchen, Wi-Fi policy, elevator, bathtub, breakfast, laundry, drinking water, entertainment, and arrival constraints. |
| Low-frequency optional | Specific equipment brands, towel replenishment frequency, mahjong hours, kitchen utensil detail, baby supplies, birthday decoration, pickup detail, special requests, and other infrequent rules. |

Low-frequency facts are always optional. Their absence must not block Onboarding, approval, property activation, or the property's use of JunZan AI. They remain available for the owner to add later in the admin backend.

The admin backend must let each property owner view and change every public Property Fact, including status, structured fields, public note, and the Google Maps URL. A committed update must become visible to the Resolver without platform personnel writing property-specific code.

Onboarding and approval preserve the same canonical Fact Contract. Approval must materialize structured facts rather than flattening them into unmatched free-text keys.

Property owners provide facts and rules, not a catalogue of possible guest phrasings or finished response prose. Planner understanding, task decomposition, Policy, and Controlled Composer wording remain shared Core responsibilities.

## Reply behavior contract

1. `yes`: answer using the authorized fact.
2. `no`: clearly state the property does not provide it.
3. `conditional`: answer every known condition, cost, time, and restriction.
4. `not_provided` or `unavailable`: do not say no. Apply the Missing-fact policy: low-risk information may say the detail is not confirmed; consequential missing details require a local Human Handoff.
5. `requires_human`: hand off naturally without a completion promise.
6. Multiple questions: Plan, resolve, and cover each task independently, then compose one reply. An unknown or human-required task must not suppress other trusted answers in the same message.
7. Mixed availability and FAQ: Availability uses the sole availability Resolver; every other task uses its own contract. One unknown must not suppress known answers.
8. Location: return only the property’s `google_maps_url` when available.
9. Sensitive information: credentials, internal notes, lock codes, Wi-Fi passwords, and non-public data cannot be output unless a future approved contract expressly permits it.

## Non-negotiable Core and property boundary

The following are permanently prohibited:

- `if (propertyId === "nephi_home")` or any equivalent property branch;
- property answers in Core, planner prompts, or runtime fixtures;
- one-off keyword, regex, substring, or single-question patches as semantic routing;
- a code branch for every FAQ question;
- cross-property reads;
- AI-created prices, distances, facilities, policy, or availability;
- bypassing the Resolver to create a customer-facing fact.

Any Core change must serve every property. A property difference must be expressed through Property Facts only.

## Required regression guards

Future implementation is incomplete unless all of these are executable and required by CI:

1. runtime architecture uniqueness;
2. Fact Contract validation;
3. Resolver-only fact sourcing;
4. `not_provided` and `unavailable` never becoming `no`;
5. low-risk missing details returning only a not-confirmed boundary;
6. consequential missing facts (fees, eligibility, use rights, transport, or arrival arrangements) producing a local Human Handoff;
7. partial known facts remaining present when another detail is missing;
8. a multi-question message with an unknown task never degrading into a whole-message fallback;
9. approval and activation succeeding when low-frequency optional facts are absent;
10. property isolation;
11. complete multi-question task coverage;
12. Controlled Composer factuality and claim validation, including no invented brand, fee, hour, restriction, or completed-operation promise;
13. date, availability, Location, and property-isolation regression coverage;
14. Onboarding to approval to property-fact end-to-end coverage;
15. composition-root integration coverage;
16. Golden Acceptance Matrix coverage, including mixed known and unknown tasks;
17. CI execution of the complete test command;
18. migration and backfill rollback coverage; and
19. guards against deleting cases, weakening expectations, skipping tests, or lowering assertions to obtain a passing build.

## Ordered V1 implementation and stop gates

### Phase 1: existing canonical facts

Repair generic canonical identifiers, aliases, and cancellation mapping for facts already supplied by properties.

**Stop Gate:** singing and cancellation policy answer correctly from existing data; date, availability, parking, BBQ, and pool regressions remain green.

### Phase 2: Location

Implement the Location Fact Contract and the `google_maps_url` Property Fact.

**Stop Gate:** every location and surrounding-area phrasing returns only the correct property map URL; no distance, time, or merchant name is invented; property isolation passes.

### Phase 3: Occupancy

Implement the Occupancy Fact Contract, structured extra-guest and extra-bed facts, and owner-maintained admin fields.

**Stop Gate:** `yes`, `no`, `conditional`, `not_provided`, and `requires_human` all pass; multi-question coverage remains complete.

### Phase 4: remaining high-frequency capabilities

Implement remaining V1-capability Property Facts, Onboarding collection, admin maintenance, Resolver behavior, and composition support in high-frequency order.

**Stop Gate:** every added Capability has a complete submission -> approval -> provider -> Resolver -> Composer test and complete `npm test` exits zero.

### Phase 5: acceptance

Expand the Golden Acceptance Matrix and perform the separately authorized real test-only LINE acceptance.

**Stop Gate:** the matrix and the approved real acceptance both confirm property-scoped facts, complete multi-question replies, and safe local handoffs.

## Exclusions from this design round

This specification does not authorize runtime changes, schema or migration changes, Onboarding or admin UI changes, data changes, deployments, Render or LINE Developers changes, credential changes, or any real LINE verification. It also does not retest the user-completed real date and availability acceptance.
