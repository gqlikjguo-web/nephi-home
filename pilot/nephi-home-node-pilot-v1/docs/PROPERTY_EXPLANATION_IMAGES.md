# Property explanation images v1 — approved implementation plan

Baseline: `3a73b1353b668a53fa087b738cf7f0de336d4e03`.
User approval: 2026-09-21, this task. No existing expected or factual decision changes.

## Contract
One image per property and existing canonical explanation source. Persist image bytes
and source binding only; never duplicate Knowledge/propertyFacts. PostgreSQL remains
sole storage authority. The formal property catalog identifies sources; guest words,
regex matching and AI never select media. Unsupported/unknown sources cannot bind.
A validated answered catalog source may attach its stored image to the same sealed
FinalResponse. Attachments validate property, source, HTTPS URL and store provenance.
No image on NO_REPLY, clarification, unknown or non-catalog facts. Text/action stay
unchanged. Invalid/missing media fails closed to text-only; no fallback image.

Management requires authenticated selected-property membership and same-origin write.
Published URLs use 192-bit random identifiers, never property identifiers. GET returns
only sanitized JPEG bytes; public URLs are shareable. No metadata/listing is public.
Upload JPEG/PNG only, at most 8 MiB and 20 megapixels; decode/re-encode to strip metadata
and reject malformed payloads. Original longest side 1600px, preview 480px; bounded
stored bytes. Replace issues a new URL (avoids stale LINE cache); unchanged image URL
survives restart/deploy. Delete revokes future reads, not already cached LINE images.
Store in existing PostgreSQL, not ephemeral Render disk. No new service.

## Execution (TDD, preserve work on any existing PASS-to-FAIL)
- [ ] Baseline npm lifecycle with existing credentials excluded; save output externally.
- [ ] RED tests: missing media table and HTTP route; property mismatch; real core
  source selection with independent literal final text; one LINE text+image payload.
- [ ] Migration 032: one property-owned row per canonical source, unique opaque token,
  JPEG original/preview bytea with bounds, FK to properties. No other schema changes.
- [ ] Store/routes: validate current source via existing catalog, authenticate operator,
  sanitize images, persist/reload/replace/delete; private metadata vs public bytes.
- [ ] Response planner records exact canonical answered source; claim validator retains
  validated source scope and accepts only store-issued attachments matching that scope.
- [ ] LINE transport obtains attachments after existing FinalResponse validation and sends
  them with existing text in the same reply. Maximum four unique images plus text.
- [ ] Existing formal cards get small upload/preview/replace/delete controls; save image
  independently after formal explanation is saved; no gallery or new navigation.
- [ ] GREEN new tests; existing affected regression + trusted Core Reliability Gate;
  inspect desktop/390/360 browser render and property isolation evidence.
- [ ] Commit/push feature branch, normal PR/CI; merge only when required gates pass.
  Deploy only junzan-ai; verify migration/health/read-only production behavior.

Full release Gate still requires dedicated REAL credentials for core-path changes.
Missing credentials block release; production credentials cannot substitute. No
protected tests, Gate policy, or normal factual decision may change to bypass a gate.
