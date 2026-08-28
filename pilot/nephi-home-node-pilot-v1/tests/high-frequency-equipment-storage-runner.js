"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { seedDemoPostgres } = require("./helpers/demo-postgres-seed");
const { createProviders } = require("../lib/providers/provider-factory");
const { cleanInput } = require("../lib/onboarding-service");
const { normalizePropertyFacts } = require("../lib/property-facts");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { buildFinalResponse } = require("../lib/conversation-engine-v2/final-response-renderer");
const { buildHighFrequencyEquipmentDrafts, buildPropertyFactsPayload, equipmentFieldPolicy } = require("../public/assets/property-facts-form");

const SESSION_TOKEN = "equipment-new-session";
const MULTILINE_PUBLIC_TEXT = "國旅補助注意事項：\r\n\r\n• 限本國國民個別旅客，每房每晚限用一次\r\n• 適用時間：週日～週四（不含國定假日與連續假期）\r\n• 國際平台訂房不適用\r\n• 如補助經費提前用罄，依觀光署公告為準。\r\n\r\n詳情請參考：\r\nhttps://taiwantravel.tad.gov.tw/web_page/index.jsp";
const NORMALIZED_MULTILINE_PUBLIC_TEXT = MULTILINE_PUBLIC_TEXT.replace(/\r\n/g, "\n");
const MULTILINE_NOTES = "第一段內部備註\r\n\r\n第二段  保留兩個空格";
const NORMALIZED_MULTILINE_NOTES = MULTILINE_NOTES.replace(/\r\n/g, "\n");


function fact(canonicalId, status, publicText, appliesTo = "whole_property") {
  return {
    canonicalId,
    publicName: "不得信任的送入名稱",
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
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
}

function application(propertyName, propertyFacts, rooms = []) {
  return cleanInput({
    propertyName,
    contactName: "設備測試業者",
    phone: "0900000000",
    email: `${propertyName}@example.test`,
    address: "測試地址",
    googleMapsUrl: "",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    line: { hasOfficialAccount: false, contactLink: "" },
    rooms,
    bundles: [],
    propertyFacts,
    knowledge: []
  });
}

async function api(url, route, options = {}) {
  const response = await fetch(`${url}${route}`, {
    ...options,
    headers: {
      cookie: `nephi_admin_session=${SESSION_TOKEN}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

(async () => {
  assert.deepEqual(equipmentFieldPolicy("unknown"), {
    showPublicText: false,
    showNotes: false,
    publicTextRequired: false
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "equipment-storage-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  try {
    await migratePostgres(connection);
    await seedDemoPostgres(connection);
    const providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    let app = null;
    try {
      const newFacts = [
        fact("wifi", "allowed", "全館提供免費 Wi-Fi。", "both"),
        fact("clothes_dryer", "not_allowed", ""),
        fact("baby_crib", "unknown", "不得成為答案"),
        fact("toiletries", "allowed", "提供毛巾、浴巾、洗髮乳與沐浴乳；牙刷請自備。")
      ];
      const onboardingDrafts = buildHighFrequencyEquipmentDrafts(newFacts, "operator_onboarding");
      const onboardingFacts = buildPropertyFactsPayload("", onboardingDrafts).facts;
      assert.equal(onboardingFacts.length, 15, "onboarding must submit every active system-controlled equipment preset");
      const newApplication = application("equipment_new", onboardingFacts, [{
        key: "main",
        roomCode: "",
        displayName: "設備測試房",
        type: "雙人房",
        capacity: 2,
        highlights: [],
        mondayThursdayPrice: 1000,
        fridayPrice: 1200,
        saturdayHolidayPrice: 1500,
        sundayPrice: 1100,
        enabled: true
      }]);
      assert.equal(newApplication.propertyFacts.find((item) => item.canonicalId === "wifi").publicName, "Wi-Fi");
      assert.equal(newApplication.propertyFacts.find((item) => item.canonicalId === "toiletries").publicName, "盥洗用品");
      assert.equal(newApplication.propertyFacts.find((item) => item.canonicalId === "baby_crib").publicText, "");
      providers.onboarding.createOnboarding("equipment-new-application", "draft-hash");
      providers.onboarding.saveOnboarding("equipment-new-application", newApplication);
      const draft = providers.onboarding.getOnboarding("equipment-new-application");
      assert.equal(draft.propertyFacts.find((item) => item.canonicalId === "wifi").publicText, "全館提供免費 Wi-Fi。");
      providers.onboarding.submitOnboarding("equipment-new-application");
      const review = providers.onboarding.getOnboardingForReview("equipment-new-application");
      assert.equal(review.propertyFacts.find((item) => item.canonicalId === "clothes_dryer").status, "not_allowed");
      providers.onboarding.approveOnboarding("equipment-new-application", "equipment_new", "owner", "invite-hash", new Date(Date.now() + 86400000).toISOString(), "platform", "reviewer");
      const created = providers.customerSettings.getProperty("equipment_new");
      assert.equal(created.propertyFacts.find((item) => item.canonicalId === "wifi").publicName, "Wi-Fi");
      assert.equal(created.propertyFacts.find((item) => item.canonicalId === "clothes_dryer").status, "not_allowed");

      const preserved = normalizePropertyFacts([fact("parking", "allowed", "保留既有停車事實。")])[0];
      const oldWifi = normalizePropertyFacts([fact("wifi", "allowed", "舊 Wi-Fi 事實。")])[0];
      providers.customerSettings.updatePropertyFacts("demo_fixture_property", [preserved, oldWifi]);
      const existingApplication = application("demo_fixture_property_updated", [fact("wifi", "not_allowed", "")]);
      providers.onboarding.createOnboarding("equipment-existing-application", "draft-hash-existing");
      providers.onboarding.saveOnboarding("equipment-existing-application", existingApplication);
      providers.onboarding.submitOnboarding("equipment-existing-application");
      providers.onboarding.approveOnboardingExisting("equipment-existing-application", "demo_fixture_property", [], [], "platform", "reviewer");
      const updated = providers.customerSettings.getProperty("demo_fixture_property");
      assert.equal(updated.propertyFacts.find((item) => item.canonicalId === "wifi").status, "not_allowed");
      assert.equal(updated.propertyFacts.find((item) => item.canonicalId === "parking").publicText, "保留既有停車事實。");

      providers.persistence.getAdminSession = async (hash) => hash === sessionTokenHash(SESSION_TOKEN)
        ? { propertyId: "equipment_new", username: "owner" }
        : null;
      app = createApp({ providers, adminAuthRequired: true, lineBindingEnv: {} });
      const running = await app.start(0, "127.0.0.1");

      const adminInitial = await api(running.url, "/api/property-facts?propertyId=equipment_new");
      assert.equal(adminInitial.response.status, 200);
      assert.equal(adminInitial.body.data.facts.length, 15);
      assert.equal(adminInitial.body.data.facts.find((item) => item.canonicalId === "wifi").publicText, "\u5168\u9928\u63d0\u4f9b\u514d\u8cbb Wi-Fi\u3002");
      assert.equal(adminInitial.body.data.facts.find((item) => item.canonicalId === "toiletries").publicText, "提供毛巾、浴巾、洗髮乳與沐浴乳；牙刷請自備。");

      const adminFacts = adminInitial.body.data.facts.map((item) => {
        if (item.canonicalId === "wifi") return { ...item, appliesTo: "both", publicText: "Admin \u66f4\u65b0\uff1a\u5168\u9928\u8207\u623f\u5167\u63d0\u4f9b\u514d\u8cbb Wi-Fi\u3002", notes: "\u8def\u7531\u5668\u91cd\u555f\u65b9\u5f0f\u50c5\u4f9b\u696d\u8005\u5167\u90e8\u4f7f\u7528\u3002" };
        if (item.canonicalId === "clothes_dryer") return { ...item, status: "not_allowed", publicText: "", notes: "\u53ef\u5354\u52a9\u4ecb\u7d39\u9644\u8fd1\u81ea\u52a9\u6d17\u8863\u5e97\u3002" };
        if (item.canonicalId === "toiletries") return { ...item, publicText: "更新後提供浴巾、洗髮乳及沐浴乳。", notes: "依入住人數備品" };
        return item;
      });
      adminFacts.push({
        canonicalId: "travel_subsidy",
        publicName: "國旅補助",
        category: "policy",
        status: "allowed",
        appliesTo: "whole_property",
        publicText: MULTILINE_PUBLIC_TEXT,
        fees: [],
        advanceNoticeRequired: null,
        reservationRequired: null,
        conditions: [],
        restrictions: [],
        operatingHours: [],
        availablePeriods: [],
        notes: MULTILINE_NOTES,
        source: "operator_form",
        updatedAt: "2026-08-22T00:00:00.000Z"
      });
      const adminSaved = await api(running.url, "/api/property-facts", {
        method: "PUT",
        body: JSON.stringify({ propertyId: "equipment_new", facts: adminFacts })
      });
      assert.equal(adminSaved.response.status, 200);
      const adminReadBack = await api(running.url, "/api/property-facts?propertyId=equipment_new");
      assert.equal(adminReadBack.response.status, 200);
      assert.deepEqual(adminReadBack.body.data.facts, adminSaved.body.data.facts);
      assert.equal(adminReadBack.body.data.facts.find((item) => item.canonicalId === "wifi").notes, "\u8def\u7531\u5668\u91cd\u555f\u65b9\u5f0f\u50c5\u4f9b\u696d\u8005\u5167\u90e8\u4f7f\u7528\u3002");
      assert.equal(adminReadBack.body.data.facts.find((item) => item.canonicalId === "toiletries").publicText, "更新後提供浴巾、洗髮乳及沐浴乳。");
      assert.equal(adminReadBack.body.data.facts.filter((item) => item.canonicalId === "toiletries").length, 1, "editing toiletries must not create a duplicate row");
      assert.equal(adminReadBack.body.data.facts.find((item) => item.canonicalId === "travel_subsidy").publicText, NORMALIZED_MULTILINE_PUBLIC_TEXT);
      assert.equal(adminReadBack.body.data.facts.find((item) => item.canonicalId === "travel_subsidy").notes, NORMALIZED_MULTILINE_NOTES);

      const formalProperty = providers.customerSettings.getProperty("equipment_new");
      assert.deepEqual(formalProperty.propertyFacts, adminReadBack.body.data.facts);
      const catalog = buildPropertyCatalog(formalProperty);
      const catalogById = new Map(catalog.amenities.map((item) => [item.canonicalId, item]));
      const tasks = ["wifi", "clothes_dryer", "baby_crib"].map((canonicalId, index) => ({
        taskId: `roundtrip-equipment-${index + 1}`,
        type: "amenity",
        detailIntent: "general",
        entity: { rawText: catalogById.get(canonicalId).publicName },
        _resolvedEntity: { status: "resolved", entity: catalogById.get(canonicalId) }
      }));
      const outcomes = executeTasks({
        property: formalProperty,
        catalog,
        tasks,
        request: { stay: {}, inventory: {} }
      });
      assert.deepEqual(
        outcomes.map((item) => ({ status: item.status, factStatus: item.facts.status, answer: item.facts.answer || "" })),
        [
          { status: "answered", factStatus: "confirmed_yes", answer: "Admin \u66f4\u65b0\uff1a\u5168\u9928\u8207\u623f\u5167\u63d0\u4f9b\u514d\u8cbb Wi-Fi\u3002" },
          { status: "answered", factStatus: "confirmed_no", answer: "" },
          { status: "needs_human", factStatus: undefined, answer: "" }
        ]
      );
      assert.equal(outcomes[0].facts.answer.includes("\u8def\u7531\u5668\u91cd\u555f"), false, "internal notes must not become a guest answer");
      const travelSubject = catalog.policies.find((item) => item.canonicalId === "travel_subsidy");
      assert.equal(travelSubject.answer, NORMALIZED_MULTILINE_PUBLIC_TEXT);
      const travelOutcome = executeTasks({
        property: formalProperty,
        catalog,
        tasks: [{ taskId: "travel-subsidy", type: "policy", detailIntent: "general", entity: { rawText: "國旅補助" }, _resolvedEntity: { status: "resolved", entity: travelSubject } }],
        request: { stay: {}, inventory: {} }
      })[0];
      const responsePlan = buildResponsePlan({
        propertyId: formalProperty.propertyId,
        taskResults: [travelOutcome],
        inputTaskIds: ["travel-subsidy"],
        canonicalRequests: [{ taskId: "travel-subsidy", capability: "policy", resolverId: "property_catalog", riskLevel: "low", responseMode: "answer", canonicalEntity: { status: "resolved", canonicalId: "travel_subsidy", category: "policy" } }]
      });
      const composed = composeControlledReply(responsePlan);
      const claimValidation = validateClaims(composed, responsePlan, ["travel-subsidy"]);
      const finalResponse = buildFinalResponse({ finalDecision: { action: "reply" }, responsePlan, validatedReplyText: composed, claimValidation });
      assert.equal(composed, NORMALIZED_MULTILINE_PUBLIC_TEXT);
      assert.equal(finalResponse.replyText, NORMALIZED_MULTILINE_PUBLIC_TEXT);
    } finally {
      if (app) await app.stop(); else await providers.close();
    }
    console.log("high-frequency equipment storage: PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
