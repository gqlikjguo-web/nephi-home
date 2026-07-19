"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

const secret = "test-channel-secret";
const route = "/api/junzan-test-line/webhook";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-line-gateway-"));

async function post(url, rawBody, signature) {
  return fetch(`${url}${route}?customerId=demo_homestay_a`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: rawBody });
}

(async () => {
  const app = createApp({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), structuredClassifier: null, lineChannelSecret: secret, lineChannelAccessToken: "test-channel-access-token", conversationDebounceMs: 5, lineChannelIdentityGuardRequired: false });
  const running = await app.start(0, "127.0.0.1");
  try {
    const rawBody = JSON.stringify({ events: [] });
    const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    assert.equal((await post(running.url, rawBody, signature)).status, 200);
    assert.equal((await post(running.url, rawBody, "invalid")).status, 401);
    console.log(JSON.stringify({ caseCount: 2, passCount: 2, failCount: 0 }));
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
