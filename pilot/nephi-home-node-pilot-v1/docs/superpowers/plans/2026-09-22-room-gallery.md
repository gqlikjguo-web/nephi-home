# Room Gallery Implementation Plan

> Execute in the isolated room-gallery worktree using TDD and scoped independent review. Preserve all evidence on regression; user STOP rules override any cleanup advice.

**Goal:** Manage up to ten photos per formal room on existing admin cards and display them on corresponding guest cards.
**Architecture:** A separate R2 adapter and PostgreSQL metadata store, authenticated scoped HTTP routes, small existing-page hooks. Existing public slug resolution and session membership remain authority; existing image sanitizer is reused unchanged.
**Tech Stack:** Node 22.23.2 / npm 10.9.8, PostgreSQL, AWS S3 SDK for R2, vanilla browser JS.
**Spec:** Latest approved room-gallery task, captured in `.github/core-reliability-task.json`.

## Constraints
No AI/LINE/availability behavior change; no explanation-image storage changes; max 10 photos; no public binary through Render. No production data writes before all checks. R2 credentials may block release, not isolated development. Existing valid PASS to FAIL immediately stops and preserves everything.

## Baseline
Production/LIVE df393f7; isolated npm lifecycle exit 0, evidence outside repository in /home/gqlik/junzan-room-gallery-evidence-20260922. Shared original dependencies remain untouched.

## Task 1: Metadata + R2 + routes
- [ ] Write new `tests/room-gallery-runner.js`, HTTP and R2 runners; assert unknown/cross-property room rejection, metadata-only rows, max10 concurrent admission, persistence, exact reorder membership, deletion and object failure safety. Run RED before implementation.
- [ ] Implement `033_room_gallery.sql`, `lib/room-gallery-{store,r2,routes,runtime}.js`; reuse sanitizeImage; public metadata resolves the existing slug authority; direct HTTPS object URLs. Integrate server routing/lifecycle only.
- [ ] Run new tests GREEN. Do not edit existing expected.
Interfaces: store `list(propertyId,roomId,{publicOnly})`, `add(propertyId,roomId,bytes)`, `remove(propertyId,roomId,photoId)`, `reorder(propertyId,roomId,photoIds)`; returns `{id,originalUrl,previewUrl,position}`. Routes GET/POST `/api/room-gallery/:roomId`, DELETE `/:roomId/:photoId`, PUT `/:roomId/order` JSON `{photoIds}`; admin requests include expected propertyId as a mismatch guard, never ownership authority. GET `/api/public/room-gallery?slug=...&roomId=...` returns `{items}`. API envelope existing `{data}`.

## Task 2: Existing admin + guest UI
- [ ] Add isolated admin/guest gallery scripts and scoped CSS, existing HTML script/link hooks, one card hook in each JS. Admin has multi-upload, accessible reorder/delete, previews/count and clear errors. Guest has main photo/thumbs/swipe; absent photos/API failure creates no image frame.
- [ ] New UI runner demonstrates RED then actual browser desktop/390/360 GREEN. Preserve form validity, pricing behavior, property switching and no-photo fallback.

## Task 3: Verification + setup
- [ ] Independent scoped review, affected regression, npm lifecycle, integrity and trusted Core Reliability Gate. Keep R2 fake boundary results distinct from real provider evidence.
- [ ] Document minimal R2 bucket/custom-domain/scoped-key/Render variables setup in `docs/ROOM_GALLERY.md`; do not request keys in conversation. If unavailable, consolidate deployment prerequisites once.
- [ ] Only passing candidate may be committed/pushed/PR/deployed through trusted Gate. No Gate policy changes authorized.
