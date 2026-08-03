"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");

const PROPERTY_A = "demo_homestay_a";
const PROPERTY_B = "demo_homestay_b";

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-identity-guard-"));
  const providers = { kind: "json", ...createJsonProviders({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json")
  }) };
  const encryptionKey = crypto.randomBytes(32).toString("base64");
  const bindingA = attachPropertyScopedLineBinding({
    providers,
    propertyId: PROPERTY_A,
    channelSecret: "property-a-channel-secret",
    channelAccessToken: "property-a-channel-token",
    encryptionKey
  });
  const bindingB = attachPropertyScopedLineBinding({
    providers,
    propertyId: PROPERTY_B,
    channelSecret: "property-b-channel-secret",
    channelAccessToken: "property-b-channel-token",
    encryptionKey,
    enabled: false
  });
  const app = createApp({
    providers,
    lineBindingEnv: bindingA.lineBindingEnv,
    conversationDebounceMs: 1,
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async () => {
        const error = new Error("test reply rejection");
        error.status = 400;
        throw error;
      }
    })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const emptyBody = JSON.stringify({
      destination: "untrusted-destination",
      propertyId: PROPERTY_B,
      customerId: PROPERTY_B,
      events: []
    });
    const invalidSignature = await bindingA.post(running.url, emptyBody, {
      signature: "invalid"
    });
    assert.equal(invalidSignature.status, 401);
    assert.equal((await invalidSignature.json()).error.code, "INVALID_LINE_SIGNATURE");

    const crossBindingSignature = bindingB.sign(emptyBody);
    assert.equal((await bindingA.post(running.url, emptyBody, {
      signature: crossBindingSignature
    })).status, 401, "a different binding secret must not authorize the route");

    assert.equal((await bindingA.post(running.url, emptyBody, {
      routeSuffix: `?propertyId=${PROPERTY_B}&customerId=${PROPERTY_B}`
    })).status, 200, "query and body identity must not override the bound property");
    assert.equal(bindingA.bindingService.status(PROPERTY_A).propertyId, PROPERTY_A);

    const eventId = `identity-pass-${Date.now()}`;
    const eventBody = JSON.stringify({
      destination: "untrusted-destination",
      propertyId: PROPERTY_B,
      customerId: PROPERTY_B,
      events: [{
        type: "message",
        webhookEventId: eventId,
        timestamp: Date.now(),
        replyToken: "test-reply-token",
        source: { type: "user", userId: "Utestuser" },
        message: { id: "test-message-id", type: "text", text: "test message" }
      }]
    });
    assert.equal((await bindingA.post(running.url, eventBody, {
      routeSuffix: `?propertyId=${PROPERTY_B}&customerId=${PROPERTY_B}`
    })).status, 200);
    assert.ok(
      providers.persistence.findMessageByEventId(PROPERTY_A, eventId),
      "the signed binding must be the only property authority"
    );
    assert.equal(
      providers.persistence.findMessageByEventId(PROPERTY_B, eventId),
      null,
      "destination, body and query must not switch property"
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const failedReply = providers.persistence.findMessageByEventId(PROPERTY_A, eventId);
    assert.equal(failedReply.deliveryErrorCode, "line_reply_http_error_400");

    assert.equal((await bindingB.post(running.url, emptyBody)).status, 404);
    const unknown = await fetch(`${running.url}/api/line/webhooks/unknown-binding-key-00000000000000`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": "invalid" },
      body: emptyBody
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, "LINE_BINDING_NOT_FOUND");
    console.log(JSON.stringify({ caseCount: 12, passCount: 12, failCount: 0 }));
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
