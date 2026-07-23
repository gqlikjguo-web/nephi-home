"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");

function decision(type, approvedTaskResults, overrides = {}) {
  return {
    type,
    reasonCode: `test_${type}`,
    shouldReply: type !== "no_reply",
    approvedTaskResults,
    clarificationFields: [],
    handoffReason: "",
    sectionModes: {},
    ...overrides
  };
}

function plannerOutput({ shouldIgnore = false, tasks = [] } = {}) {
  return {
    schemaVersion: 2,
    discourse: { relation: shouldIgnore ? "acknowledgement" : "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks,
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: shouldIgnore ? "acknowledgement" : "test"
  };
}

function task(taskId, type, rawText, canonicalCandidate = null) {
  return {
    taskId,
    type,
    sourceText: rawText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: type === "amenity" ? "amenity" : "other", rawText, canonicalCandidate, confidence: 0.99 },
    confidence: 0.99
  };
}

function memory() {
  const states = new Map();
  const messages = [];
  return {
    messages,
    getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
    setConversationState: (propertyId, channelId, userId, value) => states.set(`${propertyId}:${channelId}:${userId}`, value),
    appendMessageLog: (_propertyId, value) => {
      messages.push(value);
      return { ...value, reviewId: value.needsReview ? `review-${messages.length}` : "" };
    },
    updateMessageEvent: (_propertyId, _channelId, _eventId, value) => {
      messages.push(value);
      return value;
    }
  };
}

const property = {
  propertyId: "final_decision_property",
  displayName: "Final Decision Lodge",
  timezone: "Asia/Taipei",
  rooms: [],
  commonAnswers: { parkingRule: "提供停車位。" },
  semanticCatalog: { aliases: { parking: ["停車"] }, amenities: [] }
};

async function runEngine(planner, { composer = null, diagnostics = [] } = {}) {
  const persistence = memory();
  const engine = new ConversationEngineV2({
    planner,
    composer,
    persistence,
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    availableDatesResolver: () => ({ status: "answered", dates: [], source: "test" }),
    listPriceOverrides: () => [],
    onDiagnostic: (item) => diagnostics.push(item),
    now: () => new Date("2026-07-23T02:00:00.000Z")
  });
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "test-line",
    lineUserId: "same-user",
    eventId: `event-${diagnostics.length}`,
    eventTimestamp: Date.parse("2026-07-23T10:00:00+08:00"),
    messageText: "test"
  });
  return { result, persistence };
}

async function main() {
  const missingDecision = buildResponsePlan({ propertyId: property.propertyId, inputTaskIds: [] });
  assert.equal(missingDecision.ok, false);
  assert.equal(missingDecision.error.code, "engine_final_decision_required");

  const noReplyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    finalDecision: decision("no_reply", [])
  });
  assert.equal(noReplyPlan.ok, false);
  assert.equal(noReplyPlan.error.code, "response_plan_for_no_reply");

  const approvedReply = {
    taskId: "reply",
    type: "amenity",
    status: "failed",
    facts: { subject: "停車", answer: "提供停車位。" }
  };
  const replyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["reply", "coverage-gap"],
    finalDecision: decision("reply", [approvedReply], { sectionModes: { reply: "answer" } })
  });
  assert.equal(replyPlan.ok, true);
  assert.equal(replyPlan.sections.length, 1, "Response Plan must not synthesize a failed section");
  assert.equal(replyPlan.sections[0].responseMode, "answer", "task status must not override Engine approval");
  assert.equal(replyPlan.coverageValidation.ok, false);
  assert.deepEqual(replyPlan.coverageValidation.missingTaskIds, ["coverage-gap"]);
  assert.equal(composeControlledReply(replyPlan), "提供停車位。");

  const clarificationResult = {
    taskId: "clarify",
    type: "availability",
    status: "answered",
    facts: {},
    question: "請提供入住日期。",
    missingInputs: ["stay.checkIn"]
  };
  const clarificationPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["clarify"],
    finalDecision: decision("clarification", [clarificationResult], {
      clarificationFields: ["stay.checkIn"],
      sectionModes: { clarify: "clarification" }
    })
  });
  assert.equal(clarificationPlan.ok, true);
  assert.equal(clarificationPlan.finalDecision.type, "clarification");
  assert.deepEqual(clarificationPlan.sections[0].missingInputs, ["stay.checkIn"]);
  assert.equal(composeControlledReply(clarificationPlan), "請提供入住日期。");

  const unapprovedClarification = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["clarify"],
    finalDecision: decision("clarification", [{ ...clarificationResult, missingInputs: ["stay.guests"] }], {
      clarificationFields: ["stay.checkIn"],
      sectionModes: { clarify: "clarification" }
    })
  });
  assert.equal(unapprovedClarification.ok, false);
  assert.equal(unapprovedClarification.error.code, "clarification_fields_not_approved");

  const handoffPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["handoff"],
    finalDecision: decision("human_handoff", [{
      taskId: "handoff",
      type: "unknown",
      status: "answered",
      facts: { subject: "接送安排" },
      reason: "property_confirmation_required",
      review: true
    }], {
      handoffReason: "property_confirmation_required",
      handoffReasons: { handoff: "property_confirmation_required" },
      sectionModes: { handoff: "handoff" }
    })
  });
  assert.equal(handoffPlan.ok, true);
  assert.equal(handoffPlan.sections[0].handoffReason, "property_confirmation_required");
  assert.equal(composeControlledReply(handoffPlan), "接送安排這部分需要請業者確認。");

  const emptyReplyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["empty"],
    finalDecision: decision("reply", [{ taskId: "empty", type: "amenity", status: "answered", facts: {} }], {
      sectionModes: { empty: "answer" }
    })
  });
  assert.equal(emptyReplyPlan.ok, true);
  assert.equal(composeControlledReply(emptyReplyPlan), "", "Composer must not create a global fallback");

  let composerCalls = 0;
  const noReplyDiagnostics = [];
  const ignored = await runEngine({
    classify: async () => plannerOutput({
      shouldIgnore: true,
      tasks: [task("ack", "unknown", "好的，謝謝")]
    })
  }, {
    composer: { compose: async () => { composerCalls += 1; return { sections: [] }; } },
    diagnostics: noReplyDiagnostics
  });
  assert.equal(ignored.result.finalDecision.type, "no_reply");
  assert.equal(ignored.result.finalDecision.shouldReply, false);
  assert.equal(composerCalls, 0);
  assert.equal(noReplyDiagnostics.some((item) => item.stage === "response_plan"), false);
  assert.equal(noReplyDiagnostics.some((item) => item.stage === "composer"), false);

  const composerFailureDiagnostics = [];
  const composerFailure = await runEngine({
    classify: async () => plannerOutput({
      tasks: [task("parking", "amenity", "停車", "parking")]
    })
  }, {
    composer: { compose: async () => { throw new Error("untrusted composer failure"); } },
    diagnostics: composerFailureDiagnostics
  });
  assert.equal(composerFailure.result.finalDecision.type, "reply");
  assert.equal(composerFailure.result.finalDecision.reasonCode, "composer_exception");
  assert.equal(composerFailure.result.replyText, "提供停車位。");
  assert.equal(composerFailureDiagnostics.at(-1).stage, "final_decision");
  assert.equal(composerFailureDiagnostics.at(-1).reasonCode, "composer_exception");

  const clarification = await runEngine({
    classify: async () => plannerOutput({
      tasks: [{
        ...task("availability", "availability", ""),
        sourceText: "有雙人房嗎",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.99 }
      }]
    })
  });
  assert.equal(clarification.result.finalDecision.type, "clarification", JSON.stringify(clarification.result.finalDecision));
  assert.equal(clarification.result.finalDecision.reasonCode, "clarification_task_results");
  assert.deepEqual(clarification.result.finalDecision.clarificationFields, ["stay.checkIn"]);
  assert.match(clarification.result.replyText, /入住/);

  const handoff = await runEngine({
    classify: async () => plannerOutput({
      tasks: [task("unknown", "unknown", "未核准的問題")]
    })
  });
  assert.equal(handoff.result.finalDecision.type, "human_handoff");
  assert.equal(handoff.result.finalDecision.reasonCode, "human_handoff_task_results");
  assert.equal(handoff.result.finalDecision.handoffReason, "unknown");
  assert.match(handoff.result.replyText, /業者確認/);

  const invalid = await runEngine({ classify: async () => null });
  assert.equal(invalid.result.finalDecision.type, "human_handoff");
  assert.equal(invalid.result.finalDecision.reasonCode, "planner_empty_output");
  assert.equal(invalid.result.finalDecision.shouldReply, true);

  const runtime = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8").split("/* legacy runtime kept below")[0];
  assert.equal((runtime.match(/result\.finalDecision/g) || []).length >= 2, true);
  assert.doesNotMatch(runtime, /if\s*\(\s*!result\.shouldReply\s*\|\|\s*!result\.replyText/, "registered V2 transports must not decide from a legacy boolean");

  console.log("final decision contract: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
