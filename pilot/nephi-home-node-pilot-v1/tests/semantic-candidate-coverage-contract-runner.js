"use strict";

const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { buildContextSnapshotV3, decideContextExecutionV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");

const IDS = Object.freeze({
  price: "10000000-0000-4000-8000-000000000001",
  facility: "10000000-0000-4000-8000-000000000002",
  temporal: "10000000-0000-4000-8000-000000000003",
  bundle: "10000000-0000-4000-8000-000000000004",
  room: "10000000-0000-4000-8000-000000000005",
  scope: "20000000-0000-4000-8000-000000000001",
  feature: "10000000-0000-4000-8000-000000000006",
  unknown: "10000000-0000-4000-8000-000000000099"
});

const emptyStay = () => ({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function evidence(eventId, message, quote = message) {
  const startOffset = message.indexOf(quote);
  assert.notEqual(startOffset, -1, "test evidence must be an exact source span");
  return [{ eventId, messageRef: "", startOffset, endOffset: startOffset + quote.length, quote }];
}

function semanticCandidate({
  candidateId,
  semanticKind,
  capability,
  canonicalIdentityCandidate = null,
  evidenceRefs,
  lodgingScopeCandidate = null,
  temporalSemanticCandidate = null,
  propertyCatalogIdentity = null
}) {
  return {
    candidateId,
    semanticKind,
    capability,
    canonicalIdentityCandidate,
    evidenceRefs,
    lodgingScopeCandidate,
    temporalSemanticCandidate,
    propertyCatalogIdentity
  };
}

function task({
  candidateIndex,
  taskId,
  type,
  sourceText,
  semanticCandidateIds,
  category = "other",
  canonicalCandidate = null,
  dependsOnStayContext = false,
  stayCandidate = null,
  lodgingScopeId = null,
  detailIntent = "general"
}) {
  return {
    candidateIndex,
    taskId,
    type,
    sourceText,
    detailIntent,
    requestedOutputs: [type === "price" ? "price" : type === "availability" ? "availability" : "answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext,
    entity: { category, rawText: canonicalCandidate ? sourceText : "", canonicalCandidate, confidence: 1 },
    stayCandidate: dependsOnStayContext ? stayCandidate || emptyStay() : null,
    semanticCandidateIds,
    lodgingScopeId,
    confidence: 1
  };
}

function output({ message, eventId, tasks, semanticCandidates, relations }) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: emptyStay(),
    tasks,
    semanticCandidates,
    contextRelationCandidates: relations || tasks.map((item) => ({
      candidateIndex: item.candidateIndex,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: evidence(eventId, message, item.sourceText)
    })),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "structured semantic candidates"
  };
}

function response(value) {
  return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify(value) }) };
}

function input(message, eventId, catalog, contextSnapshot = { scope: {}, cycles: [] }) {
  return {
    currentMessage: message,
    currentMessages: [message],
    sourceEvents: [{ eventId, messageText: message }],
    eventTimestamp: 1,
    catalog,
    contextSnapshot
  };
}

function catalog() {
  return {
    propertyId: "semantic-contract-property",
    displayName: "Semantic Contract Property",
    timezone: "Asia/Taipei",
    rooms: [
      { canonicalId: "lodging_bundle", category: "bundle", publicName: "Group Lodging", type: "bundle", capacity: 8, aliases: [], memberRoomIds: ["quiet_room"] },
      { canonicalId: "quiet_room", category: "room", publicName: "Quiet Room", type: "room", capacity: 2, aliases: [], memberRoomIds: [] }
    ],
    amenities: [{ canonicalId: "water_feature", category: "amenity", publicName: "Aquatic Facility", aliases: [], status: "confirmed_yes", answer: "Available under formal rules." }],
    policies: [],
    faqs: []
  };
}

async function classifySequence({ first, repair, plannerInput }) {
  let calls = 0;
  const bodies = [];
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      calls += 1;
      bodies.push(JSON.parse(options.body));
      return response(calls === 1 ? first : repair || first);
    }
  });
  const result = await planner.classify(plannerInput);
  return { result, calls, bodies };
}

(async () => {
  const strictSchema = plannerJsonSchema();
  assert.ok(strictSchema.required.includes("semanticCandidates"));
  assert.ok(strictSchema.properties.tasks.items.required.includes("semanticCandidateIds"));
  assert.ok(strictSchema.properties.tasks.items.required.includes("lodgingScopeId"));
  const propertyCatalog = catalog();
  const message = "Could you quote the stay and explain the place where guests cool off?";
  const eventId = "semantic-ledger";
  const priceEvidence = evidence(eventId, message, "quote the stay");
  const facilityEvidence = evidence(eventId, message, "place where guests cool off");
  const priceCandidate = semanticCandidate({
    candidateId: IDS.price,
    semanticKind: "capability",
    capability: "price",
    canonicalIdentityCandidate: "price",
    evidenceRefs: priceEvidence
  });
  const facilityCandidate = semanticCandidate({
    candidateId: IDS.facility,
    semanticKind: "catalog_subject",
    capability: "property_fact",
    canonicalIdentityCandidate: "water_feature",
    propertyCatalogIdentity: "water_feature",
    evidenceRefs: facilityEvidence
  });
  const firstPriceTask = task({
    candidateIndex: 0,
    taskId: "first-price",
    type: "price",
    sourceText: "quote the stay",
    semanticCandidateIds: [IDS.price],
    category: "other",
    dependsOnStayContext: true
  });
  const first = output({ message, eventId, tasks: [firstPriceTask], semanticCandidates: [priceCandidate, facilityCandidate] });
  const missingLedger = JSON.parse(JSON.stringify(first));
  delete missingLedger.semanticCandidates;
  delete missingLedger.tasks[0].semanticCandidateIds;
  delete missingLedger.tasks[0].lodgingScopeId;
  assert.equal(validatePlannerOutput(missingLedger).ok, false, "runtime validation must reject a missing ledger and task join fields");
  const orphanScope = JSON.parse(JSON.stringify(first));
  orphanScope.tasks[0].lodgingScopeId = IDS.scope;
  assert.equal(validatePlannerOutput(orphanScope).ok, false, "an orphan lodging scope ID must fail closed");
  const emptyLedger = JSON.parse(JSON.stringify(first));
  emptyLedger.semanticCandidates = [];
  emptyLedger.tasks[0].semanticCandidateIds = [];
  assert.equal(validatePlannerOutput(emptyLedger).ok, false, "empty ledger and ownership must fail closed");
  const unknownOwnership = JSON.parse(JSON.stringify(first));
  unknownOwnership.tasks[0].semanticCandidateIds.push(IDS.unknown);
  assert.equal(validatePlannerOutput(unknownOwnership).ok, false, "a task may not cite an unknown candidate ID");
  const repairedFacilityTask = task({
    candidateIndex: 0,
    taskId: "repaired-facility",
    type: "property_fact",
    sourceText: "place where guests cool off",
    semanticCandidateIds: [IDS.facility],
    category: "amenity",
    canonicalCandidate: "water_feature"
  });
  const repair = output({
    message,
    eventId,
    tasks: [repairedFacilityTask],
    semanticCandidates: [facilityCandidate],
    relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: facilityEvidence }]
  });
  const repaired = await classifySequence({ first, repair, plannerInput: input(message, eventId, propertyCatalog) });
  assert.equal(repaired.calls, 2, "one missing structured candidate must trigger exactly one repair call");
  const { semanticCandidateIds: _firstIds, lodgingScopeId: _firstScope, ...firstTaskSemantics } = repaired.result.tasks[0];
  const { semanticCandidateIds: _expectedIds, lodgingScopeId: _expectedScope, ...expectedFirstTaskSemantics } = firstPriceTask;
  assert.deepEqual(firstTaskSemantics, expectedFirstTaskSemantics, "the first legal sibling semantics must survive compiler ownership allocation");
  assert.equal(repaired.result.tasks[0].semanticCandidateIds.length, 1);
  assert.equal(repaired.result.tasks[1].entity.canonicalCandidate, "water_feature");
  assert.equal(repaired.result.tasks[1].semanticCandidateIds.length, 1);
  const repairPayload = JSON.parse(repaired.bodies[1].input[1].content[0].text).coverageRepair;
  assert.deepEqual(repairPayload.missingCandidateIds, repaired.result.semanticCandidates.filter((candidate) => candidate.propertyCatalogIdentity === "water_feature").map((candidate) => candidate.candidateId));
  const { candidateId: _facilityCandidateId, ...facilitySemantics } = facilityCandidate;
  assert.deepEqual(repairPayload.missingSemanticCandidates.map(({ candidateId, ...candidate }) => candidate), [facilitySemantics]);
  assert.equal(Object.hasOwn(repairPayload, "missingCanonicalIds"), false, "repair must not be driven by text-derived canonical IDs");

  const alternateMessage = "Please tell me whether the cooling area may be used.";
  const alternateEvent = "semantic-ledger-alternate";
  const alternateCandidate = {
    ...facilityCandidate,
    evidenceRefs: evidence(alternateEvent, alternateMessage, "cooling area")
  };
  const alternateTask = task({
    candidateIndex: 0,
    taskId: "alternate-facility",
    type: "property_fact",
    sourceText: "cooling area",
    semanticCandidateIds: [IDS.facility],
    category: "amenity",
    canonicalCandidate: "water_feature"
  });
  const alternateOutput = output({ message: alternateMessage, eventId: alternateEvent, tasks: [alternateTask], semanticCandidates: [alternateCandidate] });
  const alternate = await classifySequence({ first: alternateOutput, plannerInput: input(alternateMessage, alternateEvent, propertyCatalog) });
  assert.equal(alternate.calls, 1, "different wording with the same structured identity must have the same coverage result");
  assert.equal(alternate.result.semanticCandidates[0].propertyCatalogIdentity, "water_feature");

  const wholeMessageTask = { ...alternateTask, sourceText: alternateMessage };
  const wholeMessageOutput = output({
    message: alternateMessage,
    eventId: alternateEvent,
    tasks: [wholeMessageTask],
    semanticCandidates: [alternateCandidate],
    relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: evidence(alternateEvent, alternateMessage) }]
  });
  const wholeMessage = await classifySequence({ first: wholeMessageOutput, plannerInput: input(alternateMessage, alternateEvent, propertyCatalog) });
  assert.equal(wholeMessage.calls, 1, "task source shape must not change candidate ownership coverage");

  const lexicalOnlyMessage = "Aquatic Facility";
  const lexicalOnlyEvent = "no-authoritative-matcher";
  const lexicalPriceCandidate = { ...priceCandidate, evidenceRefs: evidence(lexicalOnlyEvent, lexicalOnlyMessage) };
  const lexicalPriceTask = task({ candidateIndex: 0, taskId: "lexical-price", type: "price", sourceText: lexicalOnlyMessage, semanticCandidateIds: [IDS.price], dependsOnStayContext: true });
  const lexicalOnlyOutput = output({ message: lexicalOnlyMessage, eventId: lexicalOnlyEvent, tasks: [lexicalPriceTask], semanticCandidates: [lexicalPriceCandidate] });
  const lexicalOnly = await classifySequence({ first: lexicalOnlyOutput, plannerInput: input(lexicalOnlyMessage, lexicalOnlyEvent, propertyCatalog) });
  assert.equal(lexicalOnly.calls, 1, "catalog wording without a structured semantic candidate must not create intent or trigger repair");
  assert.equal(lexicalOnly.result.tasks.length, 1);

  const temporalMessage = "Please quote recurring weekend stays in a chosen month.";
  const temporalEvent = "temporal-ledger";
  const temporalEvidence = evidence(temporalEvent, temporalMessage, "recurring weekend stays in a chosen month");
  const temporalCandidate = semanticCandidate({
    candidateId: IDS.temporal,
    semanticKind: "temporal_pattern",
    capability: "availability",
    canonicalIdentityCandidate: "temporal_pattern",
    evidenceRefs: temporalEvidence,
    temporalSemanticCandidate: { rawText: "recurring weekend stays in a chosen month", kind: "weekday", anchor: "message_time" }
  });
  const temporalPrice = task({ candidateIndex: 0, taskId: "temporal-price", type: "price", sourceText: temporalMessage, semanticCandidateIds: [IDS.price], category: "room", dependsOnStayContext: true });
  const temporalFirst = output({ message: temporalMessage, eventId: temporalEvent, tasks: [temporalPrice], semanticCandidates: [{ ...priceCandidate, evidenceRefs: evidence(temporalEvent, temporalMessage) }, temporalCandidate] });
  const temporalRepairTask = task({
    candidateIndex: 0,
    taskId: "temporal-availability",
    type: "availability",
    sourceText: "recurring weekend stays in a chosen month",
    semanticCandidateIds: [IDS.temporal],
    category: "room",
    dependsOnStayContext: true,
    stayCandidate: { ...emptyStay(), dateExpression: { rawText: "recurring weekend stays in a chosen month", kind: "weekday", anchor: "message_time" } }
  });
  const temporalRepair = output({
    message: temporalMessage,
    eventId: temporalEvent,
    tasks: [temporalRepairTask],
    semanticCandidates: [temporalCandidate],
    relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: temporalEvidence }]
  });
  const temporal = await classifySequence({ first: temporalFirst, repair: temporalRepair, plannerInput: input(temporalMessage, temporalEvent, propertyCatalog) });
  assert.equal(temporal.calls, 2, "structured temporal semantics must trigger repair independently of sourceText field arrangement");
  assert.equal(temporal.result.tasks[1].type, "availability");

  const lodgingMessage = "Arrange a group stay while restricting it to the quiet room.";
  const lodgingEvent = "lodging-scope";
  const lodgingEvidence = evidence(lodgingEvent, lodgingMessage);
  const lodgingScopeCandidate = { scopeId: IDS.scope, bundleCanonicalCandidate: "lodging_bundle", roomCanonicalCandidates: ["quiet_room"], guestCountCandidate: 6 };
  const bundleCandidate = semanticCandidate({ candidateId: IDS.bundle, semanticKind: "lodging_scope", capability: "bundle_availability", canonicalIdentityCandidate: "lodging_bundle", propertyCatalogIdentity: "lodging_bundle", evidenceRefs: lodgingEvidence, lodgingScopeCandidate });
  const roomCandidate = semanticCandidate({ candidateId: IDS.room, semanticKind: "lodging_scope", capability: "availability", canonicalIdentityCandidate: "quiet_room", propertyCatalogIdentity: "quiet_room", evidenceRefs: lodgingEvidence, lodgingScopeCandidate });
  const bundleTask = task({ candidateIndex: 0, taskId: "bundle-sibling", type: "bundle_availability", sourceText: lodgingMessage, semanticCandidateIds: [IDS.bundle], category: "bundle", canonicalCandidate: "lodging_bundle", dependsOnStayContext: true, lodgingScopeId: IDS.scope });
  const roomTask = task({ candidateIndex: 1, taskId: "room-sibling", type: "availability", sourceText: lodgingMessage, semanticCandidateIds: [IDS.room], category: "room", canonicalCandidate: "quiet_room", dependsOnStayContext: true, lodgingScopeId: IDS.scope });
  const lodgingOutput = output({ message: lodgingMessage, eventId: lodgingEvent, tasks: [bundleTask, roomTask], semanticCandidates: [bundleCandidate, roomCandidate], relations: [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: lodgingEvidence },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: lodgingEvidence }
  ] });
  const lodging = await classifySequence({ first: lodgingOutput, plannerInput: input(lodgingMessage, lodgingEvent, propertyCatalog) });
  const conflictingScopeCandidate = {
    ...roomCandidate,
    candidateId: IDS.feature,
    lodgingScopeCandidate: { ...lodgingScopeCandidate, guestCountCandidate: 7 }
  };
  const conflictingScope = { ...lodgingOutput, semanticCandidates: [...lodgingOutput.semanticCandidates, conflictingScopeCandidate] };
  assert.equal(validatePlannerOutput(conflictingScope).ok, false, "one scope ID with conflicting contents must fail closed");
  assert.equal(lodging.calls, 1);
  const validation = validateUnderstandingContext(lodging.result, { scope: {}, cycles: [] }, { sourceEvents: input(lodgingMessage, lodgingEvent, propertyCatalog).sourceEvents });
  assert.equal(validation.ok, true);
  const emptyState = { schemaVersion: 3, revision: 0, scope: { propertyId: "semantic-contract-property", channel: "test", userId: "user" }, tasks: [] };
  const execution = decideContextExecutionV3({ state: emptyState, relations: validation.relations, plannerTasks: lodging.result.tasks, catalog: propertyCatalog, now: "2026-01-01T00:00:00.000Z" });
  assert.equal(new Set(execution.executionItems.map((item) => item.requestCycleId)).size, 1, "one lodging scope must create one request cycle");
  assert.equal(execution.executionItems[0].requestCycleId, lodging.result.tasks[0].lodgingScopeId, "adapter-allocated scope must be the execution cycle identity");

  const stateWithScope = {
    schemaVersion: 3,
    revision: 1,
    scope: { propertyId: "semantic-contract-property", channel: "test", userId: "user" },
    tasks: [{ taskId: IDS.scope, taskType: "availability", status: "pending", productType: "bundle", productId: "lodging_bundle", bundleId: "lodging_bundle", roomTypeId: null, checkIn: null, checkOut: null, guestCount: 6, searchFrom: null, searchTo: null, entityId: "lodging_bundle", entityCategory: "bundle", detailIntent: "general", knownFields: [], missingFields: ["checkIn", "checkOut"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" }]
  };
  const snapshot = buildContextSnapshotV3(stateWithScope, { propertyId: "semantic-contract-property", channel: "test", userId: "user", now: "2026-01-01T01:00:00.000Z" });
  assert.deepEqual(snapshot.cycles.map((cycle) => cycle.requestCycleId), [IDS.scope], "later modify_existing must see exactly one lodging request cycle");

  const invalidCandidate = semanticCandidate({ candidateId: IDS.unknown, semanticKind: "catalog_subject", capability: "property_fact", canonicalIdentityCandidate: "not_in_catalog", propertyCatalogIdentity: "not_in_catalog", evidenceRefs: facilityEvidence });
  const invalidFirst = output({ message, eventId, tasks: [firstPriceTask], semanticCandidates: [priceCandidate, invalidCandidate] });
  const invalidRepairTask = task({ candidateIndex: 0, taskId: "invalid-repair", type: "property_fact", sourceText: "place where guests cool off", semanticCandidateIds: [IDS.unknown], category: "amenity", canonicalCandidate: "not_in_catalog" });
  const invalidRepair = output({ message, eventId, tasks: [invalidRepairTask], semanticCandidates: [invalidCandidate], relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: facilityEvidence }] });
  const invalid = await classifySequence({ first: invalidFirst, repair: invalidRepair, plannerInput: input(message, eventId, propertyCatalog) });
  assert.ok(invalid.calls <= 2, "unknown identities may never cause a third call");
  assert.equal(invalid.result.tasks.some((item) => item.entity.canonicalCandidate === "not_in_catalog"), false, "unknown catalog identities must fail closed");

  const featureMessage = "Does the sleeping space offer a deep soaking option?";
  const featureEvent = "structured-room-feature";
  const featureEvidence = evidence(featureEvent, featureMessage, "deep soaking option");
  const featureCandidate = semanticCandidate({ candidateId: IDS.feature, semanticKind: "capability", capability: "property_fact", canonicalIdentityCandidate: "room_feature", evidenceRefs: featureEvidence });
  const featureTask = {
    ...task({ candidateIndex: 0, taskId: "room-feature", type: "property_fact", sourceText: "deep soaking option", semanticCandidateIds: [IDS.feature], category: "room_feature" }),
    entity: { category: "room_feature", rawText: "deep soaking option", canonicalCandidate: null, confidence: 1 }
  };
  const featureOutput = output({ message: featureMessage, eventId: featureEvent, tasks: [featureTask], semanticCandidates: [featureCandidate] });
  const feature = await classifySequence({ first: featureOutput, plannerInput: input(featureMessage, featureEvent, propertyCatalog) });
  assert.equal(feature.calls, 1, "a structured room feature must not depend on a complete catalog feature string matcher");

  const duplicateFirst = output({ message, eventId, tasks: [firstPriceTask], semanticCandidates: [priceCandidate, facilityCandidate, facilityCandidate] });
  const duplicate = await classifySequence({ first: duplicateFirst, plannerInput: input(message, eventId, propertyCatalog) });
  assert.equal(duplicate.calls, 1, "duplicate candidate IDs must not be repaired or joined");
  assert.equal(duplicate.result.tasks.length, 1);
  assert.equal(duplicate.result.needsHuman, true, "duplicate candidate IDs must fail closed");

  const ambiguousCandidate = { ...facilityCandidate, candidateId: IDS.feature };
  const ambiguousFirst = output({ message, eventId, tasks: [firstPriceTask], semanticCandidates: [priceCandidate, facilityCandidate, ambiguousCandidate] });
  const ambiguousRepairTask = task({
    candidateIndex: 0,
    taskId: "ambiguous-repair",
    type: "property_fact",
    sourceText: "place where guests cool off",
    semanticCandidateIds: [IDS.facility, IDS.feature],
    category: "amenity",
    canonicalCandidate: "water_feature"
  });
  const ambiguousRepair = output({
    message,
    eventId,
    tasks: [ambiguousRepairTask],
    semanticCandidates: [facilityCandidate, ambiguousCandidate],
    relations: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: facilityEvidence }]
  });
  const ambiguous = await classifySequence({ first: ambiguousFirst, repair: ambiguousRepair, plannerInput: input(message, eventId, propertyCatalog) });
  assert.equal(ambiguous.calls, 1, "duplicate semantic payloads fail closed before repair rather than relying on model-issued IDs");
  assert.equal(ambiguous.result.tasks.length, 1, "one task claiming multiple missing IDs must not be ambiguously joined");
  assert.equal(ambiguous.result.needsHuman, true, "ambiguous repair ownership must fail closed");

  const diagnostic = repaired.result[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(diagnostic.providerAttemptCount, 2);
  assert.equal(diagnostic.coverageRepairPerformed, true);
  assert.equal(diagnostic.coverageRepairSucceeded, true);
  assert.equal(diagnostic.coverageRepairFallback, false);
  assert.equal(diagnostic.repairLinks.length, 1);
  assert.equal(diagnostic.repairLinks[0].taskId, "repaired-facility");
  assert.match(diagnostic.repairLinks[0].correlationId, /^[0-9a-f-]{36}$/i);

  console.log("semantic candidate coverage contract: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
