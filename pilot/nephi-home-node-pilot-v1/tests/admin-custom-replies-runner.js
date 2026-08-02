"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createApp } = require("../server");

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
  const app = createApp({ providers, adminAuthRequired: false, now: () => new Date("2026-07-30T04:00:00.000Z") });
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
    result = await request(running.url, "/api/custom-replies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: "property_alpha",
        name: "九月公告",
        topic: "booking_open",
        scope: "all",
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
    result = await request(running.url, "/api/custom-replies/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: "property_alpha",
        ruleId,
        request: {
          capability: "availability",
          canonicalEntity: { category: "other", canonicalId: null },
          temporalState: { checkIn: "2026-09-03" }
        }
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.matched, true);
    assert.equal(result.body.data.rule.ruleId, ruleId);
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
