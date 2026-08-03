"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createApp } = require("../server");

function availabilityPlan(sourceEvents) {
  const source = sourceEvents[0];
  const dateExpressions = new Map([
    ["9/3 可以訂房嗎？", "9/3"],
    ["9/3 還有房能訂嗎？", "9/3"],
    ["想問 9/3 是否能住宿？", "9/3"]
  ]);
  const stay = {
    dateExpression: { rawText: dateExpressions.get(source.messageText), kind: "absolute", anchor: "none" },
    checkInCandidate: "2026-09-03",
    checkOutCandidate: "2026-09-04",
    nightsCandidate: 1,
    guestCountCandidate: null
  };
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay,
    tasks: [{
      candidateIndex: 0,
      taskId: "availability",
      type: "availability",
      sourceText: source.messageText,
      detailIntent: "general",
      requestedOutputs: ["availability"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: true,
      entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 0.99 },
      stayCandidate: stay,
      confidence: 0.99
    }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{ eventId: source.eventId, messageRef: "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "admin_custom_reply_semantic_contract"
  };
}

async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { response, body };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-admin-custom-"));
  const seedFile = path.join(temp, "seed.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    seedDays: 5,
    homestays: [{ customerId: "property_alpha", name: "Alpha", rooms: [{ id: "alpha_room", name: "Alpha Room", capacity: 2 }], safeFacts: {} }]
  }), "utf8");
  const providers = createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile, now: () => new Date("2026-07-30T04:00:00.000Z") });
  const plannerMessages = [];
  const app = createApp({
    providers,
    adminAuthRequired: false,
    now: () => new Date("2026-07-30T04:00:00.000Z"),
    conversationPlannerV2: {
      classify: async ({ sourceEvents }) => {
        plannerMessages.push(sourceEvents[0].messageText);
        return availabilityPlan(sourceEvents);
      }
    }
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const page = await request(running.url, "/admin");
    assert.equal(page.response.status, 200);
    const html = page.body;
    const order = ["房況管理", "房型與價格", "包棟方案", "自訂回覆", "其他必要設定"].map((label) => html.indexOf(label));
    assert.ok(order.every((position) => position >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order, "operator sections must use the required order");
    assert.match(html, /<details[^>]*class="[^"]*other-settings[^"]*"[^>]*>/);
    assert.doesNotMatch(html, /<details[^>]*class="[^"]*other-settings[^"]*"[^>]*\sopen(?:\s|>)/);
    assert.match(html, /房型特色（選填，最多3項）/);
    assert.match(html, /旅客查房頁/);
    assert.match(html, /不提供 AI 回答/);

    assert.match(html, /客人詢問的主題/);
    assert.match(html, /客人詢問的入住日期/);
    assert.match(html, /這則回覆會在以下情況使用/);
    assert.match(html, /測試這則回覆/);

    let result = await request(running.url, "/api/custom-replies?propertyId=property_alpha");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data, { used: 0, limit: 5, items: [] });
    result = await request(running.url, "/api/availability/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: "property_alpha", mode: "all_inventory", startDate: "2026-08-01", endDate: "2026-08-02", status: "available" })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.updated, 2);
    result = await request(running.url, "/api/availability/month?propertyId=property_alpha&year=2026&month=8");
    assert.equal(result.body.data.rows.find(row => row.date === "2026-08-01").alpha_room, "available");
    result = await request(running.url, "/api/custom-replies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: "property_alpha",
        name: "九月公告",
        topic: "booking_open",
        scope: "room_only",
        roomTypeId: "",
        stayStartDate: "2026-09-01",
        stayEndDate: "2026-09-30",
        effectiveStartDate: "2026-07-01",
        effectiveEndDate: "2026-09-30",
        approvedReply: "九月尚未開放預訂。",
        enabled: true
      })
    });
    assert.equal(result.response.status, 201);
    const ruleId = result.body.data.rule.ruleId;
    result = await request(running.url, "/api/availability/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: "property_alpha", mode: "all_inventory", startDate: "2026-09-03", endDate: "2026-09-03", status: "available" })
    });
    assert.equal(result.response.status, 200);
    const synonymousQuestions = [
      "9/3 可以訂房嗎？",
      "9/3 還有房能訂嗎？",
      "想問 9/3 是否能住宿？"
    ];
    for (const messageText of synonymousQuestions) {
      result = await request(running.url, "/api/custom-replies/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: "property_alpha", ruleId, messageText })
      });
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.matched, true, `${messageText} must match through the production semantic chain`);
      assert.equal(result.body.data.rule.ruleId, ruleId);
    }
    assert.deepEqual(plannerMessages, synonymousQuestions, "admin testing must invoke the same Planner boundary for every natural-language question");
    assert.equal((await request(running.url, "/api/custom-replies?propertyId=property_alpha")).body.data.used, 1, "testing must not mutate stored rules");
    result = await request(running.url, `/api/custom-replies/${encodeURIComponent(ruleId)}/enabled`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "property_alpha", enabled: false })
    });
    assert.equal(result.body.data.rule.state, "disabled");
    result = await request(running.url, `/api/custom-replies/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "property_alpha" })
    });
    assert.deepEqual(result.body.data, { deleted: true });

    console.log(JSON.stringify({ suite: "admin-custom-replies", pass: true, assertions: 20 }));
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
