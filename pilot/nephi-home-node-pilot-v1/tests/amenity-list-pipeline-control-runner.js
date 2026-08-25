"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const message = "What facilities are available?";
const eventId = "amenity-list-control";
const plannerOutput = migrateFakePlannerOutput({
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 1 },
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
    taskId: "all-facilities",
    type: "amenity_list",
    sourceText: message,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: "other", rawText: "facilities", canonicalCandidate: null, confidence: 1 },
    stayCandidate: null,
    confidence: 1
  }],
  contextRelationCandidates: [{
    candidateIndex: 0,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{ eventId, messageRef: "", startOffset: 0, endOffset: message.length, quote: message }]
  }],
  ambiguities: [],
  missingInformation: [],
  needsHuman: false,
  shouldIgnore: false,
  reason: "broad facilities request"
});

const property = {
  propertyId: "property-control",
  displayName: "Control Property",
  timezone: "Asia/Taipei",
  rooms: [],
  commonAnswers: {},
  propertyFacts: [
    { canonicalId: "facility-alpha", category: "amenity", publicName: "Facility Alpha", status: "provided", publicText: "Facility Alpha is provided.", aliases: [] },
    { canonicalId: "facility-beta", category: "amenity", publicName: "Facility Beta", status: "provided", publicText: "Facility Beta is provided.", aliases: [] }
  ]
};

const diagnostics = [];
const engine = new ConversationEngineV2({
  planner: { classify: async () => plannerOutput },
  persistence: {
    getConversationState: () => null,
    setConversationState: () => {},
    appendMessageLog: () => ({ reviewId: "" })
  },
  getProperty: () => property,
  availabilityResolver: () => { throw new Error("amenity_list must not call availability"); },
  listPriceOverrides: () => [],
  onDiagnostic: (entry) => diagnostics.push(entry),
  diagnosticDetail: true
});

(async () => {
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "control",
    lineUserId: "anonymous-control",
    eventId,
    eventTimestamp: 1,
    messageText: message,
    sourceEvents: [{ eventId, messageRef: "", messageText: message }]
  });

  const stages = new Map(diagnostics.map((entry) => [entry.stage, entry]));
  assert.deepEqual(stages.get("planner").tasks.map((task) => task.type), ["amenity_list"]);
  assert.deepEqual(stages.get("semantic_contract").inputTasks.map((task) => task.type), ["amenity_list"]);
  assert.deepEqual(stages.get("semantic_contract").outputTasks.map((task) => task.type), ["amenity_list"]);
  assert.deepEqual(stages.get("canonical_request").items.map((item) => item.capability), ["amenity_list"]);
  assert.deepEqual(stages.get("query_plan").items.map((item) => item.capability), ["amenity_list"]);
  assert.equal(result.taskResults.length, 1);
  assert.equal(result.taskResults[0].type, "amenity_list");
  assert.deepEqual(result.taskResults[0].facts.amenities, ["Facility Alpha", "Facility Beta"]);
  assert.equal(stages.get("response_plan").sectionCount, 1);
  assert.match(result.replyText, /Facility Alpha、Facility Beta/);

  console.log("amenity_list pipeline control: PASS (one task through Resolver and one composed list)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
