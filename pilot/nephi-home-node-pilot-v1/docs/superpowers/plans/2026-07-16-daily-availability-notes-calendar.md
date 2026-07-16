# JunZan AI Daily Availability, Notes, and Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver shared PostgreSQL-backed daily and calendar availability views with property-scoped internal room notes, reliable save states, responsive operation, and no Guest or AI exposure.

**Architecture:** Extend the existing availability provider with room-note methods backed by one `daily_room_notes` table. The protected admin month and mutation routes accept `propertyId`, revalidate it against the selected admin session, and feed one normalized browser state used by both views. Status and note mutations use per-room/date sequencing so view switches never refetch or overwrite newer state.

**Tech Stack:** Node.js CommonJS, PostgreSQL/PGlite, existing provider/RPC pattern, plain HTML/CSS/JavaScript, Node assertion runners, in-app browser QA.

## Global Constraints

- Work only in `C:\Users\gqlik\Documents\Codex\2026-07-14\node-pilot-c-users-gqlik-documents\repo` on `test-only/node-pilot-integration`.
- Use `propertyId` in new API and front-end payloads; revalidate it against the authenticated session property.
- Keep formal statuses exactly `available` and `closed`.
- Store notes only at `(property_id, room_id, stay_date)` using existing `room_types(property_id, room_id)` identity.
- Daily and calendar views must share one month API, one front-end state, and one mutation path per data type.
- Never expose notes to Guest, AI, Safe Facts, knowledge items, or LINE.
- Never write formal `nephi_home` availability, pricing, or notes during tests or QA.
- Never modify admin Email, passwords, identities, sessions, platform grants, LINE, contactLink, tokens, or secrets.

---

### Task 1: PostgreSQL and Provider Note Storage

**Files:**
- Create: `pilot/nephi-home-node-pilot-v1/migrations/010_daily_room_notes.sql`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/contracts.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/postgres-providers.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/postgres-worker.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/json-providers.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/json-repository.js`
- Create: `tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js`

**Interfaces:**
- Produces: `availability.getDayNotes(propertyId, from, to) -> [{roomTypeId,date,note,createdAt,updatedAt}]`.
- Produces: `availability.setDayNote(propertyId, roomTypeId, date, note) -> note object | null`; blank `note` deletes and returns `null`.
- Consumes: existing `room_types(property_id, room_id)` composite identity and provider RPC.

- [ ] **Step 1: Write the failing provider test**

Create a PGlite database, migrate and seed it, then assert:

```js
const provider = createPostgresProviders(connection).availability;
assert.equal(provider.getDayNotes("nephi_home", "2026-07-01", "2026-08-01").length, 0);
assert.equal(provider.setDayNote("nephi_home", "room301", "2026-07-16", " 等待訂金 ").note, "等待訂金");
assert.equal(provider.setDayNote("nephi_home", "room301", "2026-07-16", "更新備註").note, "更新備註");
assert.equal(provider.setDayNote("nephi_home", "room301", "2026-07-16", "   "), null);
assert.equal(provider.getDayNotes("nephi_home", "2026-07-01", "2026-08-01").length, 0);
```

Also seed `other_home` and assert its notes cannot appear in `nephi_home` reads; assert an unknown or cross-property room foreign key fails.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --provider-only`

Expected: FAIL because `getDayNotes` and migration 010 do not exist.

- [ ] **Step 3: Add the minimal migration and provider methods**

Use this schema:

```sql
CREATE TABLE IF NOT EXISTS daily_room_notes (
  property_id text NOT NULL,
  room_id text NOT NULL,
  stay_date date NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, room_id, stay_date),
  FOREIGN KEY (property_id, room_id)
    REFERENCES room_types(property_id, room_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS daily_room_notes_property_date_idx
  ON daily_room_notes(property_id, stay_date);
```

Add `getDayNotes` and `setDayNote` to the availability contract, PostgreSQL RPC adapter, worker operations, JSON adapter, and the JSON repository's dedicated `dailyRoomNotes` state. PostgreSQL writes must trim note text, use composite-key upsert with `updated_at=now()`, and delete on blank.

- [ ] **Step 4: Run the provider test and verify GREEN**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --provider-only`

Expected: provider note checks PASS, including migration rerun and property/room isolation.

- [ ] **Step 5: Commit provider storage**

```powershell
git add pilot/nephi-home-node-pilot-v1/migrations/010_daily_room_notes.sql pilot/nephi-home-node-pilot-v1/lib/providers pilot/nephi-home-node-pilot-v1/lib/json-repository.js tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js
git commit -m "新增每日房型內部備註儲存"
```

### Task 2: Protected Admin Month and Mutation API

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/lib/mvp-service.js`
- Modify: `pilot/nephi-home-node-pilot-v1/lib/providers/service-data-access.js`
- Modify: `pilot/nephi-home-node-pilot-v1/server.js`
- Modify: `tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js`

**Interfaces:**
- Consumes: `availability.getDayNotes` and `availability.setDayNote` from Task 1.
- Produces: protected `GET /api/availability/month?propertyId=...&year=...&month=...` with `notesByDate` keyed by date and room type.
- Produces: protected `POST /api/availability/day` accepting `{propertyId,date,roomTypeId,status}` while preserving legacy aliases.
- Produces: protected `PUT /api/availability/day-note` accepting `{propertyId,roomTypeId,date,note}`.

- [ ] **Step 1: Extend the integration test with failing API cases**

Log in with test-only accounts for `test_home_a` and `test_home_b`, then assert:

```js
await putNote(cookieA, {propertyId:"test_home_a",roomTypeId:"room_a",date:"2026-07-16",note:"等待訂金"}, 200);
await putNote(cookieA, {propertyId:"test_home_b",roomTypeId:"room_b",date:"2026-07-16",note:"越權"}, 403);
await putNote(cookieA, {propertyId:"test_home_a",roomTypeId:"room_b",date:"2026-07-16",note:"越權"}, 400);
assert.equal((await adminMonth(cookieA)).notesByDate["2026-07-16"].room_a.note, "等待訂金");
assert.equal(JSON.stringify(await publicAvailability("test_home_a")).includes("等待訂金"), false);
```

Cover create, update, blank clear, invalid date, non-string note, 1001-character note, unauthenticated access, property mismatch, room mismatch, different dates/rooms, and preservation of existing status after note changes.

- [ ] **Step 2: Run the API test and verify RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --api-only`

Expected: FAIL with missing day-note route or missing month notes.

- [ ] **Step 3: Implement service validation and protected routes**

Add service methods with exact behavior:

```js
function setDayNote(input) {
  const homestay = requireCustomerId(input.propertyId);
  const date = parseDateKey(input.date, "date");
  const roomTypeId = String(input.roomTypeId || "");
  if (!(homestay.rooms || []).some(room => room.id === roomTypeId && room.inventoryType !== "bundle"))
    throw new AppError(400, "UNKNOWN_ROOM", "找不到可管理的房型");
  if (typeof input.note !== "string") throw new AppError(400, "INVALID_NOTE", "備註格式錯誤");
  const note = input.note.trim();
  if (note.length > 1000) throw new AppError(400, "NOTE_TOO_LONG", "內部備註不可超過 1000 字");
  return repository.setAvailabilityDayNote(homestay.customerId, roomTypeId, date, note);
}
```

Expose `getAvailabilityDayNotes` and `setAvailabilityDayNote` from `service-data-access.js` as thin adapters over the Task 1 availability provider. Normalize `propertyId` and `roomTypeId` at the route boundary to the existing internal `customerId` and `roomId` service conventions. Extend `isAdminDataRoute` to include `/api/availability/day-note`. Session scope checks read `propertyId` first and support `customerId` only for backward compatibility. Do not alter `/api/availability/search`, `/api/public/availability`, Guest, or AI routes.

- [ ] **Step 4: Run API and existing availability auth tests**

Run:

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --api-only
node ../../tests/pilot-nephi-home-node-pilot-v1-admin-auth-availability-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-admin-email-guest-mobile-runner.js
```

Expected: all checks PASS; Guest responses contain no note fields or note text.

- [ ] **Step 5: Commit API work**

```powershell
git add pilot/nephi-home-node-pilot-v1/lib/mvp-service.js pilot/nephi-home-node-pilot-v1/lib/providers/service-data-access.js pilot/nephi-home-node-pilot-v1/server.js tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js
git commit -m "新增受保護每日房況備註 API"
```

### Task 3: Shared Daily and Calendar Front End

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/public/admin.html`
- Modify: `pilot/nephi-home-node-pilot-v1/public/assets/admin.js`
- Modify: `pilot/nephi-home-node-pilot-v1/public/assets/styles.css`
- Modify: `tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js`

**Interfaces:**
- Consumes: protected month, day status, and day-note routes from Task 2 using `propertyId` and `roomTypeId`.
- Produces: one `availabilityState` object shared by `renderDailyView()` and `renderCalendarView()`.
- Produces: `queueMutation(key, operation)` and month request generation guard.

- [ ] **Step 1: Add failing front-end contract checks**

Assert HTML/JS/CSS include:

```js
assert.match(adminHtml, /data-view="daily"/);
assert.match(adminHtml, /data-view="calendar"/);
assert.match(adminJs, /renderDailyView/);
assert.match(adminJs, /renderCalendarView/);
assert.match(adminJs, /queueMutation/);
assert.match(adminJs, /requestGeneration/);
assert.match(adminCss, /@media\(max-width:640px\)/);
assert.doesNotMatch(adminJs, /\/api\/public\/availability/);
```

- [ ] **Step 2: Run the front-end contract and verify RED**

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --frontend-only`

Expected: FAIL because shared view controls and renderers do not exist.

- [ ] **Step 3: Build one shared state and mutation controller**

Replace the current table-only `loadMonth` render path with:

```js
const availabilityState = { rooms: [], days: new Map(), selectedDate: "", view: "daily" };
let requestGeneration = 0;
const mutationQueues = new Map();

function queueMutation(key, operation) {
  const previous = mutationQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  mutationQueues.set(key, next.finally(() => {
    if (mutationQueues.get(key) === next) mutationQueues.delete(key);
  }));
  return next;
}
```

`loadMonth()` fetches once, ignores stale generations, normalizes rows and `notesByDate`, then calls `renderAvailability()`. `switchView()` only changes the view and rerenders; it never fetches. Status and note success update the shared state; failures retain current draft and render a retry action.

- [ ] **Step 4: Implement daily and calendar markup behavior**

Daily mode renders today/next dates as responsive cards or rows with all room types, two-state controls, note indicator, and per-key save status. Calendar mode renders a seven-column month grid with available/closed counts and a note dot. Selecting a day renders the same room editor controls below or beside the grid. Desktop remembers `daily|calendar` in localStorage; mobile begins in `daily`.

Use `aria-pressed`, explicit room/date labels, 44px mobile targets, no hover dependency, and a note editor with Save, Clear, Close, status text, and retained draft on error. Keep pricing and bundle management sections intact below the availability card.

- [ ] **Step 5: Implement responsive styles and verify static checks GREEN**

Limit horizontal scrolling to the desktop daily matrix container. On 390px and 375px, use date cards and a seven-column calendar whose cells use compact counts/dots; the page itself must satisfy `scrollWidth <= clientWidth`.

Run: `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js --frontend-only`

Expected: all front-end contract checks PASS.

- [ ] **Step 6: Commit front-end work**

```powershell
git add pilot/nephi-home-node-pilot-v1/public/admin.html pilot/nephi-home-node-pilot-v1/public/assets/admin.js pilot/nephi-home-node-pilot-v1/public/assets/styles.css tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js
git commit -m "完成每日房況與月曆共用介面"
```

### Task 4: Full Verification, Browser QA, Fixes, Push, and Deploy

**Files:**
- Modify: `pilot/nephi-home-node-pilot-v1/package.json`
- Modify only when a reproduced QA failure requires a fix: `pilot/nephi-home-node-pilot-v1/public/admin.html`
- Modify only when a reproduced QA failure requires a fix: `pilot/nephi-home-node-pilot-v1/public/assets/admin.js`
- Modify only when a reproduced QA failure requires a fix: `pilot/nephi-home-node-pilot-v1/public/assets/styles.css`
- Modify only when a reproduced QA failure requires a fix: `pilot/nephi-home-node-pilot-v1/lib/mvp-service.js`
- Modify only when a reproduced QA failure requires a fix: `pilot/nephi-home-node-pilot-v1/server.js`
- Modify only when a reproduced QA failure requires a fix: `tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js`

**Interfaces:**
- Consumes: completed feature and tests from Tasks 1–3.
- Produces: verified branch commit, pushed branch, safe Render deployment, and 200/ready health check.

- [ ] **Step 1: Add the new runner to the complete regression command**

Insert `node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js` into `package.json` before deployment checks so `npm test` exercises notes, property isolation, shared views, and Guest/AI exclusion.

- [ ] **Step 2: Run targeted and full automated verification**

Run:

```powershell
node ../../tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-admin-auth-availability-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-admin-email-guest-mobile-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-guest-frontend-runner.js
node ../../tests/pilot-nephi-home-node-pilot-v1-onboarding-runner.js
npm test
```

Expected: every runner exits 0 with all checks PASS.

- [ ] **Step 3: Start a test-only PGlite app and perform browser QA**

Use only `test_home_a`/`test_home_b` and test credentials. In the in-app browser:

- Desktop: log in, inspect today/near/cross-month dates, switch daily/calendar, change two room/date statuses, add/edit/clear notes, rapidly toggle, refresh, and simulate a failed request.
- 390px and 375px: repeat both views, open the note editor, verify 44px targets, no keyboard-obscuring fixed bar, and `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- Guest: open the public page and API for the test property and verify no note text or note field.
- Property isolation: use the second test account and verify it cannot read or mutate the first property's notes.

Expected: all original and supplemental acceptance flows pass without writing `nephi_home`.

- [ ] **Step 4: Fix every blocking QA issue and rerun affected checks**

For each observed problem, first add or tighten an automated assertion, reproduce RED, apply the smallest scoped fix, then rerun the targeted runner and the relevant desktop/390/375 flow. Stop visual iteration once the defined daily and calendar operations are clear and reliable.

- [ ] **Step 5: Run sensitive-data and scope scans**

Run focused repository scans for credential-like assignments and verify diffs contain no password, hash, token, secret, real admin Email, LINE change, contactLink change, or formal `nephi_home` data mutation. Also run `git diff --check` and inspect `git status --short`.

Expected: no new sensitive values, no forbidden files, and only task files changed.

- [ ] **Step 6: Commit final verification fixes**

```powershell
git add pilot/nephi-home-node-pilot-v1 tests/pilot-nephi-home-node-pilot-v1-daily-room-notes-runner.js
git commit -m "驗證每日房況與月曆操作"
```

- [ ] **Step 7: Push the required branch**

Run: `git push origin test-only/node-pilot-integration`

Expected: remote branch advances to the verified final commit.

- [ ] **Step 8: Deploy safely and verify health**

Use the repository's existing Render deployment workflow only after push. Do not run admin binding, seed, initialization, or any command that writes formal property data. Verify `https://app.junzanai.com/api/health` returns HTTP 200 and `status=ready`, then perform read-only page checks.

Expected: deployment succeeds, health is ready, and formal `nephi_home` business data remains untouched.
