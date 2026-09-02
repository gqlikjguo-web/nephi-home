"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createProviders } = require("../lib/providers/provider-factory");
const { cleanInput } = require("../lib/onboarding-service");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");

const PROPERTY_ID = "formal_roundtrip";
const SESSION_TOKEN = "formal-roundtrip-session";
const SECOND_ROOM_ID = "room_secondary";

function day(offset) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function fact(canonicalId, status, publicText, appliesTo) {
  return {
    canonicalId,
    category: "amenity",
    status,
    appliesTo,
    publicText,
    fees: [],
    advanceNoticeRequired: null,
    reservationRequired: null,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_onboarding",
    updatedAt: "2026-08-14T00:00:00.000Z"
  };
}

function onboardingInput() {
  return cleanInput({
    propertyName: "Formal Roundtrip Inn",
    aiName: "小比",
    contactName: "Owner",
    phone: "0900000000",
    email: "owner@example.test",
    address: "Original formal address",
    googleMapsUrl: "https://maps.app.goo.gl/FormalRoundtrip",
    checkInTime: "15:00",
    latestArrivalTime: "晚上10點前",
    checkOutTime: "11:00",
    line: { hasOfficialAccount: false, contactLink: "" },
    rooms: [{
      key: "main",
      roomCode: "A",
      displayName: "Main Room",
      type: "double",
      capacity: 2,
      highlights: [],
      mondayThursdayPrice: 1000,
      fridayPrice: 1200,
      saturdayHolidayPrice: 1500,
      sundayPrice: 1100,
      enabled: true
    }, {
      key: "secondary",
      roomCode: "B",
      displayName: "Secondary Room",
      type: "double",
      capacity: 2,
      highlights: [],
      mondayThursdayPrice: 1100,
      fridayPrice: 1300,
      saturdayHolidayPrice: 1600,
      sundayPrice: 1200,
      enabled: true
    }],
    bundles: [{
      key: "package",
      name: "Whole House Package",
      memberRoomKeys: ["main"],
      capacity: 2,
      mondayThursdayPrice: 3000,
      fridayPrice: 3500,
      saturdayHolidayPrice: 4000,
      sundayPrice: 3200,
      enabled: true,
      entertainmentAmenities: [{
        key: "singing",
        displayName: "KTV",
        provided: true,
        statusSource: "operator",
        note: "Onboarding guest detail.",
        source: "preset",
        position: 0
      }]
    }],
    propertyFacts: [fact("wifi", "allowed", "Bundle guests have Wi-Fi.", "bundle_only")],
    knowledge: [{ key: "singing", label: "Legacy KTV FAQ", status: "fixed", answer: "Legacy FAQ detail." }]
  });
}

async function request(url, route, options = {}, authenticated = true) {
  const response = await fetch(url + route, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { cookie: `nephi_admin_session=${SESSION_TOKEN}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

function resolvedAmenity(property, canonicalId) {
  const catalog = buildPropertyCatalog(property);
  const entity = catalog.amenities.find((item) => item.canonicalId === canonicalId);
  const outcome = executeTasks({
    property,
    catalog,
    tasks: [{
      taskId: `${canonicalId}-latest`,
      type: "amenity",
      detailIntent: "general",
      entity: { rawText: canonicalId },
      _resolvedEntity: { status: "resolved", entity }
    }],
    request: { stay: {}, inventory: { mode: "bundle_only" } }
  })[0];
  return { catalog, entity, outcome };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "formal-data-roundtrip-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  let app;
  try {
    await migratePostgres(connection);
    providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    const submitted = onboardingInput();
    assert.equal(submitted.latestArrivalTime, "晚上10點前");
    providers.onboarding.createOnboarding("formal-roundtrip-application", "draft-hash");
    providers.onboarding.saveOnboarding("formal-roundtrip-application", submitted);
    providers.onboarding.submitOnboarding("formal-roundtrip-application");
    providers.onboarding.approveOnboarding(
      "formal-roundtrip-application",
      PROPERTY_ID,
      "owner",
      "invite-hash",
      new Date(Date.now() + 86400000).toISOString(),
      "platform",
      "reviewer"
    );

    const approved = providers.customerSettings.getProperty(PROPERTY_ID);
    assert.equal(approved.businessProfile.address, "Original formal address");
    assert.equal(approved.businessProfile.aiName, "小比");
    assert.equal(approved.businessProfile.googleMapsUrl, "https://maps.app.goo.gl/FormalRoundtrip");
    assert.equal(approved.commonAnswers.checkInTime, "15:00");
    assert.equal(approved.commonAnswers.latestArrivalTime, "晚上10點前");
    assert.equal(approved.commonAnswers.checkOutTime, "11:00");
    const onboardingBundle = approved.rooms.find((item) => item.inventoryType === "bundle");
    assert.equal(onboardingBundle.entertainmentAmenities.find((item) => item.key === "singing").note, "Onboarding guest detail.");
    const inventoryGapDate = day(30);
    const gapClient = await openPostgres(connection);
    await gapClient.query(
      "DELETE FROM inventory_availability_days WHERE property_id=$1 AND inventory_id=$2 AND stay_date=$3",
      [PROPERTY_ID, onboardingBundle.id, inventoryGapDate]
    );
    await gapClient.close();

    providers.persistence.getAdminSession = async (hash) => hash === sessionTokenHash(SESSION_TOKEN)
      ? { propertyId: PROPERTY_ID, username: "owner" }
      : null;
    app = createApp({ providers, adminAuthRequired: true, lineBindingEnv: {} });
    const running = await app.start(0, "127.0.0.1");

    const profile = await request(running.url, `/api/property-profile?propertyId=${PROPERTY_ID}`);
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.data.address, "Original formal address");
    assert.equal(profile.body.data.aiName, "小比");
    assert.equal(profile.body.data.latestArrivalTime, "晚上10點前");

    const savedProfile = await request(running.url, "/api/property-profile", {
      method: "PUT",
      body: JSON.stringify({
        propertyId: PROPERTY_ID,
        propertyName: "Updated Formal Inn",
        aiName: "新小比",
        address: "Newest formal address",
        googleMapsUrl: "https://maps.app.goo.gl/NewestFormal",
        lineUrl: "",
        contactInfo: "Newest contact",
        checkInTime: "16:00",
        earlyCheckInPolicy: "提前入住須先詢問並依當日房況確認",
        latestArrivalTime: "無固定時間，請入住前與我們確認",
        checkOutTime: "10:00"
      })
    });
    assert.equal(savedProfile.response.status, 200);
    assert.equal(savedProfile.body.data.address, "Newest formal address");
    assert.equal(savedProfile.body.data.aiName, "新小比");
    assert.equal(savedProfile.body.data.earlyCheckInPolicy, "提前入住須先詢問並依當日房況確認");
    assert.equal(providers.customerSettings.getProperty(PROPERTY_ID).businessProfile.aiName, "新小比");
    assert.equal(providers.customerSettings.getProperty(PROPERTY_ID).commonAnswers.earlyCheckInPolicy, "提前入住須先詢問並依當日房況確認");

    const bundles = await request(running.url, `/api/bundles?customerId=${PROPERTY_ID}`);
    assert.equal(bundles.response.status, 200);
    const bundle = bundles.body.data.bundles[0];
    const createdBundle = await request(running.url, "/api/bundles", {
      method: "POST",
      body: JSON.stringify({
        customerId: PROPERTY_ID,
        name: "Second managed bundle",
        capacity: 2,
        memberRoomIds: [SECOND_ROOM_ID],
        enabled: true,
        entertainmentAmenities: [{ key: "board_games", displayName: "桌遊", provided: true, statusSource: "operator", note: "New bundle detail.", source: "preset", position: 0 }],
        mondayThursdayPrice: 5100,
        fridayPrice: 6100,
        saturdayHolidayPrice: 7100,
        sundayPrice: 5600
      })
    });
    assert.equal(createdBundle.response.status, 201, "operators must be able to create a property-scoped bundle");
    assert.match(createdBundle.body.data.bundle.id, /^bundle_/, "bundleId must be generated by the provider");
    const updatedAmenities = bundle.entertainmentAmenities.map((item) => item.key === "singing"
      ? { ...item, provided: true, statusSource: "operator", note: "Updated guest detail." }
      : item);
    const savedBundle = await request(running.url, `/api/bundles/${bundle.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...bundle,
        customerId: PROPERTY_ID,
        name: "Managed renamed bundle",
        capacity: bundle.capacity + 1,
        memberRoomIds: [SECOND_ROOM_ID],
        enabled: false,
        entertainmentAmenities: updatedAmenities,
        mondayThursdayPrice: 6100,
        fridayPrice: 7100,
        saturdayHolidayPrice: 8100,
        sundayPrice: 6600
      })
    });
    assert.equal(savedBundle.response.status, 200);
    assert.equal(savedBundle.body.data.bundle.id, bundle.id, "operator updates must preserve the server-generated bundle identity");
    assert.equal(savedBundle.body.data.bundle.name, "Managed renamed bundle");
    assert.equal(savedBundle.body.data.bundle.capacity, bundle.capacity + 1);
    assert.deepEqual(savedBundle.body.data.bundle.memberRoomIds, [SECOND_ROOM_ID]);
    assert.equal(savedBundle.body.data.bundle.enabled, false);
    assert.deepEqual(savedBundle.body.data.bundle.entertainmentAmenities, updatedAmenities);
    assert.deepEqual(
      ["mondayThursdayPrice", "fridayPrice", "saturdayHolidayPrice", "sundayPrice"].map((key) => savedBundle.body.data.bundle[key]),
      [6100, 7100, 8100, 6600],
      "operator price writes must update exactly the four approved prices"
    );
    const noBackfillClient = await openPostgres(connection);
    const preservedGap = await noBackfillClient.query(
      "SELECT count(*)::int rows FROM inventory_availability_days WHERE property_id=$1 AND inventory_id=$2 AND stay_date=$3",
      [PROPERTY_ID, bundle.id, inventoryGapDate]
    );
    await noBackfillClient.close();
    assert.equal(preservedGap.rows[0].rows, 0, "bundle price updates must not backfill inventory availability");

    const crossPropertyUpdate = await request(running.url, `/api/bundles/${bundle.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...savedBundle.body.data.bundle, customerId: "another_property" })
    });
    assert.equal(crossPropertyUpdate.response.status, 403, "bundle updates must remain scoped to the authenticated property");

    const deletedBundle = await request(running.url, `/api/bundles/${createdBundle.body.data.bundle.id}`, {
      method: "DELETE",
      body: JSON.stringify({ customerId: PROPERTY_ID })
    });
    assert.equal(deletedBundle.response.status, 200, "operators must be able to delete an unused property-scoped bundle");
    assert.equal(deletedBundle.body.data.deleted, true);

    const reenabledBundle = await request(running.url, `/api/bundles/${bundle.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...savedBundle.body.data.bundle, customerId: PROPERTY_ID, enabled: true })
    });
    assert.equal(reenabledBundle.response.status, 200);
    assert.equal(reenabledBundle.body.data.bundle.enabled, true);

    const checkIn = day(1);
    const checkOut = day(2);
    const opened = await request(running.url, "/api/availability/day", {
      method: "POST",
      body: JSON.stringify({ propertyId: PROPERTY_ID, date: checkIn, roomId: bundle.id, status: "available" })
    });
    assert.equal(opened.response.status, 200);
    const publicAvailability = await request(
      running.url,
      `/api/public/availability?slug=formal-roundtrip&checkIn=${checkIn}&checkOut=${checkOut}&queryMode=bundle_only&roomType=${bundle.id}`,
      {},
      false
    );
    assert.equal(publicAvailability.response.status, 200);
    assert.equal(publicAvailability.body.data.bundles[0].entertainmentAmenities.find((item) => item.key === "singing").note, "Updated guest detail.");

    const latestProperty = providers.customerSettings.getProperty(PROPERTY_ID);
    const singing = resolvedAmenity(latestProperty, "singing");
    assert.equal(singing.entity.answer.includes("Updated guest detail."), true);
    assert.equal(singing.entity.answer.includes("Legacy FAQ detail."), false);
    assert.equal(singing.outcome.facts.answer.includes("Updated guest detail."), true);
    const location = singing.catalog.policies.find((item) => item.canonicalId === "location");
    assert.equal(location.address, "Newest formal address");
    assert.equal(location.mapUrl, "https://maps.app.goo.gl/NewestFormal");
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_in").answer, "16:00");
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_in__early_arrival_policy").answer, "提前入住須先詢問並依當日房況確認");
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_in__latest_arrival_policy").answer, "無固定時間，請入住前與我們確認");
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_out").answer, "10:00");

    const publicProperty = await request(running.url, "/api/public/property?slug=formal-roundtrip", {}, false);
    assert.equal(publicProperty.response.status, 200);
    assert.equal(publicProperty.body.data.propertyName, "Updated Formal Inn");

    console.log("formal data authority roundtrip: PASS");
  } finally {
    if (app) await app.stop();
    else if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
