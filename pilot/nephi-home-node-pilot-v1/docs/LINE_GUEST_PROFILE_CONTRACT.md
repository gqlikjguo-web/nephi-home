# LINE guest display metadata

The sole identity is the existing `(property_id, channel_id, line_user_id)` conversation tuple. A display name is optional presentation data, never a routing, authorization, Understanding, or facts input.

## Source and access

Only the existing enabled binding and verified raw webhook signature authorize property scope. After the guest message is safely claimed, a direct-user message may record its signed `destination`, event ID and a SHA-256 fingerprint of that exact binding's encrypted secret/token envelopes, property and webhook key. Destination never selects a property. No profile request occurs during webhook handling. Missing metadata or storage failure does not alter message processing.

An authenticated operator POST to `/api/ai-controls/profile` requires selected-property membership and an existing exact conversation tuple. Claimed property values can only reject a mismatch. Only the selected conversation triggers lookup; loading the list never fetches historical profiles in bulk.

The authenticated conversation list may attach already-cached names to exact tuples in its existing property-scoped result. This read checks the current enabled binding, credential version and TTL; it performs no LINE request or write. Cache read failure preserves the original conversation list. Thus a valid name remains visible after refresh without historical profile recovery.

The current enabled binding, channel hash and fingerprint must match the signed evidence. The same property-bound credential is decrypted. `GET /v2/bot/info` must identify the signed destination before `GET /v2/bot/profile/{userId}` is allowed. The returned userId must exactly match the target. Both requests have a 3-second timeout and forbid redirects. Unprovable legacy conversations retain their short identifier until a future valid direct-user webhook supplies evidence; no bulk backfill or inferred association is allowed.

## Storage and lifetime

Migration 027 adds only `line_guest_profiles`, with the existing tuple as primary key. Columns contain display_name, fetched_at, last_attempt_at, next_refresh_at, last_result; provenance is credential_version, source_destination, source_event_id and source_observed_at. attempt_id/lease_until are the minimum persistent concurrency lease, not a second identity.

Successful names refresh after 24 hours; failed lookups back off for 15 minutes and display the existing fallback. A 30-second PostgreSQL lease prevents concurrent same-tuple calls across instances. Binding and profile row locks, version/source checks and attempt IDs reject old requests after rotation or lease replacement. New signed evidence for a new credential version clears the old name. Cache reads also verify current binding version. No quota, handoff, message, conversation state or existing binding data is changed by this cache.

Profile RPC waits are asynchronous, capped at 1.5 seconds; transactions use a 200ms lock timeout and 1-second statement timeout. Webhook observation is best-effort after enqueue, without waiting for completion. These bounds apply only to the new profile path.

Only a nonempty displayName of at most 256 Unicode code points is saved. No avatar, statusMessage, language, complete profile response, plaintext token, or raw error response is persisted or logged. 404 means unavailable, never proof of blocking. Failure yields null; the existing list/history and controls operate independently. Browser rendering uses textContent and guards both property and selected-guest revisions.

## Official interfaces

- https://developers.line.biz/en/reference/messaging-api/#get-profile
- https://developers.line.biz/en/reference/messaging-api/#get-bot-info
- https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects

These are additional LINE read requests only. No LINE message is sent for profile lookup and displayName never enters Luna.
