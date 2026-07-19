"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { createGateway } = require("./gateway");

function request(server, { path, body, signature, method = "POST" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, method, path, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-line-signature": signature || "" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject); req.end(body);
  });
}

async function withServer(options, action) {
  const server = createGateway(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await action(server); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function run() {
  const secret = "test-channel-secret";
  const raw = JSON.stringify({ events: [] });
  const sign = (body) => crypto.createHmac("sha256", secret).update(body).digest("base64");
  let processed = 0;
  let replies = 0;
  const claimed = new Set();
  const options = {
    env: { LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: "test-token", PROPERTY_ID: "nephi_home" },
    createCore: () => ({ claimEvent: async ({ eventId }) => ({ claimed: !claimed.has(eventId) && (claimed.add(eventId), true) }), processMessage: async () => { processed += 1; return { shouldReply: true, replyText: "ok" }; } }),
    clientFactory: () => ({ replyMessage: async () => { replies += 1; } })
  };

  await withServer(options, async (server) => {
    const health = await request(server, { method: "GET", path: "/health", body: "" });
    assert.equal(health.status, 200); assert.equal(JSON.parse(health.body).data.testOnly, true);
    assert.equal((await request(server, { path: "/webhook?propertyId=nephi_home", body: raw, signature: sign(raw) })).status, 200);
    assert.equal((await request(server, { path: "/webhook?propertyId=nephi_home", body: raw, signature: "invalid" })).status, 401);
  });

  const textEvent = JSON.stringify({ events: [{ webhookEventId: "evt-1", type: "message", replyToken: "reply-1", source: { userId: "u-1" }, message: { type: "text", text: "測試" }, timestamp: 1 }] });
  await withServer(options, async (server) => {
    assert.equal((await request(server, { path: "/webhook?propertyId=nephi_home", body: textEvent, signature: sign(textEvent) })).status, 200);
    assert.equal((await request(server, { path: "/webhook?propertyId=nephi_home", body: textEvent, signature: sign(textEvent) })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(processed, 1); assert.equal(replies, 1);
  });

  await withServer({ env: { PROPERTY_ID: "nephi_home" } }, async (server) => {
    assert.equal((await request(server, { path: "/webhook?propertyId=nephi_home", body: raw, signature: sign(raw) })).status, 503);
  });

  const source = require("node:fs").readFileSync(require.resolve("./gateway"), "utf8");
  for (const forbidden of ["lineWebhookHandler", "test-line-webhook", "line-channel-identity-guard", "pushToTestLine", "server.js"]) assert.equal(source.includes(forbidden), false, `must not load ${forbidden}`);
  process.stdout.write("junzan-line-gateway 10/10 PASS\n");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
