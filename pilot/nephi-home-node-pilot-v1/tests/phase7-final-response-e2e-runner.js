"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

const secret = "phase7-secret";
const propertyId = "demo_homestay_a";
const channelId = "line";
const lineUserId = "phase7-user";
const property = {
  propertyId,
  displayName: "Test",
  timezone: "Asia/Taipei",
  currency: "TWD",
  rooms: [],
  commonAnswers: { parkingRule: "民宿旁空地可停車。" },
  semanticCatalog: { aliases: { parking: ["parking"] }, amenities: [] }
};

function plannerFor(kind) {
  return {
    classify: async ({ sourceEvents }) => {
      const source = sourceEvents[0];
      const relation = (candidateIndex) => ({
        candidateIndex,
        kind: "new_request",
        candidateRequestCycleRefs: [],
        evidenceRefs: [{
          eventId: source.eventId,
          startOffset: 0,
          endOffset: source.messageText.length,
          quote: source.messageText
        }]
      });
      const base = {
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
        ambiguities: [],
        missingInformation: [],
        needsHuman: false,
        shouldIgnore: false,
        reason: "phase7_e2e"
      };
      if (kind === "no_reply") {
        const task = {
          taskId: "ack",
          candidateIndex: 0,
          type: "unknown",
          sourceText: "acknowledgement",
          detailIntent: "general",
          requestedOutputs: ["answer"],
          eligibilityEvidence: { kind: "none", sourceText: "" },
          dependsOnStayContext: false,
          stayCandidate: null,
          entity: {
            category: "other",
            rawText: "acknowledgement",
            canonicalCandidate: null,
            confidence: 0.99
          },
          confidence: 0.99
        };
        return {
          ...base,
          discourse: { relation: "acknowledgement", confidence: 0.99 },
          shouldIgnore: true,
          tasks: [task],
          contextRelationCandidates: [relation(0)]
        };
      }
      if (kind === "clarification") {
        const task = {
          taskId: "availability",
          candidateIndex: 0,
          type: "availability",
          sourceText: "availability",
          requestedOutputs: ["availability"],
          dependsOnStayContext: true,
          stayCandidate: base.stay,
          entity: {
            category: "room",
            rawText: "",
            canonicalCandidate: null,
            confidence: 0.99
          },
          confidence: 0.99
        };
        return {
          ...base,
          tasks: [task],
          contextRelationCandidates: [relation(0)]
        };
      }
      if (kind === "handoff") {
        const task = {
          taskId: "human-help",
          candidateIndex: 0,
          type: "human_help",
          sourceText: "need human help",
          detailIntent: "general",
          requestedOutputs: ["answer"],
          eligibilityEvidence: { kind: "none", sourceText: "" },
          dependsOnStayContext: false,
          stayCandidate: null,
          entity: {
            category: "other",
            rawText: "need human help",
            canonicalCandidate: null,
            confidence: 0.99
          },
          confidence: 0.99
        };
        return {
          ...base,
          needsHuman: true,
          tasks: [task],
          contextRelationCandidates: [relation(0)]
        };
      }
      const task = {
        taskId: "parking",
        candidateIndex: 0,
        type: "amenity",
        sourceText: "parking",
        detailIntent: "general",
        requestedOutputs: ["answer"],
        eligibilityEvidence: { kind: "none", sourceText: "" },
        dependsOnStayContext: false,
        stayCandidate: null,
        entity: {
          category: "amenity",
          rawText: "parking",
          canonicalCandidate: "parking",
          confidence: 0.99
        },
        confidence: 0.99
      };
      return {
        ...base,
        tasks: [task],
        contextRelationCandidates: [relation(0)]
      };
    }
  };
}

function rejectedComposer() {
  return {
    compose: async () => ({
      sections: [{
        taskId: "parking",
        responseMode: "answer",
        text: "已通知業者，並保證可以停車。"
      }]
    })
  };
}

async function run(kind) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phase7-final-response-"));
  const calls = [];
  const composerCalls = [];
  const engineResults = new Map();
  const composer = kind === "claim_rejection"
    ? rejectedComposer()
    : kind === "composer_exception"
      ? { compose: async () => { composerCalls.push(kind); throw new Error("composer failed"); } }
      : kind === "no_reply"
        ? { compose: async () => { composerCalls.push(kind); return { sections: [] }; } }
        : null;
  const app = createApp({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    lineChannelSecret: secret,
    lineChannelAccessToken: "token",
    conversationDebounceMs: 1,
    lineChannelIdentityGuardRequired: false,
    testOnlyOverrides: {
      planner: plannerFor(kind),
      getProperty: () => property,
      ...(composer ? { composer } : {})
    },
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async (body) => {
        calls.push(body);
        return { httpResponse: { status: 200 } };
      }
    })
  });
  const processEngine = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const result = await processEngine(input);
    for (const eventId of input.eventIds || [input.eventId]) {
      engineResults.set(eventId, JSON.parse(JSON.stringify(result)));
    }
    return result;
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    const eventId = `phase7-${kind}`;
    const event = {
      type: "message",
      webhookEventId: eventId,
      replyToken: "reply-token",
      timestamp: Date.now(),
      source: { userId: lineUserId },
      message: {
        type: "text",
        id: `message-${eventId}`,
        text: kind
      }
    };
    const raw = JSON.stringify({ destination: channelId, events: [event] });
    const signature = crypto
      .createHmac("sha256", secret)
      .update(raw)
      .digest("base64");
    const response = await fetch(
      `${running.url}/api/test-line/webhook?customerId=${propertyId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": signature
        },
        body: raw
      }
    );
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = engineResults.get(eventId);
    assert.ok(result, `${kind} must complete the real Engine execution`);
    const mainRecord = app.providers.persistence.listMessageLogs(propertyId)
      .find((entry) => (
        entry.channelId === channelId
        && entry.lineUserId === lineUserId
        && entry.eventId === eventId
      ));
    return { calls, composerCalls, result, mainRecord };
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

(async () => {
  const expectedActions = {
    reply: "reply",
    clarification: "clarification",
    handoff: "handoff",
    no_reply: "no_reply",
    claim_rejection: "reply",
    composer_exception: "reply"
  };
  for (const [kind, expectedAction] of Object.entries(expectedActions)) {
    const { calls, composerCalls, result, mainRecord } = await run(kind);
    assert.equal(result.finalDecision.action, expectedAction);
    assert.equal(result.finalResponse.action, result.finalDecision.action);
    assert.equal(result.finalResponse.replyText, result.replyText);
    assert.equal(result.finalResponse.shouldReply, result.shouldReply);
    assert.ok(mainRecord, `${kind} must persist its exact message record`);
    assert.equal(mainRecord.replyText, result.finalResponse.replyText);
    if (expectedAction === "no_reply") {
      assert.equal(result.replyText, "");
      assert.equal(result.shouldReply, false);
      assert.equal(calls.length, 0);
      assert.equal(composerCalls.length, 0, "no_reply must not invoke Composer");
    } else {
      assert.equal(result.shouldReply, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].messages[0].text, result.finalResponse.replyText);
    }
    if (kind === "clarification") {
      assert.equal(result.replyText, "請補充入住日期。");
    }
    if (kind === "handoff") {
      assert.ok(result.replyText.includes("需要請業者確認"));
    }
    if (kind === "claim_rejection") {
      assert.equal(result.finalDecision.reasonCode, "execution_answered");
      assert.equal(result.replyText.includes("已通知業者"), false);
      assert.equal(result.replyText.includes("保證"), false);
      assert.equal(result.replyText, "民宿旁空地可停車。");
      assert.equal(result.finalDecision.reviewRequired, false);
    }
    if (kind === "composer_exception") {
      assert.equal(composerCalls.length, 1);
      assert.equal(result.finalDecision.reasonCode, "execution_answered");
      assert.equal(result.replyText, "民宿旁空地可停車。");
      assert.equal(result.finalDecision.reviewRequired, false);
    }
  }
  console.log("phase7 signed webhook final response e2e: PASS (6 paths)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
