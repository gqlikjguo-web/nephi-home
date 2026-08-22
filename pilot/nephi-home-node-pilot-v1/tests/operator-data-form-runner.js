"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "operator-data-form-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  let app;
  try {
    fs.writeFileSync(seedFile, JSON.stringify({
      testOnly: true,
      seedDays: 2,
      homestays: [{
        customerId: "property_alpha",
        name: "Property Alpha",
        safeFacts: {},
        rooms: [{ id: "room-a", name: "Room A", type: "double", capacity: 2 }]
      }],
      messageLogs: { property_alpha: [] }
    }));
    app = createApp({
      providers: createJsonProviders({ dataFile, seedFile }),
      adminAuthRequired: false,
      lineBindingEnv: {}
    });
    const running = await app.start(0, "127.0.0.1");
    const adminResponse = await fetch(`${running.url}/admin`);
    assert.equal(adminResponse.status, 200);
    const html = await adminResponse.text();
    for (const id of ["propertyFactsForm", "propertyFactsList", "propertyFactAdd", "propertyFactsStatus"]) {
      assert.equal(html.includes(`id="${id}"`), true, `admin form must expose ${id}`);
    }
    assert.equal(html.includes('id="equipmentFactsList"'), true, "admin form must expose controlled high-frequency equipment");
    assert.equal(html.includes('<div id="controlledPolicyFactsList" class="equipment-grid"></div>'), true, "breakfast and pet cards must use the existing equipment grid");
    assert.equal(html.includes('id="controlledPolicyFactsTemplate"'), false, "breakfast and pet cards must not use a separate full-width template");
    assert.equal(html.includes('class="controlled-policy-facts-section"'), false, "breakfast and pet cards must not use a separate full-width section");
    assert.ok(html.indexOf("/assets/high-frequency-equipment.js") < html.indexOf("/assets/property-facts-form.js"));
    assert.equal(html.includes("/assets/property-facts-form.js"), true);
    const onboardingResponse = await fetch(`${running.url}/onboarding`);
    assert.equal(onboardingResponse.status, 200);
    const onboardingHtml = await onboardingResponse.text();
    assert.equal(onboardingHtml.includes('id="equipmentFacts"'), true, "onboarding must expose the same controlled equipment form");
    assert.ok(onboardingHtml.indexOf("/assets/high-frequency-equipment.js") < onboardingHtml.indexOf("/assets/onboarding.js"));

    const assetResponse = await fetch(`${running.url}/assets/property-facts-form.js`);
    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get("content-type") || "", /javascript/);

    const { buildPropertyFactsPayload, buildHighFrequencyEquipmentDrafts, buildControlledPolicyFactDrafts, controlledPolicyCardContract, controlledPolicyDisplayName } = require("../public/assets/property-facts-form");
    assert.equal(controlledPolicyDisplayName("breakfast"), "早餐說明");
    assert.equal(controlledPolicyDisplayName("pets"), "寵物規則");
    assert.equal(controlledPolicyDisplayName("travel_subsidy"), "國旅補助說明");
    assert.deepEqual(controlledPolicyCardContract("breakfast"), {
      displayName: "早餐說明",
      visibleFields: ["status", "appliesTo", "publicText", "notes"],
      hiddenFields: ["canonicalId", "publicName", "category", "fees", "advanceNoticeRequired", "reservationRequired", "conditions", "restrictions", "operatingHours", "availablePeriods", "source", "updatedAt"]
    });
    assert.deepEqual(controlledPolicyCardContract("pets"), {
      displayName: "寵物規則",
      visibleFields: ["status", "appliesTo", "publicText", "notes"],
      hiddenFields: ["canonicalId", "publicName", "category", "fees", "advanceNoticeRequired", "reservationRequired", "conditions", "restrictions", "operatingHours", "availablePeriods", "source", "updatedAt"]
    });
    assert.deepEqual(controlledPolicyCardContract("travel_subsidy"), {
      displayName: "國旅補助說明",
      visibleFields: ["status", "appliesTo", "publicText", "notes"],
      hiddenFields: ["canonicalId", "publicName", "category", "fees", "advanceNoticeRequired", "reservationRequired", "conditions", "restrictions", "operatingHours", "availablePeriods", "source", "updatedAt"]
    });
    const controlledDrafts = buildControlledPolicyFactDrafts([{
      canonicalId: "breakfast",
      publicName: "早餐",
      category: "policy",
      status: "conditional",
      appliesTo: "whole_property",
      publicText: "早餐需於入住三日前預約。",
      fees: [{ label: "早餐費", amount: 200, currency: "TWD", unit: "person" }],
      advanceNoticeRequired: true,
      reservationRequired: true,
      conditions: ["入住三日前預約"],
      restrictions: [],
      operatingHours: [{ label: "每日", start: "07:00", end: "09:00" }],
      availablePeriods: [],
      notes: "",
      source: "operator_form",
      updatedAt: "2026-08-13T00:00:00.000Z"
    }]);
    assert.deepEqual(controlledDrafts.map((item) => [item.canonicalId, item.publicName, item.category]), [
      ["breakfast", "早餐", "policy"],
      ["pets", "寵物規則", "policy"],
      ["travel_subsidy", "國旅補助", "policy"]
    ]);
    assert.equal(controlledDrafts[0].publicText, "早餐需於入住三日前預約。", "existing breakfast data must be read into the controlled entry");
    assert.equal(controlledDrafts[0].fees, '[{"label":"早餐費","amount":200,"currency":"TWD","unit":"person"}]');
    assert.equal(controlledDrafts[1].status, "unknown", "a missing pet fact must produce exactly one empty controlled draft");
    assert.equal(controlledDrafts[2].status, "unknown", "a missing travel-subsidy fact must produce exactly one empty controlled draft");
    const controlledPayload = buildPropertyFactsPayload("property_alpha", controlledDrafts, () => new Date("2026-08-13T01:00:00.000Z"));
    assert.deepEqual(controlledPayload.facts.map((item) => [item.canonicalId, item.publicName, item.category]), [
      ["breakfast", "早餐", "policy"],
      ["pets", "寵物規則", "policy"],
      ["travel_subsidy", "國旅補助", "policy"]
    ]);
    const controlledSave = await fetch(`${running.url}/api/property-facts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(controlledPayload)
    });
    assert.equal(controlledSave.status, 200);
    const controlledRead = await fetch(`${running.url}/api/property-facts?propertyId=property_alpha`);
    assert.equal(controlledRead.status, 200);
    const controlledFacts = (await controlledRead.json()).data.facts;
    assert.equal(controlledFacts.filter((item) => item.canonicalId === "breakfast").length, 1, "breakfast must round-trip as one formal row");
    assert.equal(controlledFacts.filter((item) => item.canonicalId === "pets").length, 1, "pets must round-trip as one formal row");
    assert.equal(controlledFacts.filter((item) => item.canonicalId === "travel_subsidy").length, 1, "travel subsidy must round-trip as one formal row");
    const editedDrafts = buildControlledPolicyFactDrafts(controlledFacts);
    editedDrafts.find((item) => item.canonicalId === "pets").status = "allowed";
    editedDrafts.find((item) => item.canonicalId === "pets").publicText = "可攜帶寵物，入住前需告知。";
    editedDrafts.find((item) => item.canonicalId === "travel_subsidy").status = "conditional";
    editedDrafts.find((item) => item.canonicalId === "travel_subsidy").publicText = "本館配合國旅補助，申請方式請依正式公告辦理。";
    const editedPayload = buildPropertyFactsPayload("property_alpha", editedDrafts, () => new Date("2026-08-13T02:00:00.000Z"));
    const editedSave = await fetch(`${running.url}/api/property-facts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editedPayload)
    });
    assert.equal(editedSave.status, 200);
    const editedFacts = (await editedSave.json()).data.facts;
    assert.equal(editedFacts.find((item) => item.canonicalId === "pets").publicText, "可攜帶寵物，入住前需告知。");
    assert.equal(editedFacts.filter((item) => item.canonicalId === "pets").length, 1, "editing pets must not create a duplicate row");
    assert.equal(editedFacts.find((item) => item.canonicalId === "travel_subsidy").publicText, "本館配合國旅補助，申請方式請依正式公告辦理。");
    assert.equal(editedFacts.filter((item) => item.canonicalId === "travel_subsidy").length, 1, "editing travel subsidy must not create a duplicate row");
    const payload = buildPropertyFactsPayload("property_alpha", [{
      canonicalId: "parking",
      category: "amenity",
      status: "conditional",
      appliesTo: "whole_property",
      publicText: "需預約。",
      fees: '[{"label":"停車費","amount":100,"currency":"TWD","unit":"vehicle"}]',
      advanceNoticeRequired: "true",
      reservationRequired: "true",
      conditions: "入住前預約",
      restrictions: "每房一台",
      operatingHours: '[{"label":"每日","start":"08:00","end":"20:00"}]',
      availablePeriods: "[]",
      notes: "",
      source: "operator_form",
      updatedAt: "2026-07-27T02:00:00.000Z"
    }]);
    assert.deepEqual(payload, {
      propertyId: "property_alpha",
      facts: [{
        canonicalId: "parking",
        publicName: "停車",
        category: "amenity",
        status: "conditional",
        appliesTo: "whole_property",
        publicText: "需預約。",
        fees: [{ label: "停車費", amount: 100, currency: "TWD", unit: "vehicle" }],
        advanceNoticeRequired: true,
        reservationRequired: true,
        conditions: ["入住前預約"],
        restrictions: ["每房一台"],
        operatingHours: [{ label: "每日", start: "08:00", end: "20:00" }],
        availablePeriods: [],
        notes: "",
        source: "operator_form",
        updatedAt: "2026-07-27T02:00:00.000Z"
      }]
    });

    const equipmentDrafts = buildHighFrequencyEquipmentDrafts([{
      canonicalId: "wifi",
      publicName: "不可採用的名稱",
      category: "amenity",
      status: "allowed",
      appliesTo: "both",
      publicText: "全館與房內皆提供免費 Wi-Fi。",
      fees: [],
      advanceNoticeRequired: null,
      reservationRequired: null,
      conditions: [],
      restrictions: [],
      operatingHours: [],
      availablePeriods: [],
      notes: "密碼於入住時提供",
      source: "operator_form",
      updatedAt: "2026-08-13T00:00:00.000Z"
    }]);
    assert.equal(equipmentDrafts.length, 15);
    const wifi = equipmentDrafts.find((item) => item.canonicalId === "wifi");
    assert.equal(wifi.publicName, "Wi-Fi");
    assert.equal(wifi.status, "allowed");
    assert.equal(wifi.appliesTo, "whole_property");
    const unknown = equipmentDrafts.find((item) => item.canonicalId === "tv");
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.publicText, "");
    const equipmentPayload = buildPropertyFactsPayload("property_alpha", equipmentDrafts, () => new Date("2026-08-13T01:00:00.000Z"));
    assert.equal(equipmentPayload.facts.find((item) => item.canonicalId === "wifi").publicName, "Wi-Fi");
    assert.equal(equipmentPayload.facts.find((item) => item.canonicalId === "tv").publicText, "");
    console.log("operator data form: PASS");
  } finally {
    if (app) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
