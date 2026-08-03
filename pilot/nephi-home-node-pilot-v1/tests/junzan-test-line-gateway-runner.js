"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");

const secret = "test-channel-secret";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-line-gateway-"));

(async () => {
  const providers = { kind: "json", ...createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json") }) };
  const binding = attachPropertyScopedLineBinding({ providers, propertyId: "demo_homestay_a", channelSecret: secret, channelAccessToken: "test-channel-access-token" });
  const app = createApp({ providers, lineBindingEnv: binding.lineBindingEnv, conversationDebounceMs: 5 });
  const running = await app.start(0, "127.0.0.1");
  try {
    const rawBody = JSON.stringify({ events: [] });
    assert.equal((await binding.post(running.url, rawBody)).status, 200);
    assert.equal((await binding.post(running.url, rawBody, { signature: "invalid" })).status, 401);
    console.log(JSON.stringify({ caseCount: 2, passCount: 2, failCount: 0 }));
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
