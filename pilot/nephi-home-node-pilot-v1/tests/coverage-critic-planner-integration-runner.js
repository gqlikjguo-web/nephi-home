"use strict";

const assert = require("node:assert/strict");
const {
  TestOnlyOpenAiConversationPlanner,
  createTestOnlyOpenAiConversationPlannerFromEnv
} = require("../lib/providers/test-only-openai-conversation-planner");
const {
  TestOnlyOpenAiCoverageCritic
} = require("../lib/providers/test-only-openai-coverage-critic");
const {
  runWithTestOnlyAcceptanceRawUnderstanding
} = require("../lib/test-only-raw-understanding-diagnostic");

function exactRef(sourceEvent, quote) {
  const startOffset = sourceEvent.messageText.indexOf(quote);
  assert.notEqual(startOffset, -1, "fixture quote must be present in its source event");
  return {
    eventId: sourceEvent.eventId || "",
    messageRef: sourceEvent.messageRef || "",
    startOffset,
    endOffset: startOffset + quote.length,
    quote
  };
}

function task(candidateIndex, taskId, type, sourceText) {
  return {
    candidateIndex,
    taskId,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: "other", rawText: sourceText, canonicalCandidate: null, confidence: 1 },
    stayCandidate: null,
    confidence: 1
  };
}

function candidate(capability, coverageStatus, provenanceRelationCandidateIndexes, evidenceRefs) {
  return {
    semanticKind: "capability",
    capability,
    canonicalIdentityCandidate: capability,
    coverageStatus,
    provenanceRelationCandidateIndexes,
    evidenceRefs,
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  };
}

function plannerOutput({ sourceEvents, tasks, semanticCandidates, relations, discourse = "new_request", shouldIgnore = false }) {
  return {
    schemaVersion: 2,
    discourse: { relation: discourse, confidence: 1 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks,
    semanticCandidates,
    contextRelationCandidates: relations || tasks.map((item) => ({
      candidateIndex: item.candidateIndex,
      kind: discourse === "acknowledgement" ? "relation_uncertain" : "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [exactRef(sourceEvents[0], item.sourceText)]
    })),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: "coverage critic integration fixture"
  };
}

function response(output) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "req_coverage_integration" },
    text: async () => JSON.stringify({ output_text: JSON.stringify(output) })
  };
}

function input(sourceEvents, propertyId = "coverage-critic-property") {
  return {
    currentMessage: sourceEvents[sourceEvents.length - 1].messageText,
    currentMessages: sourceEvents.map((event) => event.messageText),
    sourceEvents,
    eventTimestamp: 1,
    catalog: {
      propertyId,
      displayName: "Coverage Critic Property",
      timezone: "Asia/Taipei",
      rooms: [], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: []
    },
    contextSnapshot: { scope: {}, cycles: [] }
  };
}

function createCritic(outputs, bodies) {
  let callIndex = 0;
  return new TestOnlyOpenAiCoverageCritic({
    apiKey: "critic-test-key",
    model: "critic-test-model",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      const value = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      if (value instanceof Error) throw value;
      return response(value);
    }
  });
}

function createPlanner({ primarySequence, criticSequence, repairFactory }) {
  const plannerBodies = [];
  const criticBodies = [];
  let plannerCalls = 0;
  const coverageCritic = createCritic(criticSequence, criticBodies);
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "planner-test-key",
    model: "planner-test-model",
    retryDelayMs: 0,
    coverageCritic,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      plannerBodies.push(body);
      const callIndex = plannerCalls;
      plannerCalls += 1;
      const configured = primarySequence[Math.min(callIndex, primarySequence.length - 1)];
      if (configured instanceof Error) throw configured;
      if (callIndex >= primarySequence.length && repairFactory) return response(repairFactory(body));
      return response(configured);
    }
  });
  return {
    planner,
    plannerBodies,
    criticBodies,
    plannerCalls: () => plannerCalls,
    totalCalls: () => plannerCalls + criticBodies.length
  };
}

function primaryFixture(sourceEvents, firstQuote) {
  return plannerOutput({
    sourceEvents,
    tasks: [task(0, "preserved-policy", "policy", firstQuote)],
    semanticCandidates: [candidate("policy", "bound", [0], [])]
  });
}

function repairForMissingTarget(sourceEvents, target, { valid = true } = {}) {
  const sourceText = valid ? target.quote : `${target.quote} changed`;
  const repairTask = task(0, "critic-repair-task", "human_help", sourceText);
  const {
    targetCandidateId: _targetCandidateId,
    ...targetEvidence
  } = target;
  const evidence = valid ? targetEvidence : exactRef(sourceEvents[0], sourceEvents[0].messageText);
  return {
    ...plannerOutput({
      sourceEvents,
      tasks: [repairTask],
      semanticCandidates: [candidate("human_help", "bound", [0], [])],
      relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [evidence] }]
    }),
    repairPatchTargets: [{ targetCandidateId: target.targetCandidateId, patchTaskId: repairTask.taskId }]
  };
}

function coverageRepairInput(body) {
  return JSON.parse(body.input[1].content[0].text).coverageRepair;
}

(async () => {
  const sourceEvent = {
    eventId: "coverage-event",
    messageRef: "coverage-message",
    messageText: "Please explain the house rules and I also need personal assistance."
  };
  const firstQuote = "explain the house rules";
  const missingQuote = "I also need personal assistance";
  const missingRef = exactRef(sourceEvent, missingQuote);
  const primary = primaryFixture([sourceEvent], firstQuote);

  const missingFlow = createPlanner({
    primarySequence: [primary],
    criticSequence: [{ missingRequests: [missingRef] }],
    repairFactory: (body) => {
      const repairInput = coverageRepairInput(body);
      assert.equal(repairInput.missingRequestTargets.length, 1);
      return repairForMissingTarget([sourceEvent], repairInput.missingRequestTargets[0]);
    }
  });
  const scoped = await runWithTestOnlyAcceptanceRawUnderstanding({ propertyId: "coverage-critic-property" }, () =>
    missingFlow.planner.classify(input([sourceEvent])));
  const missingResult = scoped.value;
  assert.equal(missingFlow.totalCalls(), 3, "Primary + Critic + one repair must use exactly three understanding calls");
  assert.equal(missingFlow.plannerCalls(), 2);
  assert.equal(missingResult.tasks.length, 2);
  const preservedTask = missingResult.tasks.find((item) => item.taskId === "preserved-policy");
  assert.ok(preservedTask, "valid sibling task must remain present");
  assert.equal(preservedTask.type, "policy");
  assert.equal(preservedTask.sourceText, firstQuote);
  const repairedTask = missingResult.tasks.find((item) => item.taskId === "critic-repair-task");
  assert.ok(repairedTask, "validated missing span must receive one repaired task");
  assert.equal(repairedTask.sourceText, missingQuote);
  assert.equal(missingResult.contextRelationCandidates.find((item) => item.candidateIndex === repairedTask.candidateIndex).evidenceRefs[0].quote, missingQuote);
  assert.equal(scoped.coverageCriticDiagnostics.length, 1);
  assert.equal(scoped.coverageCriticDiagnostics[0].callRole, "coverage_critic");
  assert.equal(scoped.coverageCriticDiagnostics[0].callNumber, 2);
  assert.equal(scoped.coverageCriticDiagnostics[0].resultStatus, "missing_detected");
  assert.equal(scoped.coverageCriticDiagnostics[0].validatedMissingSpanCount, 1);
  assert.equal(scoped.coverageCriticDiagnostics[0].repairTriggeredReason, "critic_missing_request");
  const missingRepairInput = coverageRepairInput(missingFlow.plannerBodies[1]);
  const missingRepairSchema = missingFlow.plannerBodies[1].text.format.schema;
  assert.equal(missingRepairSchema.properties.repairPatchTargets.minItems, 1);
  assert.deepEqual(
    missingRepairSchema.properties.repairPatchTargets.items.properties.targetCandidateId.enum,
    [missingRepairInput.missingRequestTargets[0].targetCandidateId],
    "repair schema must accept only the runtime-generated missing-span target"
  );

  const criticInput = JSON.parse(missingFlow.criticBodies[0].input[1].content[0].text);
  assert.deepEqual(Object.keys(criticInput).sort(), ["coveredRequests", "sourceEvents"]);
  assert.equal(criticInput.coveredRequests.length, 1);
  assert.equal(criticInput.coveredRequests[0].sourceText, firstQuote);
  assert.deepEqual(criticInput.coveredRequests[0].evidenceRefs, [exactRef(sourceEvent, firstQuote)]);
  assert.equal(JSON.stringify(criticInput).includes("Coverage Critic Property"), false);
  assert.equal(JSON.stringify(criticInput).includes("propertyId"), false);

  const completeFlow = createPlanner({
    primarySequence: [primary],
    criticSequence: [{ missingRequests: [] }]
  });
  const completeResult = await completeFlow.planner.classify(input([sourceEvent]));
  assert.equal(completeFlow.totalCalls(), 2, "Complete primary coverage must use exactly two understanding calls");
  assert.equal(completeResult.tasks.length, 1);
  assert.equal(completeResult.tasks[0].taskId, "preserved-policy");

  for (const identityMode of ["eventId", "messageRef"]) {
    const singleIdentityRef = {
      ...missingRef,
      eventId: identityMode === "eventId" ? missingRef.eventId : "",
      messageRef: identityMode === "messageRef" ? missingRef.messageRef : ""
    };
    const singleIdentityFlow = createPlanner({
      primarySequence: [primary],
      criticSequence: [{ missingRequests: [singleIdentityRef] }],
      repairFactory: (body) => repairForMissingTarget([sourceEvent], coverageRepairInput(body).missingRequestTargets[0])
    });
    const singleIdentityResult = await singleIdentityFlow.planner.classify(input([sourceEvent]));
    assert.equal(singleIdentityFlow.totalCalls(), 3, `${identityMode}-only source identity must be accepted by the exact OR contract`);
    assert.ok(singleIdentityResult.tasks.some((item) => item.taskId === "critic-repair-task"));
  }

  const duplicateFlow = createPlanner({
    primarySequence: [primary],
    criticSequence: [{ missingRequests: [missingRef, { ...missingRef }] }],
    repairFactory: (body) => {
      const repairInput = coverageRepairInput(body);
      assert.equal(repairInput.missingRequestTargets.length, 1, "exact duplicate spans must be deterministically deduplicated");
      return repairForMissingTarget([sourceEvent], repairInput.missingRequestTargets[0]);
    }
  });
  await duplicateFlow.planner.classify(input([sourceEvent]));
  assert.equal(duplicateFlow.totalCalls(), 3);

  const secondEvent = { eventId: "other-event", messageRef: "other-message", messageText: "Unrelated source." };
  const invalidSpanCases = [
    { name: "fake event identity", ref: { ...missingRef, eventId: "fake-event", messageRef: "" } },
    { name: "wrong quote", ref: { ...missingRef, quote: "not the source slice" } },
    { name: "wrong offset", ref: { ...missingRef, startOffset: missingRef.startOffset + 1 } },
    { name: "cross-event identity", ref: { ...missingRef, messageRef: secondEvent.messageRef } },
    { name: "ambiguous overlap with covered sibling", ref: { ...exactRef(sourceEvent, firstQuote), startOffset: exactRef(sourceEvent, firstQuote).startOffset + 1, quote: firstQuote.slice(1) } }
  ];
  for (const scenario of invalidSpanCases) {
    const flow = createPlanner({
      primarySequence: [primary],
      criticSequence: [{ missingRequests: [scenario.ref] }]
    });
    await assert.rejects(
      () => flow.planner.classify(input([sourceEvent, secondEvent])),
      (error) => error && error.code === "planner_local_contract_failure",
      scenario.name
    );
    assert.equal(flow.totalCalls(), 2, `${scenario.name} must fail closed without repair`);
  }

  const criticTimeout = new Error("critic timeout");
  criticTimeout.name = "AbortError";
  const criticFailureFlow = createPlanner({
    primarySequence: [primary],
    criticSequence: [criticTimeout]
  });
  await assert.rejects(
    () => criticFailureFlow.planner.classify(input([sourceEvent])),
    (error) => error && error.code === "planner_local_contract_failure"
  );
  assert.equal(criticFailureFlow.totalCalls(), 2, "Critic failure must not retry");

  const falsePositiveFlow = createPlanner({
    primarySequence: [primary],
    criticSequence: [{ missingRequests: [missingRef] }],
    repairFactory: (body) => repairForMissingTarget([sourceEvent], coverageRepairInput(body).missingRequestTargets[0], { valid: false })
  });
  await assert.rejects(
    () => falsePositiveFlow.planner.classify(input([sourceEvent])),
    (error) => error && error.code === "planner_local_contract_failure"
  );
  assert.equal(falsePositiveFlow.totalCalls(), 3, "Invalid false-positive repair must fail closed after the third call");

  const primaryNetworkError = new TypeError("primary network failure");
  const retryFlow = createPlanner({
    primarySequence: [primaryNetworkError, primary],
    criticSequence: [{ missingRequests: [missingRef] }]
  });
  await assert.rejects(
    () => retryFlow.planner.classify(input([sourceEvent])),
    (error) => error && error.code === "planner_local_contract_failure"
  );
  assert.equal(retryFlow.totalCalls(), 3, "Primary retry + Critic must consume the full budget without a fourth call");
  assert.equal(retryFlow.plannerCalls(), 2);

  const combinedEvent = {
    eventId: "combined-event",
    messageRef: "combined-message",
    messageText: "Explain the rules, connect me to staff, and record my separate request."
  };
  const combinedFirst = "Explain the rules";
  const pendingQuote = "connect me to staff";
  const criticQuote = "record my separate request";
  const combinedPrimary = plannerOutput({
    sourceEvents: [combinedEvent],
    tasks: [task(0, "combined-sibling", "policy", combinedFirst)],
    semanticCandidates: [
      candidate("policy", "bound", [0], []),
      candidate("human_help", "pending_task", [], [exactRef(combinedEvent, pendingQuote)])
    ]
  });
  let combinedRepairPayload = null;
  const combinedFlow = createPlanner({
    primarySequence: [combinedPrimary],
    criticSequence: [{ missingRequests: [exactRef(combinedEvent, criticQuote)] }],
    repairFactory: (body) => {
      const repairInput = coverageRepairInput(body);
      combinedRepairPayload = repairInput;
      const criticTarget = repairInput.missingRequestTargets[0];
      const pendingTask = task(0, "pending-repair-task", "human_help", pendingQuote);
      const criticTask = task(1, "critic-combined-task", "human_help", criticQuote);
      return {
        ...plannerOutput({
          sourceEvents: [combinedEvent],
          tasks: [pendingTask, criticTask],
          semanticCandidates: [
            candidate("human_help", "bound", [0], []),
            candidate("human_help", "bound", [1], [])
          ],
          relations: [
            { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [exactRef(combinedEvent, pendingQuote)] },
            { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [exactRef(combinedEvent, criticQuote)] }
          ]
        }),
        repairPatchTargets: [{ targetCandidateId: criticTarget.targetCandidateId, patchTaskId: criticTask.taskId }]
      };
    }
  });
  const combinedResult = await combinedFlow.planner.classify(input([combinedEvent]));
  assert.equal(combinedRepairPayload.missingSemanticCandidates.length, 1);
  assert.equal(combinedRepairPayload.missingRequestTargets.length, 1);
  assert.equal(combinedFlow.totalCalls(), 3, "Existing pending repair and Critic span must share one third call");
  assert.deepEqual(new Set(combinedResult.tasks.map((item) => item.taskId)), new Set(["combined-sibling", "pending-repair-task", "critic-combined-task"]));
  assert.equal(combinedResult.tasks.find((item) => item.taskId === "combined-sibling").sourceText, combinedFirst);

  const acknowledgementEvent = { eventId: "ack-event", messageRef: "ack-message", messageText: "\u{1F44D}" };
  const acknowledgement = plannerOutput({
    sourceEvents: [acknowledgementEvent],
    tasks: [task(0, "ack-placeholder", "unknown", "\u{1F44D}")],
    semanticCandidates: [candidate("unknown", "bound", [0], [])],
    discourse: "acknowledgement",
    shouldIgnore: true
  });
  const acknowledgementFlow = createPlanner({
    primarySequence: [acknowledgement],
    criticSequence: [{ missingRequests: [] }]
  });
  const acknowledgementResult = await acknowledgementFlow.planner.classify(input([acknowledgementEvent]));
  assert.equal(acknowledgementFlow.totalCalls(), 2);
  assert.equal(acknowledgementResult.shouldIgnore, true);
  assert.equal(acknowledgementResult.tasks.some((item) => !["unknown", "human_help"].includes(item.type)), false, "Critic must not create a business task for non-substantive input");

  const factoryBodies = [];
  const factoryPlanner = createTestOnlyOpenAiConversationPlannerFromEnv({
    env: { OPENAI_TEST_API_KEY: "factory-test-key", OPENAI_TEST_MODEL: "factory-test-model" },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      factoryBodies.push(body);
      return body.text.format.name === "junzan_coverage_critic_v1"
        ? response({ missingRequests: [] })
        : response(primary);
    }
  });
  const factoryResult = await factoryPlanner.classify(input([sourceEvent]));
  assert.equal(factoryResult.tasks.length, 1);
  assert.deepEqual(
    factoryBodies.map((body) => body.text.format.name),
    ["junzan_conversation_plan_v2", "junzan_coverage_critic_v1"],
    "environment factory must enable the independent Critic by default"
  );

  process.stdout.write("Coverage Critic Planner integration tests passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
