"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createProviders } = require("../lib/providers/provider-factory");
const { cleanInput } = require("../lib/onboarding-service");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");

const PROPERTY_ID = "formal_roundtrip";
const SESSION_TOKEN = "formal-roundtrip-session";

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
    contactName: "Owner",
    phone: "0900000000",
    email: "owner@example.test",
    address: "Original formal address",
    googleMapsUrl: "https://maps.app.goo.gl/FormalRoundtrip",
    checkInTime: "15:00",
    latestArrivalTime: "21:30",
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
    assert.equal(submitted.latestArrivalTime, "21:30");
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
    assert.equal(approved.businessProfile.googleMapsUrl, "https://maps.app.goo.gl/FormalRoundtrip");
    assert.equal(approved.commonAnswers.checkInTime, "15:00");
    assert.equal(approved.commonAnswers.latestArrivalTime, "21:30");
    assert.equal(approved.commonAnswers.checkOutTime, "11:00");
    assert.equal(approved.rooms.find((item) => item.inventoryType === "bundle").entertainmentAmenities.find((item) => item.key === "singing").note, "Onboarding guest detail.");

    providers.persistence.getAdminSession = async (hash) => hash === sessionTokenHash(SESSION_TOKEN)
      ? { propertyId: PROPERTY_ID, username: "owner" }
      : null;
    app = createApp({ providers, adminAuthRequired: true, lineBindingEnv: {} });
    const running = await app.start(0, "127.0.0.1");

    const profile = await request(running.url, `/api/property-profile?propertyId=${PROPERTY_ID}`);
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.data.address, "Original formal address");
    assert.equal(profile.body.data.latestArrivalTime, "21:30");

    const savedProfile = await request(running.url, "/api/property-profile", {
      method: "PUT",
      body: JSON.stringify({
        propertyId: PROPERTY_ID,
        propertyName: "Updated Formal Inn",
        address: "Newest formal address",
        googleMapsUrl: "https://maps.app.goo.gl/NewestFormal",
        lineUrl: "",
        contactInfo: "Newest contact",
        checkInTime: "16:00",
        latestArrivalTime: "22:00",
        checkOutTime: "10:00"
      })
    });
    assert.equal(savedProfile.response.status, 200);
    assert.equal(savedProfile.body.data.address, "Newest formal address");

    const bundles = await request(running.url, `/api/bundles?customerId=${PROPERTY_ID}`);
    assert.equal(bundles.response.status, 200);
    const bundle = bundles.body.data.bundles[0];
    const updatedAmenities = bundle.entertainmentAmenities.map((item) => item.key === "singing"
      ? { ...item, provided: true, statusSource: "operator", note: "Updated guest detail." }
      : item);
    const savedBundle = await request(running.url, `/api/bundles/${bundle.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...bundle, customerId: PROPERTY_ID, entertainmentAmenities: updatedAmenities })
    });
    assert.equal(savedBundle.response.status, 200);
    assert.equal(savedBundle.body.data.bundle.entertainmentAmenities.find((item) => item.key === "singing").note, "Updated guest detail.");

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
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_in__latest_arrival_policy").answer, "22:00");
    assert.equal(singing.catalog.policies.find((item) => item.canonicalId === "check_out").answer, "10:00");

    const newestAmenities = savedBundle.body.data.bundle.entertainmentAmenities.map((item) => item.key === "singing"
      ? { ...item, note: "Newest guest detail." }
      : item);
    await request(running.url, `/api/bundles/${bundle.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...savedBundle.body.data.bundle, customerId: PROPERTY_ID, entertainmentAmenities: newestAmenities })
    });
    const nextQuery = resolvedAmenity(providers.customerSettings.getProperty(PROPERTY_ID), "singing");
    assert.equal(nextQuery.outcome.facts.answer.includes("Newest guest detail."), true);
    assert.equal(nextQuery.outcome.facts.answer.includes("Updated guest detail."), false);

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
