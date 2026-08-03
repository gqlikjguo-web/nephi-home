"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const {
  attachPropertyScopedLineBinding,
  waitFor
} = require("./helpers/property-scoped-line-webhook");

function parkingPlan(sourceEvent) {
  const sourceText = String(sourceEvent.messageText || "Parking?");
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks: [{
      candidateIndex: 0,
      taskId: "parking",
      type: "amenity",
      sourceText,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: "amenity",
        rawText: "parking",
        canonicalCandidate: "parking",
        confidence: 0.99
      },
      confidence: 0.99
    }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: String(sourceEvent.eventId || ""),
        startOffset: 0,
        endOffset: sourceText.length,
        quote: sourceText
      }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "official_adapter_test"
  };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "official-line-adapter-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "store.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    seedDays: 3,
    messageLogs: { official_property: [] },
    homestays: [{
      customerId: "official_property",
      name: "Official Property",
      safeFacts: { parkingRule: "Official parking fact" },
      rooms: [{ id: "room-a", name: "Room A", type: "double", capacity: 2 }]
    }]
  }));
  const providers = {
    kind: "json",
    ...createJsonProviders({ dataFile, seedFile })
  };
  const binding = attachPropertyScopedLineBinding({
    providers,
    propertyId: "official_property",
    channelSecret: "test-channel-secret",
    channelAccessToken: "test-channel-access-token"
  });
  const plannerProperties = [];
  const requests = [];
  const app = createApp({
    providers,
    lineBindingEnv: binding.lineBindingEnv,
    conversationDebounceMs: 1,
    conversationPlannerV2: {
      classify: async ({ catalog, sourceEvents }) => {
        plannerProperties.push(catalog.propertyId);
        return parkingPlan(sourceEvents[0]);
      }
    },
    lineReplyClientFactory: ({ channelAccessToken }) => ({
      replyMessageWithHttpInfo: async (body) => {
        requests.push({ channelAccessToken, body });
        return { httpResponse: { status: 200 } };
      }
    })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const rawBody = JSON.stringify({
      destination: "untrusted-destination",
      propertyId: "attacker-property",
      customerId: "attacker-property",
      events: [{
        type: "message",
        webhookEventId: "official-adapter-event",
        replyToken: "reply-token",
        timestamp: 1,
        source: { userId: "line-user" },
        message: { type: "text", id: "message-id", text: "Parking?" }
      }]
    });
    assert.equal((await binding.post(running.url, rawBody, {
      routeSuffix: "?propertyId=attacker-property&customerId=attacker-property"
    })).status, 200);
    await waitFor(() => requests.length === 1);
    assert.deepEqual(plannerProperties, ["official_property"]);
    assert.equal(requests[0].channelAccessToken, "test-channel-access-token");
    assert.deepEqual(requests[0].body.replyToken, "reply-token");
    assert.match(requests[0].body.messages[0].text, /Official parking fact/);
    assert.equal((await binding.post(running.url, rawBody, {
      signature: binding.sign(rawBody).slice(1)
    })).status, 401);
    console.log(JSON.stringify({ caseCount: 6, passCount: 6, failCount: 0 }));
  } finally {
    await app.stop();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
