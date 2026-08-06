"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

function emptyStay() {
  return { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null };
}

function task(input) {
  return {
    candidateIndex: input.candidateIndex || 0,
    taskId: input.taskId,
    type: input.type,
    sourceText: input.sourceText,
    detailIntent: input.detailIntent || "general",
    requestedOutputs: input.requestedOutputs,
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: input.dependsOnStayContext,
    entity: { category: input.category, rawText: input.rawText, canonicalCandidate: input.canonicalCandidate || null, confidence: 0.99 },
    stayCandidate: input.stayCandidate === undefined ? null : input.stayCandidate,
    confidence: 0.99
  };
}

function compile(tasks, { catalog, message, stay = emptyStay(), evidenceQuotes } = {}) {
  const contextRelationCandidates = tasks.map((item, index) => {
    const quote = evidenceQuotes ? evidenceQuotes[index] : item.sourceText;
    const startOffset = message.indexOf(quote);
    return {
      candidateIndex: item.candidateIndex,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{ eventId: "reviewer-event", messageRef: "", startOffset, endOffset: startOffset + quote.length, quote }]
    };
  });
  return applyPlannerSemanticContract({
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [], stay, tasks, contextRelationCandidates,
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "reviewer_red"
  }, {
    catalog,
    sourceEvents: [{ eventId: "reviewer-event", messageRef: "", messageText: message }]
  });
}

const baseProperty = {
  propertyId: "reviewer-property",
  displayName: "Reviewer Property",
  timezone: "Asia/Taipei",
  commonAnswers: {},
  semanticCatalog: { aliases: {} },
  rooms: []
};

const cases = [
  ["empty task stay preserves top-level temporal authority", () => {
    const catalog = buildPropertyCatalog({ ...baseProperty, rooms: [{ id: "garden-room", name: "Garden Family Room", type: "family", description: "Deep soaking tub", capacity: 4, enabled: true }] });
    const topLevelStay = { dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-20", checkOutCandidate: "2026-08-22", nightsCandidate: 2, guestCountCandidate: 4 };
    const message = "Is Garden Family Room with Deep soaking tub available?";
    const result = compile([task({ taskId: "temporal", type: "availability", category: "room", rawText: "Garden Family Room", canonicalCandidate: "garden-room", sourceText: message, requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: emptyStay() })], { catalog, message, stay: topLevelStay });
    assert.equal(result.tasks[0].type, "availability");
    assert.deepEqual(result.tasks[0].stayCandidate, topLevelStay, "an empty task stay must not replace populated top-level date, range, duration, or guest count");
  }],
  ["generic inventory type is never a fuzzy authority", () => {
    const catalog = buildPropertyCatalog({ ...baseProperty, rooms: [{ id: "garden-suite", name: "Garden Suite A", type: "suite", capacity: 2, enabled: true }] });
    const message = "Confirm the suite lodging amount.";
    const result = compile([task({ taskId: "generic-fuzzy", type: "price", category: "policy", rawText: "lodging amount", canonicalCandidate: "price", sourceText: message, requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { catalog, message });
    assert.equal(result.tasks[0].entity.category, "other");
    assert.equal(result.tasks[0].entity.canonicalCandidate, null);
  }],
  ["formal-name fuzzy requires a complete phrase boundary", () => {
    const catalog = buildPropertyCatalog({ ...baseProperty, rooms: [{ id: "garden-suite", name: "Garden Suite A", type: "suite", capacity: 2, enabled: true }] });
    const message = "prefixgardensuitebpostfix lodging amount.";
    const result = compile([task({ taskId: "embedded-fuzzy", type: "price", category: "policy", rawText: "lodging amount", sourceText: message, requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { catalog, message });
    assert.equal(result.tasks[0].entity.category, "other");
    assert.equal(result.tasks[0].entity.canonicalCandidate, null);
  }],
  ["FAQ shared fragment cannot recover capability", () => {
    const catalog = buildPropertyCatalog({
      ...baseProperty,
      rooms: [{ id: "garden-room", name: "Garden Family Room", type: "family", capacity: 4, enabled: true }],
      faqs: [{ knowledgeKey: "fixture", question: "Which rooms include a deep soaking tub?", answer: "Use the formal room record." }]
    });
    const message = "Does Garden Family Room include deep soaking space?";
    const result = compile([task({ taskId: "faq-fragment", type: "availability", category: "room", rawText: "Garden Family Room", canonicalCandidate: "garden-room", sourceText: message, requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: emptyStay() })], { catalog, message });
    assert.equal(result.tasks[0].type, "availability", "an FAQ shared word span or substring must not invent an amenity capability");
  }],
  ["FAQ shared word cannot resolve a formal entity", () => {
    const catalog = buildPropertyCatalog({ ...baseProperty, faqs: [{ knowledgeKey: "fixture", question: "Which rooms include a deep soaking tub?", answer: "Use the formal room record." }] });
    const message = "rooms";
    const result = compile([task({ taskId: "faq-word", type: "amenity", category: "amenity", rawText: "rooms", sourceText: message, requestedOutputs: ["answer"], dependsOnStayContext: false })], { catalog, message });
    assert.equal(result.tasks[0].entity.canonicalCandidate, null, "a shared FAQ word must not resolve a formal entity");
    assert.equal(result.tasks[0].type, "amenity");
  }],
  ["tasks cannot borrow another clause scope", () => {
    const catalog = buildPropertyCatalog({ ...baseProperty, rooms: [{ id: "garden-suite", name: "Garden Suite A", type: "suite", capacity: 2, enabled: true }] });
    const message = "Garden Suite A has a feature. Confirm the lodging amount.";
    const tasks = [
      task({ taskId: "price", type: "price", category: "policy", rawText: "lodging amount", canonicalCandidate: "price", sourceText: "Confirm the lodging amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } }),
      task({ candidateIndex: 1, taskId: "feature", type: "amenity", category: "room_feature", rawText: "feature", sourceText: "Garden Suite A has a feature.", requestedOutputs: ["answer"], dependsOnStayContext: false })
    ];
    const result = compile(tasks, { catalog, message, evidenceQuotes: [message, message] });
    assert.equal(result.tasks[0].entity.category, "other");
    assert.equal(result.tasks[0].entity.canonicalCandidate, null);
  }]
];

let passes = 0;
for (const [name, run] of cases) {
  try {
    run();
    passes += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}
assert.equal(passes, cases.length, `expected all ${cases.length} reviewer cases to be GREEN, observed ${passes}`);
console.log(JSON.stringify({ suite: "planner-semantic-reviewer-red", caseCount: cases.length, passCount: passes, failCount: cases.length - passes }));
