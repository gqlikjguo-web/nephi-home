# JunZan AI First-Version Delivery Design

## Scope

Deliver a test-only Render release for the shared JunZan AI Conversation Engine V2. The release keeps formal LINE, formal webhook, and formal secrets unchanged. `nephi_home` is only an acceptance fixture; every production path remains property-scoped.

## Design

`Planner V2 -> validation -> state reducer -> canonical-request adapter -> existing property-scoped resolver contract -> task executor -> response plan -> controlled composer -> claim validator`

The adapter converts validated V2 canonical requests to the existing resolver contract and maps resolver results back to task results. It must not implement availability, price, policy, FAQ, or reliability logic. Planner candidates remain untrusted until deterministic temporal and entity validation succeeds.

All availability forms (named room, room category, bundle, capacity, one night, and multiple nights) use the same existing availability resolver. Knowledge facts come from the current property's `property_settings` and `knowledge_items`; absent facts become deterministic unknown or scoped handoff, not an intent-specific fallback.

## Safety

Only Response Plan `allowedFacts` may reach the Composer. Unknown, unreliable, and handoff results always use deterministic copy. Claim or coverage failure replaces the whole Composer result with deterministic output. Every catalog, adapter, resolver call, persistence key, and acceptance fixture carries `propertyId`.

## Verification

A data-driven acceptance matrix supplies two properties with different names, room IDs, availability, knowledge, and policies. It tests normal and colloquial inputs, synonyms, multi-task input, missing data, unknown, three identical queries, availability changes, and isolation. Nephi's required user-facing cases are matrix data, not production branching.

## Rollback

The existing `TEST_ONLY_CONVERSATION_ENGINE_V2` flag remains the rollback boundary. A release commit tagged in the delivery report is the formal-switch rollback point; no formal environment configuration changes are part of this work.
