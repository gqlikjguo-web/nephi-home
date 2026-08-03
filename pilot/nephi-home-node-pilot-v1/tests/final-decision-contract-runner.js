"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../lib/conversation-engine-v2/final-response-renderer");

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

function plannerOutput({ shouldIgnore = false, tasks = [], sourceEvent = {} } = {}) {
  const stay = {
    dateExpression: { rawText: "", kind: "none", anchor: "none" },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: null
  };
  const sourceText = String(sourceEvent.messageText || "test");
  const normalizedTasks = tasks.map((item) => ({
    ...item,
    stayCandidate: item.dependsOnStayContext ? { ...stay } : null
  }));
  return {
    schemaVersion: 2,
    discourse: { relation: shouldIgnore ? "acknowledgement" : "new_request", confidence: 0.99 },
    stateOperations: [],
    stay,
    tasks: normalizedTasks,
    contextRelationCandidates: normalizedTasks.map((item) => ({
      candidateIndex: item.candidateIndex,
      kind: shouldIgnore ? "relation_uncertain" : "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{ eventId: String(sourceEvent.eventId || "event-0"), messageRef: String(sourceEvent.messageRef || ""), startOffset: 0, endOffset: sourceText.length, quote: sourceText }]
    })),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: shouldIgnore ? "acknowledgement" : "test"
  };
}

function task(taskId, type, rawText, canonicalCandidate = null) {
  return {
    candidateIndex: 0,
    taskId,
    type,
    sourceText: rawText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: type === "amenity" ? "amenity" : "other", rawText, canonicalCandidate, confidence: 0.99 },
    stayCandidate: null,
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

async function runEngine(planner, { composer = null, diagnostics = [], messageText = "test" } = {}) {
  const persistence = memory();
  const availabilityCalls = [];
  const availableDatesCalls = [];
  const engine = new ConversationEngineV2({
    planner,
    composer,
    persistence,
    getProperty: () => property,
    availabilityResolver: (query) => { availabilityCalls.push(query); return { availabilityReliable: true, rooms: [] }; },
    availableDatesResolver: (query) => { availableDatesCalls.push(query); return { status: "answered", dates: [], source: "test" }; },
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
    messageText
  });
  return { result, persistence, availabilityCalls, availableDatesCalls };
}

async function main() {
  const noReplyDecision = buildFinalDecision({ noReplyReason: "acknowledgement" });
  const noReplyResponse = buildFinalResponse({ finalDecision: noReplyDecision, responsePlan: { sections: [] } });
  assert.equal(noReplyDecision.action, "no_reply");
  assert.equal(noReplyResponse.shouldReply, false);
  const clarificationDecision = buildFinalDecision({ executionOutcomes: [{ taskId: "availability", type: "availability", outcome: "not_ready", readinessStatus: "missing_information", missingFields: ["checkIn"] }] });
  const clarificationResponse = buildFinalResponse({ finalDecision: clarificationDecision, responsePlan: { sections: [] } });
  assert.equal(clarificationDecision.action, "clarification");
  assert.equal(clarificationResponse.shouldReply, true);
  const independentPlan = buildResponsePlan({ propertyId: property.propertyId, inputTaskIds: [] });
  assert.equal(independentPlan.schemaVersion, 1, "ResponsePlan must remain independent of FinalDecision authority");
  assert.deepEqual(independentPlan.sections, []);

  const noReplyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    finalDecision: decision("no_reply", [])
  });
  assert.equal(noReplyPlan.schemaVersion, 1);
  assert.deepEqual(noReplyPlan.sections, [], "no_reply is decided by FinalDecision and rendered by FinalResponse, not ResponsePlan");

  const approvedReply = {
    taskId: "reply",
    type: "amenity",
    status: "answered",
    facts: { subject: "停車", answer: "提供停車位。" }
  };
  const replyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["reply", "coverage-gap"],
    taskResults: [approvedReply],
    finalDecision: decision("reply", [approvedReply], { sectionModes: { reply: "answer" } })
  });
  assert.equal(replyPlan.schemaVersion, 1);
  assert.equal(replyPlan.sections.length, 2, "Response Plan must preserve explicit coverage for every input task");
  assert.equal(replyPlan.sections[0].responseMode, "answer");
  assert.equal(replyPlan.coverageValidation.ok, true);
  assert.match(composeControlledReply(replyPlan), /提供停車位。/);
  assert.match(composeControlledReply(replyPlan), /業者確認/);

  const clarificationResult = {
    taskId: "clarify",
    type: "availability",
    status: "needs_clarification",
    facts: {},
    question: "請提供入住日期。",
    missingInputs: ["stay.checkIn"]
  };
  const clarificationPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["clarify"],
    taskResults: [clarificationResult],
    finalDecision: decision("clarification", [clarificationResult], {
      clarificationFields: ["stay.checkIn"],
      sectionModes: { clarify: "clarification" }
    })
  });
  assert.equal(clarificationPlan.schemaVersion, 1);
  assert.equal(clarificationPlan.sections[0].responseMode, "clarification");
  assert.deepEqual(clarificationPlan.sections[0].missingInputs, ["stay.checkIn"]);
  assert.equal(composeControlledReply(clarificationPlan), "請提供入住日期。");

  const unapprovedClarification = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["clarify"],
    taskResults: [{ ...clarificationResult, missingInputs: ["stay.guests"] }],
    finalDecision: decision("clarification", [{ ...clarificationResult, missingInputs: ["stay.guests"] }], {
      clarificationFields: ["stay.checkIn"],
      sectionModes: { clarify: "clarification" }
    })
  });
  assert.equal(unapprovedClarification.sections[0].responseMode, "clarification");
  assert.deepEqual(unapprovedClarification.sections[0].missingInputs, ["stay.guests"]);

  const handoffPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["handoff"],
    taskResults: [{ taskId: "handoff", type: "unknown", status: "needs_human", facts: { subject: "接送安排" }, review: true }],
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
  assert.equal(handoffPlan.schemaVersion, 1);
  assert.equal(handoffPlan.sections[0].responseMode, "handoff");
  assert.equal(composeControlledReply(handoffPlan), "接送安排這部分需要請業者確認。");

  const emptyReplyPlan = buildResponsePlan({
    propertyId: property.propertyId,
    inputTaskIds: ["empty"],
    taskResults: [{ taskId: "empty", type: "amenity", status: "answered", facts: {} }],
    finalDecision: decision("reply", [{ taskId: "empty", type: "amenity", status: "answered", facts: {} }], {
      sectionModes: { empty: "answer" }
    })
  });
  assert.equal(emptyReplyPlan.schemaVersion, 1);
  assert.equal(composeControlledReply(emptyReplyPlan), "這部分需要請業者確認。", "missing approved facts must use the controlled per-section fallback");

  let composerCalls = 0;
  const noReplyDiagnostics = [];
  const ignored = await runEngine({
    classify: async ({ sourceEvents }) => plannerOutput({
      shouldIgnore: true,
      tasks: [task("ack", "unknown", "好的，謝謝")],
      sourceEvent: sourceEvents[0]
    })
  }, {
    composer: { compose: async () => { composerCalls += 1; return { sections: [] }; } },
    diagnostics: noReplyDiagnostics,
    messageText: "好的，謝謝"
  });
  assert.equal(ignored.result.finalDecision.action, "no_reply", JSON.stringify(ignored.result));
  assert.equal(ignored.result.finalResponse.shouldReply, false);
  assert.equal(ignored.result.finalResponse.replyText, "");
  assert.equal(ignored.result.reviewCount, 0);
  assert.equal(composerCalls, 0);
  assert.equal(noReplyDiagnostics.some((item) => item.stage === "query_plan"), false);
  assert.equal(noReplyDiagnostics.some((item) => item.stage === "executor"), false);
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
  assert.equal(composerFailure.result.finalDecision.action, "reply");
  assert.equal(composerFailure.result.finalDecision.reasonCode, "execution_answered", "Composer failures must not rewrite FinalDecision authority");
  assert.equal(composerFailure.result.replyText, "提供停車位。");
  assert.equal(composerFailureDiagnostics.at(-1).stage, "final_decision");
  assert.equal(composerFailureDiagnostics.at(-1).reasonCode, "execution_answered");

  const clarificationDiagnostics = [];
  const clarification = await runEngine({
    classify: async ({ sourceEvents }) => plannerOutput({
      tasks: [{
        ...task("availability", "availability", "房況"),
        sourceText: "有雙人房嗎",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.99 }
      }],
      sourceEvent: sourceEvents[0]
    })
  }, { diagnostics: clarificationDiagnostics, messageText: "有雙人房嗎" });
  assert.equal(clarification.result.finalDecision.action, "clarification", JSON.stringify(clarification.result.finalDecision));
  assert.deepEqual(clarification.result.finalDecision.missingFields, ["checkIn", "checkOut"]);
  assert.equal(clarification.result.finalResponse.shouldReply, true);
  assert.match(clarification.result.finalResponse.replyText, /入住日期/);
  assert.equal(clarification.result.reviewCount, 0);
  assert.equal(clarification.availabilityCalls.length, 0);
  assert.equal(clarification.availableDatesCalls.length, 0);

  const invalidSchemaDiagnostics = [];
  const invalidSchema = await runEngine({
    classify: async ({ sourceEvents }) => {
      const output = plannerOutput({
        tasks: [task("invalid-schema", "availability", "有房嗎")],
        sourceEvent: sourceEvents[0]
      });
      output.tasks[0] = { ...output.tasks[0], dependsOnStayContext: true, stayCandidate: { ...output.stay } };
      output.contextRelationCandidates[0] = { ...output.contextRelationCandidates[0], kind: "acknowledgement" };
      return output;
    }
  }, { diagnostics: invalidSchemaDiagnostics, messageText: "有房嗎" });
  assert.equal(invalidSchema.result.finalDecision.action, "handoff");
  assert.equal(invalidSchema.result.finalDecision.reasonCode, "planner_schema_invalid");
  assert.equal(invalidSchema.result.finalDecision.reviewRequired, true);
  assert.equal(invalidSchema.availabilityCalls.length, 0);
  assert.equal(invalidSchema.availableDatesCalls.length, 0);
  assert.equal(invalidSchemaDiagnostics.some((item) => item.stage === "query_plan"), false);

  const handoff = await runEngine({
    classify: async () => plannerOutput({
      tasks: [task("unknown", "unknown", "未核准的問題")]
    })
  });
  assert.equal(handoff.result.finalDecision.action, "handoff");
  assert.equal(handoff.result.finalDecision.reasonCode, "unknown");
  assert.equal(handoff.result.finalDecision.reviewRequired, true);
  assert.match(handoff.result.replyText, /業者確認/);

  const invalid = await runEngine({ classify: async () => null });
  assert.equal(invalid.result.finalDecision.action, "handoff");
  assert.equal(invalid.result.finalDecision.reasonCode, "planner_output_unusable");
  assert.equal(invalid.result.finalResponse.shouldReply, true);

  const runtime = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  assert.equal((runtime.match(/result\.finalDecision/g) || []).length >= 2, true);
  assert.doesNotMatch(runtime, /result\.shouldReply/, "active LINE transports must not use the legacy top-level shouldReply boolean");
  assert.doesNotMatch(runtime, /result\.replyText/, "active LINE transports must not use the legacy top-level replyText");
  assert.doesNotMatch(runtime, /finalDecision\s*&&\s*result\.finalDecision\.shouldReply/, "active LINE transports must not read shouldReply from FinalDecision");
  assert.equal((runtime.match(/result\.finalResponse\s*&&\s*result\.finalResponse\.shouldReply/g) || []).length, 1, "the sole shared LINE transport must gate only on FinalResponse.shouldReply");
  assert.equal((runtime.match(/result\.finalResponse\s*&&\s*result\.finalResponse\.replyText/g) || []).length, 1, "the sole shared LINE transport must send only FinalResponse.replyText");
  const coordinatorSource = fs.readFileSync(path.resolve(__dirname, "../lib/conversation-engine-v2/coordinator.js"), "utf8");
  assert.doesNotMatch(coordinatorSource, /finalDecision\s*&&\s*result\.finalDecision\.shouldReply/, "Coordinator must not read transport authority from FinalDecision");
  assert.doesNotMatch(coordinatorSource, /result\.shouldReply/, "Coordinator must not fall back to the legacy top-level boolean");
  assert.match(coordinatorSource, /finalResponse\s*&&\s*result\.finalResponse\.shouldReply/, "Coordinator must use the rendered FinalResponse transport authority");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "final-decision-health-"));
  const providers = createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json") });
  const app = createApp({
    providers,
    deploymentCommit: "0123456789abcdef",
    adminAuthRequired: false
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const response = await fetch(`${running.url}/api/health`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.data.status, "ready");
    assert.equal(health.data.testOnly, true);
    assert.equal(health.data.commit, "0123456789abcdef");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log("final decision contract: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
