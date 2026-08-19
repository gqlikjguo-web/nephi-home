"use strict";

const assert = require("node:assert/strict");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { compileSemanticCandidates } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { validateUnderstandingContext, validateHistoricalUserEvidence } = require("../lib/conversation-engine-v2/understanding-validator");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildCanonicalFormalRequest } = require("../lib/conversation-engine-v2/formal-request");
const {
  createConversationStateV3,
  createConversationTaskV3
} = require("../lib/conversation-contracts/conversation-state-v3");
const {
  buildContextSnapshotV3,
  decideContextExecutionV3,
  executionConditionsV3
} = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");

const NOW = "2026-08-20T08:00:00.000Z";
const property = {
  propertyId: "property-context",
  displayName: "Context Test",
  timezone: "Asia/Taipei",
  currency: "TWD",
  rooms: [{
    id: "bundle-all",
    name: "包棟",
    type: "包棟",
    inventoryType: "bundle",
    memberRoomIds: [],
    capacity: 12,
    enabled: true,
    mondayThursdayPrice: 18000,
    fridayPrice: 18000,
    saturdayHolidayPrice: 18000,
    sundayPrice: 18000
  }],
  semanticCatalog: { aliases: { "bundle-all": ["包棟"] }, amenities: [] }
};
const catalog = buildPropertyCatalog(property);

function evidence(eventId, messageRef, messageText, quote) {
  const startOffset = messageText.indexOf(quote);
  return { eventId, messageRef, startOffset, endOffset: startOffset + quote.length, quote };
}

function historyTurn({ eventId, messageRef, guestMessage, createdAt, cycleId }) {
  return {
    eventId,
    messageRef,
    guestMessage,
    replyText: "",
    createdAt,
    requestCycleRefs: [cycleId],
    propertyId: "property-context",
    channelId: "line:test",
    lineUserId: "user:test"
  };
}

function activeState(cycleId) {
  return createConversationStateV3({
    propertyId: "property-context",
    channel: "line:test",
    userId: "user:test",
    tasks: [createConversationTaskV3({
      taskId: cycleId,
      taskType: "pricing",
      productType: "bundle",
      productId: "bundle-all",
      roomTypeId: null,
      bundleId: "bundle-all",
      checkIn: "2026-09-05",
      checkOut: "2026-09-06",
      guestCount: null,
      searchFrom: null,
      searchTo: null,
      entityId: "bundle-all",
      entityCategory: "bundle",
      detailIntent: "general",
      knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"],
      missingFields: [],
      status: "answered",
      createdAt: "2026-08-20T07:00:00.000Z",
      updatedAt: "2026-08-20T07:10:00.000Z",
      expiresAt: "2026-08-21T07:10:00.000Z"
    })],
    createdAt: "2026-08-20T07:00:00.000Z",
    updatedAt: "2026-08-20T07:10:00.000Z",
    expiresAt: "2026-08-21T07:10:00.000Z"
  });
}

function rawPlan({ capability, currentMessage, productTurn, dateTurn }) {
  const currentEvidence = evidence("current-event", "current-message", currentMessage, currentMessage);
  const productEvidence = evidence(productTurn.eventId, productTurn.messageRef, productTurn.guestMessage, "包棟");
  const dateEvidence = evidence(dateTurn.eventId, dateTurn.messageRef, dateTurn.guestMessage, "9/5");
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "9/5", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-09-05", checkOutCandidate: "2026-09-06", nightsCandidate: 1, guestCountCandidate: null },
    tasks: [{
      candidateIndex: 0,
      taskId: `historical-${capability}`,
      type: capability,
      sourceText: currentMessage,
      detailIntent: "general",
      requestedOutputs: [capability === "price" ? "price" : "availability"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "包棟", canonicalCandidate: "bundle-all", confidence: 0.99 },
      stayCandidate: { dateExpression: { rawText: "9/5", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-09-05", checkOutCandidate: "2026-09-06", nightsCandidate: 1, guestCountCandidate: null },
      confidence: 0.99
    }],
    semanticCandidates: [{
      semanticKind: "capability",
      capability,
      canonicalIdentityCandidate: capability,
      coverageStatus: "bound",
      provenanceRelationCandidateIndexes: [0],
      evidenceRefs: [],
      lodgingScopeCandidate: { bundleCanonicalCandidate: "bundle-all", roomCanonicalCandidates: [], guestCountCandidate: null },
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: null
    }, {
      semanticKind: "temporal_pattern",
      capability,
      canonicalIdentityCandidate: null,
      coverageStatus: "bound",
      provenanceRelationCandidateIndexes: [0],
      evidenceRefs: [dateEvidence],
      lodgingScopeCandidate: { bundleCanonicalCandidate: "bundle-all", roomCanonicalCandidates: [], guestCountCandidate: null },
      temporalSemanticCandidate: { rawText: "9/5", kind: "absolute", anchor: "message_time" },
      propertyCatalogIdentity: null
    }, {
      semanticKind: "lodging_scope",
      capability,
      canonicalIdentityCandidate: "bundle-all",
      coverageStatus: "bound",
      provenanceRelationCandidateIndexes: [0],
      evidenceRefs: [productEvidence],
      lodgingScopeCandidate: { bundleCanonicalCandidate: "bundle-all", roomCanonicalCandidates: [], guestCountCandidate: null },
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: "bundle-all"
    }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [currentEvidence] }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "standalone historical semantic request"
  };
}

function runCase({ capability, currentMessage, turns, mutatePlan = null }) {
  const cycleId = `cycle-${capability}`;
  const recentConversation = turns.map((turn) => historyTurn({ ...turn, cycleId }));
  const state = activeState(cycleId);
  const scope = { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test", now: NOW };
  const contextSnapshot = buildContextSnapshotV3(state, scope);
  const sourceEvents = [{ eventId: "current-event", messageRef: "current-message", messageText: currentMessage }];
  let raw = rawPlan({ capability, currentMessage, productTurn: recentConversation[0], dateTurn: recentConversation.at(-1) });
  if (mutatePlan) raw = mutatePlan(raw);
  let output = compileSemanticCandidates(raw, { catalog, sourceEvents, recentConversation, contextSnapshot, scope });
  output = applyPlannerSemanticContract(output, { catalog, sourceEvents });
  const context = validateUnderstandingContext(output, contextSnapshot, { sourceEvents, scope });
  assert.equal(context.ok, true);
  const execution = decideContextExecutionV3({ state, relations: context.relations, plannerTasks: output.tasks, catalog, now: NOW });
  const item = execution.executionItems[0];
  const canonical = canonicalizeExecutionItem({
    item,
    relation: execution.relations.find((relation) => relation.candidateIndex === item.candidateIndex),
    contextSnapshot,
    catalog,
    guestMessage: currentMessage,
    eventTimestamp: NOW,
    recentConversation,
    semanticCandidates: output.semanticCandidates,
    scope
  });
  const conditions = executionConditionsV3(state, canonical);
  const formal = buildCanonicalFormalRequest({ property, canonicalRequest: canonical.canonicalRequest, candidateIndex: item.candidateIndex, requestCycleId: item.requestCycleId, confirmedInputs: conditions });
  return { output, canonical, formal };
}

const a = runCase({
  capability: "price",
  currentMessage: "費用多少",
  turns: [
    { eventId: "a-product", messageRef: "a-product-message", guestMessage: "包棟多少錢", createdAt: "2026-08-20T07:00:00.000Z" },
    { eventId: "a-date", messageRef: "a-date-message", guestMessage: "9/5", createdAt: "2026-08-20T07:10:00.000Z" }
  ]
});
assert.equal(a.formal.capability, "price");
assert.equal(a.formal.stay.checkIn, "2026-09-05");
assert.equal(a.formal.stay.checkOut, "2026-09-06");
assert.equal(a.formal.inventory.mode, "bundle_only");
assert.equal(a.formal.inventory.entityId, "bundle-all");
assert.equal(a.formal.readiness.status, "ready");

const b = runCase({
  capability: "availability",
  currentMessage: "還能預訂嗎？",
  turns: [{ eventId: "b-stay", messageRef: "b-stay-message", guestMessage: "9/5 包棟多少錢", createdAt: "2026-08-20T07:00:00.000Z" }]
});
assert.equal(b.output.tasks[0].type, "availability");
assert.equal(b.formal.capability, "bundle_availability");
assert.equal(b.formal.stay.checkIn, "2026-09-05");
assert.equal(b.formal.stay.checkOut, "2026-09-06");
assert.equal(b.formal.inventory.mode, "bundle_only");
assert.equal(b.formal.inventory.entityId, "bundle-all");
assert.equal(b.formal.readiness.status, "ready");

const explicitDate = runCase({
  capability: "availability",
  currentMessage: "9/7 還能預訂嗎？",
  turns: [{ eventId: "explicit-old", messageRef: "explicit-old-message", guestMessage: "9/5 包棟多少錢", createdAt: "2026-08-20T07:00:00.000Z" }],
  mutatePlan: (raw) => ({
    ...raw,
    stay: { ...raw.stay, dateExpression: { rawText: "9/7", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-09-07", checkOutCandidate: "2026-09-08" },
    tasks: raw.tasks.map((task) => ({ ...task, stayCandidate: { ...task.stayCandidate, dateExpression: { rawText: "9/7", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-09-07", checkOutCandidate: "2026-09-08" } }))
  })
});
assert.equal(explicitDate.formal.stay.checkIn, "2026-09-07", "a current explicit date must override grounded history");

const pastDate = runCase({
  capability: "availability",
  currentMessage: "昨天還能預訂嗎？",
  turns: [{ eventId: "past-old", messageRef: "past-old-message", guestMessage: "9/5 包棟多少錢", createdAt: "2026-08-20T07:00:00.000Z" }],
  mutatePlan: (raw) => ({
    ...raw,
    stay: { ...raw.stay, dateExpression: { rawText: "昨天", kind: "relative", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null },
    tasks: raw.tasks.map((task) => ({ ...task, stayCandidate: { ...task.stayCandidate, dateExpression: { rawText: "昨天", kind: "relative", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null } }))
  })
});
assert.notEqual(pastDate.formal.readiness.status, "ready", "an invalid or past current date must never fall back to grounded history");
assert.notEqual(pastDate.canonical.canonicalRequest.temporalState.repairReasonCode, "");
assert.notEqual(pastDate.formal.stay.checkIn, "2026-09-05");

const negativeCycle = activeState("negative-cycle");
const negativeSnapshot = buildContextSnapshotV3(negativeCycle, { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test", now: NOW });
const negativeTurn = historyTurn({ eventId: "negative-history", messageRef: "negative-history-message", guestMessage: "9/5 包棟多少錢", createdAt: "2026-08-20T07:00:00.000Z", cycleId: "negative-cycle" });
const negativeEvidence = [evidence("negative-history", "negative-history-message", negativeTurn.guestMessage, "9/5")];
assert.equal(validateHistoricalUserEvidence(negativeEvidence, {
  recentConversation: [negativeTurn], contextSnapshot: negativeSnapshot,
  scope: { propertyId: "other-property", channelId: "line:test", lineUserId: "user:test" }
}).ok, false, "cross-property history must fail closed");
for (const scopeOverride of [{ channelId: "other-channel" }, { lineUserId: "other-user" }]) {
  assert.equal(validateHistoricalUserEvidence(negativeEvidence, {
    recentConversation: [negativeTurn], contextSnapshot: negativeSnapshot,
    scope: { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test", ...scopeOverride }
  }).ok, false, "cross-channel and cross-user history must fail closed");
}
assert.equal(validateHistoricalUserEvidence([{ ...negativeEvidence[0], quote: "assistant reply" }], {
  recentConversation: [{ ...negativeTurn, replyText: "assistant reply" }], contextSnapshot: negativeSnapshot,
  scope: { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test" }
}).ok, false, "assistant replies must never become historical evidence");
assert.equal(validateHistoricalUserEvidence(negativeEvidence, {
  recentConversation: [{ ...negativeTurn, requestCycleRefs: ["negative-cycle", "second-cycle"] }],
  contextSnapshot: { ...negativeSnapshot, cycles: [...negativeSnapshot.cycles, { ...negativeSnapshot.cycles[0], requestCycleId: "second-cycle" }] },
  scope: { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test" }
}).ok, false, "multi-cycle historical evidence must fail closed");
for (const status of ["ended", "expired"]) {
  assert.equal(validateHistoricalUserEvidence(negativeEvidence, {
    recentConversation: [negativeTurn],
    contextSnapshot: { ...negativeSnapshot, cycles: [{ ...negativeSnapshot.cycles[0], status }] },
    scope: { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test" }
  }).ok, false, `${status} cycles must never ground historical evidence`);
}
assert.equal(validateHistoricalUserEvidence(negativeEvidence, {
  recentConversation: [{ ...negativeTurn, createdAt: "2026-08-18T07:00:00.000Z" }], contextSnapshot: negativeSnapshot,
  scope: { propertyId: "property-context", channelId: "line:test", lineUserId: "user:test" }
}).ok, false, "historical evidence outside the 24-hour TTL must fail closed");

console.log("context historical user grounding: PASS");
