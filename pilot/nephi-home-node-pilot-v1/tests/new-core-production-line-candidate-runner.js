"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding, waitFor } = require("./helpers/property-scoped-line-webhook");

function unvalidatedCoreResult(args, action) {
  return {
    state: args.state,
    finalDecision: {
      action,
      reasonCode: `candidate_${action}`,
      taskIds: [],
      missingFields: [],
      reviewRequired: action === "handoff",
      executionSummary: {}
    },
    finalResponse: {
      action,
      shouldReply: action !== "no_reply",
      replyText: action === "no_reply" ? "" : `candidate ${action}`
    },
    traceId: `trace-${args.input.turnId}`,
    artifacts: {
      canonicalItems: [{ requestCycleId: `cycle-${args.input.turnId}` }],
      adapted: { taskCreations: [], canonicalTaskBindings: [] },
      executionOutcomes: []
    }
  };
}

const { finalizeTurnResponse } = require("../lib/new-core/application-service");
const { isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");
const generated = new Map();
function coreResult(args, action) {
  const taskId = `task-${args.input.turnId}`;
  const evidence = { taskId, requestPresence: action === "no_reply" ? "ABSENT" : "PRESENT",
    activeRequest: action !== "no_reply", replyPermission: "ALLOWED",
    humanActionRequired: action === "handoff", humanJudgmentRequired: false,
    resolverUnresolvedRequiresHuman: false, existingOperatorResponsibility: false };
  const task = { taskId, type: action === "handoff" ? "human_help" : "amenity",
    status: action === "handoff" ? "needs_human" : action === "clarification" ? "needs_clarification" : "answered",
    facts: action === "reply" ? { answer: "candidate reply", source: "property_catalog" } : {},
    ...(action === "clarification" ? { missingInputs: ["checkIn"] } : {}) };
  const execution = { taskId, type: task.type, facts: task.facts,
    outcome: action === "handoff" ? "unknown" : action === "clarification" ? "not_ready" : "answered",
    ...(action === "handoff" ? { reason: "human_help" } : {}),
    ...(action === "clarification" ? { missingFields: ["checkIn"] } : {}) };
  const executionOutcomes = action === "no_reply" ? [] : [execution];
  const result = finalizeTurnResponse({ scope: args.scope, turnId: args.input.turnId,
    property: args.property, responsePrefix: args.responsePrefix,
    requestEvidence: [evidence], executionOutcomes,
    taskResults: action === "no_reply" ? [] : [task] });
  generated.set(args.input.turnId, result);
  return { state: args.state, finalDecision: result.finalDecision, finalResponse: result.finalResponse,
    traceId: `trace-${args.input.turnId}`, artifacts: {
      ...result, requestEvidence: [evidence],
      canonicalItems: [{ requestCycleId: `cycle-${args.input.turnId}` }],
      adapted: { taskCreations: [], canonicalTaskBindings: [] }, executionOutcomes } };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "new-core-production-line-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "store.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    seedDays: 3,
    messageLogs: { property_a: [] },
    homestays: [{
      customerId: "property_a",
      name: "Property A",
      safeFacts: { parkingRule: "Parking A" },
      rooms: [{ id: "room-a", name: "Room A", type: "double", capacity: 2 }]
    }]
  }));
  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  const binding = attachPropertyScopedLineBinding({ providers, propertyId: "property_a" });
  const calls = [];
  const sends = [];
  const genericApp = createApp({
    providers,
    testOnlyEnvironment: false,
    runtimeEnv: {},
    lineBindingEnv: binding.lineBindingEnv
  });
  await genericApp.stop();
  assert.throws(() => createApp({
    providers,
    testOnlyEnvironment: false,
    enableProductionLineEngine: true,
    runtimeEnv: {},
    lineBindingEnv: binding.lineBindingEnv
  }), /provider_api_key_required/, "explicit production LINE composition must fail closed without an OpenAI key");
  const existingCredentialApp = createApp({
    providers,
    testOnlyEnvironment: false,
    enableProductionLineEngine: true,
    runtimeEnv: {
      OPENAI_TEST_API_KEY: crypto.randomBytes(24).toString("hex")
    },
    lineBindingEnv: binding.lineBindingEnv
  });
  await existingCredentialApp.stop();
  const app = createApp({
    providers,
    testOnlyEnvironment: false,
    enableProductionLineEngine: true,
    runtimeEnv: {
      OPENAI_API_KEY: crypto.randomBytes(24).toString("hex")
    },
    lineBindingEnv: binding.lineBindingEnv,
    conversationDebounceMs: 1,
    newCoreProductionExecuteTurn: async (args) => {
      calls.push(args);
      if (args.input.message === "explode") throw Object.assign(new Error("boom"), { code: "UNDERSTANDING_PROVIDER_FAILURE" });
      const action = args.input.message === "thanks" ? "no_reply"
        : args.input.message === "clarify" ? "clarification"
          : args.input.message === "handoff" ? "handoff" : "reply";
      if (args.input.message === "unvalidated") return unvalidatedCoreResult(args, action);
      const result = coreResult(args, action);
      if (args.input.message === "changed-after-validation") {
        return { ...result, finalResponse: { ...result.finalResponse, replyText: result.finalResponse.replyText + " changed" } };
      }
      if (args.input.message === "reuse-other-event") {
        return { ...result, finalResponse: generated.get("answer-event").finalResponse };
      }
      if (args.input.message === "reuse-other-property") {
        const foreign = coreResult({ ...args, scope: { ...args.scope, propertyId: "property_b" } }, action);
        return { ...result, finalResponse: foreign.finalResponse };
      }
      return result;
    },
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async (body) => { sends.push(body); return { httpResponse: { status: 200 } }; }
    })
  });
  const running = await app.start(0, "127.0.0.1");
  const record = (eventId) => providers.persistence.findMessageByEventId("property_a", eventId);
  const send = async (eventId, messageText) => {
    const payload = JSON.stringify({ events: [{
      type: "message",
      webhookEventId: eventId,
      replyToken: `reply-${eventId}`,
      timestamp: Date.parse("2026-09-03T03:00:00.000Z"),
      source: { type: "user", userId: "line-user-a" },
      message: { type: "text", id: `message-${eventId}`, text: messageText }
    }] });
    assert.equal((await binding.post(running.url, payload)).status, 200);
    await waitFor(() => record(eventId) && record(eventId).processingStatus !== "processing");
  };
  try {
    await send("answer-event", "answer");
    assert.equal(sends.length, 1);
    const answer = generated.get("answer-event");
    assert.equal(isValidatedFinalResponse(answer.finalResponse), true);
    assert.equal(answer.claimValidation.ok, true);
    assert.equal(sends[0].messages[0].text, answer.claimValidation.validatedText);
    assert.equal(record("answer-event").replyText, answer.claimValidation.validatedText);
    assert.equal(calls.length, 1, "one LINE event must invoke one new-core turn");
    assert.equal(calls[0].scope.propertyId, "property_a");
    assert.equal(calls[0].scope.channel.startsWith("line-binding:"), true);
    assert.equal(calls[0].scope.userId, "line-user-a");

    await send("clarify-event", "clarify");
    await send("handoff-event", "handoff");
    assert.equal(record("handoff-event").needsReview, true);
    assert.equal(record("handoff-event").humanHandoff, true);
    assert.deepEqual(record("handoff-event").requestCycleRefs, ["cycle-handoff-event"]);

    const beforeNoReply = sends.length;
    await send("no-reply-event", "thanks");
    assert.equal(sends.length, beforeNoReply, "NO_REPLY must not invoke LINE transport");
    assert.equal(record("no-reply-event").processingStatus, "no_reply");

    await send("exception-event", "explode");
    assert.equal(record("exception-event").needsReview, false);
    assert.equal(record("exception-event").humanHandoff, false);
    assert.equal(record("exception-event").processingStatus, "reply_succeeded");

    for (const eventId of ["answer-event", "clarify-event", "handoff-event", "no-reply-event", "exception-event"]) {
      const persisted = record(eventId);
      assert.ok(Array.isArray(persisted.safeTrace) && persisted.safeTrace.length > 0,
        `${eventId} must persist a production-safe new-core trace`);
      const traceIds = new Set(persisted.safeTrace.map((entry) => entry.traceId).filter(Boolean));
      assert.equal(traceIds.size, 1, `${eventId} must use one traceId for every persisted stage`);
      assert.ok(persisted.safeTrace.some((entry) => entry.stage === "line_inbound"));
      assert.ok(persisted.safeTrace.some((entry) => entry.stage === "state_before"));
      assert.ok(persisted.safeTrace.some((entry) => entry.stage === "new_core_final"
        || entry.stage === "new_core_failure"));
      assert.ok(persisted.safeTrace.some((entry) => entry.stage === "line_transport"));
      assert.equal(JSON.stringify(persisted.safeTrace).includes("line-user-a"), false);
      assert.equal(JSON.stringify(persisted.safeTrace).includes("Bearer "), false);
    }
    assert.equal(record("answer-event").replyText, "【AI】candidate reply",
      "the exact FinalResponse text must use the existing message-log replyText field");
    assert.ok(record("answer-event").safeTrace.some((entry) => entry.stage === "new_core_final"
      && entry.finalResponse && entry.finalResponse.replyText === "【AI】candidate reply"),
    "the bounded production trace must retain the redacted FinalResponse text");
    assert.ok(record("answer-event").safeTrace.some((entry) => entry.stage === "line_transport"
      && entry.replyText === "【AI】candidate reply" && entry.delivered === true),
    "the same trace must retain the redacted text actually delivered to LINE");
    assert.equal(record("no-reply-event").replyText, "",
      "a genuine NO_REPLY must persist an empty FinalResponse body");

    const updateMessageEvent = providers.persistence.updateMessageEvent.bind(providers.persistence);
    providers.persistence.updateMessageEvent = (...args) => {
      if (args[3] && Object.hasOwn(args[3], "safeTrace")) throw Object.assign(new Error("trace write failed"), { code: "TRACE_WRITE_FAILED" });
      return updateMessageEvent(...args);
    };
    const sendsBeforeTraceFailure = sends.length;
    await send("trace-failure-event", "answer");
    assert.equal(sends.length, sendsBeforeTraceFailure + 1,
      "trace persistence failure must not prevent the formal LINE reply");
    assert.equal(record("trace-failure-event").processingStatus, "reply_succeeded");
    providers.persistence.updateMessageEvent = updateMessageEvent;

    const duplicatePayload = JSON.stringify({ events: [{
      type: "message", webhookEventId: "answer-event", replyToken: "duplicate-token",
      timestamp: Date.now(), source: { type: "user", userId: "line-user-a" },
      message: { type: "text", id: "duplicate-message", text: "answer" }
    }] });
    const beforeDuplicate = sends.length;
    assert.equal((await binding.post(running.url, duplicatePayload)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sends.length, beforeDuplicate, "a claimed LINE event must never send twice");

    assert.ok(providers.persistence.getConversationState("property_a", calls[0].scope.channel, "line-user-a"));
    // These responses deliberately violate the delivery Contract; the real validator is never mocked.
    for (const [eventId, message] of [
      ["unvalidated-event", "unvalidated"],
      ["changed-event", "changed-after-validation"],
      ["cross-property", "reuse-other-property"],
      ["cross-event", "reuse-other-event"]
    ]) {
      const before = sends.length;
      await send(eventId, message);
      const proof = { eventId, deliveredCount: sends.length - before,
        persisted: record(eventId), validatedOriginTurn: generated.get("answer-event").claimValidation.turnId,
        sentTexts: sends.slice(before).map(body => body.messages[0].text) };
      console.log("DELIVERY_NEGATIVE_EVIDENCE " + JSON.stringify(proof));
      assert.equal(sends.length, before, `${eventId}: invalid delivery must send zero messages`);
      assert.equal(record(eventId).processingStatus, "final_response_contract_failed");
    }
    process.stdout.write("new-core production LINE candidate: original controls and delivery Contract controls PASS\n");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
