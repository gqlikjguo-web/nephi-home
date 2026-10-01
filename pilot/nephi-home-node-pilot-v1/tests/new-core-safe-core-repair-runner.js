"use strict";
// FAKE_INTEGRATION: real admission/Context/C08/State, fixed Understanding and inventory.
// No external model, database, LINE transport or deployment is used.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { turn, refs } = require("./helpers/new-core-context-scenarios");

function roomSet(output, input) {
  const subject = input.publicSubjectCatalog.find(item => item.kind === "matched_room_set");
  assert.ok(subject);
  output.understandingOutput.units[0].subject = { kind: subject.kind, catalogIdentity: subject.catalogIdentity };
  return output;
}

test("verified nights from an executable START survive persisted quantity, guest and product changes", async () => {
  const first = await turn([{
    capability: "availability", kind: "matched_room_set", identity: null,
    text: "10月22號，四個人住兩晚，要兩間雙人房。",
    temporal: { kind: "month_day", rawText: "10月22號", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 2 },
    slots: [["guest_count", 4]], quantity: { requestedQuantity: 2, distinctRequirement: "distinct_entities" }
  }], { transformOutput: roomSet });
  assert.equal(first.result.earliestFailure, null);
  const canonicalNights = first.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.fields.nights;
  assert.equal(canonicalNights.value, 2);
  assert.equal(canonicalNights.valueStatus, "confirmed");
  assert.equal(canonicalNights.provenance, "explicit");
  assert.equal(first.state.tasks[0].nights, 2, "START must persist verified Canonical nights");
  assert.deepEqual(first.state.tasks[0].nightsEvidence, canonicalNights);
  const identity = first.state.tasks[0].entityId;
  let previous = first;
  let history = first.history;
  for (const spec of [
    { text: "一間就好，人數改成兩個人。", kind: "matched_room_set", identity, slots: [["guest_count", 2]],
      quantity: { requestedQuantity: 1, distinctRequirement: "none" } },
    { text: "改成 Room A。", kind: "room", identity: "room-a", slots: [["product", "room-a"]] },
    { text: "先移除入住人數條件。", kind: "room", identity: "room-a", slots: [["guest_count", null, "CLEAR"]] }
  ]) {
    const current = await turn([{ ...spec, capability: "availability", relation: "MODIFICATION", refs: refs(previous) }],
      { previous: previous.state, history });
    assert.equal(current.result.earliestFailure, null);
    assert.equal(current.calls, 1);
    const request = current.result.artifacts.formalRequests[0];
    assert.deepEqual([request.stay.checkIn, request.stay.checkOut, request.stay.nights], ["2026-10-22", "2026-10-24", 2]);
    const task = current.state.tasks.find(item => item.taskId === first.state.tasks[0].taskId);
    assert.equal(task.nights, 2);
    assert.equal(task.nightsEvidence.valueStatus, "confirmed");
    assert.deepEqual(task.nightsEvidence.sourceEvidenceRefs, canonicalNights.sourceEvidenceRefs);
    assert.equal(task.requestedQuantity, 1);
    history = [...history, ...current.history];
    previous = current;
  }
  assert.equal(previous.state.tasks[0].guestCount, null);
  assert.equal(previous.state.tasks[0].productId, "room-a");
});


function occupancyAdmission({ text, name, productSpan, guestSpan, propertyId = "source-property", candidateOverrides = {} }) {
  const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
  const { validateSemanticUnit, buildPublicCatalogIdentitySet, projectCapabilityRegistry } = require("../lib/new-core/semantic-unit-validator");
  const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
  const source = { eventId: "owned-event", messageRef: "owned-message", role: "guest", timestamp: "2026-09-30T00:00:00.000Z", messageKind: "text", messageText: text };
  const ref = ([startOffset, endOffset]) => ({ eventId: source.eventId, messageRef: source.messageRef,
    startOffset, endOffset, quote: text.slice(startOffset, endOffset) });
  const input = buildUnderstandingTurnInput({ coreVersion: "new-core-v1", traceId: "source-trace", turnId: "source-turn",
    verifiedPropertyBinding: { propertyId, channel: "source-channel" }, verifiedConversationScope: { channel: "source-channel", userId: "source-guest" },
    sourceEvents: [source], recentConversation: [], stateV3Snapshot: { scope: { propertyId }, referenceableCycles: [] },
    publicCatalog: { propertyId, timezone: "Asia/Taipei", capabilityCatalog: ["availability"],
      publicSubjectCatalog: [{ propertyId, catalogIdentity: "source-room", kind: "room", publicName: name }] } });
  const unit = { unitId: "source-unit", purpose: "lodging_question", capability: "availability",
    subject: { kind: "room", catalogIdentity: "source-room" }, stayDependent: true, temporalCandidate: null,
    contextLinkCandidateId: "source-link", safetyCandidate: null, confidenceBand: "high", evidenceRefs: [ref([0, text.length])],
    slotCandidates: [ { slotCandidateId: "product", slot: "product", value: "source-room", operation: "SET", evidenceRefs: [ref(productSpan)] },
      { slotCandidateId: "occupancy", slot: "guest_count", value: 4, operation: "SET", evidenceRefs: [ref(guestSpan)] } ] };
  return validateSemanticUnit({ unit: { ...unit, ...candidateOverrides }, understandingTurnInput: input, validatedEvidenceRefs: [ ...unit.evidenceRefs, ...unit.slotCandidates.flatMap(slot => slot.evidenceRefs) ],
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(input), capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY) });
}

test("a catalog product-name source alone cannot prove guest occupancy", () => {
  for (const example of [
    { text: "四人房有空房嗎", name: "902四人房", productSpan: [0, 3], guestSpan: [0, 2] },
    { text: "4 person suite available?", name: "4 person suite", productSpan: [0, 14], guestSpan: [0, 1], propertyId: "different-property" }
  ]) {
    const result = occupancyAdmission(example);
    assert.equal(result.ok, false, "a grounded product source must not create occupancy");
    assert.equal(result.code, "UNIT_MEANING_UNSUPPORTED");
    assert.equal(result.diagnostics.rule, "occupancySourceRole");
    assert.equal(result.fieldValidationState.find(field => field.slotCandidateId === "occupancy").preservation, "MUTABLE");
    assert.equal(result.fieldValidationState.find(field => field.slotCandidateId === "product").preservation, "PRESERVE");
  }
});

test("independently source-owned occupancy and the catalog product remain legal", () => {
  for (const example of [
    { text: "四個人住四人房", name: "902四人房", productSpan: [4, 7], guestSpan: [0, 3] },
    { text: "4 guests, 4 person suite", name: "4 person suite", productSpan: [10, 24], guestSpan: [0, 8], propertyId: "different-property" }
  ]) {
    const result = occupancyAdmission(example);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.slotCandidates.find(slot => slot.slot === "guest_count").value, 4);
    assert.equal(result.value.subject.catalogIdentity, "source-room");
  }
});

// STRUCTURED_CONTRACT_TEST: an unrelated failure cannot reopen trusted occupancy.
test("independent guest occupancy remains PRESERVE when capability admission fails first", () => {
  const result = occupancyAdmission({ text: "四個人住四人房", name: "902四人房", productSpan: [4, 7], guestSpan: [0, 3],
    candidateOverrides: { purpose: "unknown", capability: "unsupported" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNIT_MEANING_UNSUPPORTED");
  const guest = result.fieldValidationState.find(field => field.slotCandidateId === "occupancy");
  assert.equal(guest.preservation, "PRESERVE");
  assert.deepEqual(guest.validationPending, []);
  assert.ok(guest.validationCompleted.includes("occupancySourceRole"));
});


function independent(output, input) {
  output.contextLinkCandidates[0].independentRequestEvidence = {
    currentSourceEvidenceRefs: structuredClone(output.understandingOutput.units[0].evidenceRefs),
    assessedHistoryEventRefs: require("../lib/new-core/relation-completeness").referenceableStayHistory(input)
  };
  return output;
}
async function confirmedStay(options = {}) {
  const { dateRange } = require("./helpers/new-core-context-scenarios");
  return turn([{ capability: "availability", kind: "room", identity: "room-a", temporal: dateRange("2026-10-22", "2026-10-24"),
    slots: [["guest_count", 2]] }], options);
}


test("RELATED_UNIT inherits verified nights and evidence from its validated same-turn dependency", async () => {
  const { dateRange } = require("./helpers/new-core-context-scenarios");
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-10-22", "2026-10-26") }]);
  const next = await turn([
    { id: "source-unit", capability: "availability", kind: "room", identity: "room-b",
      relation: "MODIFICATION", refs: refs(first), slots: [["product", "room-b"]] },
    { id: "price-unit", capability: "price", kind: "room", identity: "room-b",
      relation: "RELATED_UNIT", sourceUnitId: "source-unit" }
  ], { previous: first.state, history: first.history, transformOutput(output) {
    output.contextLinkCandidates.find(link => link.unitId === "price-unit").referencedCurrentUnitId = "source-unit";
    return output;
  } });
  assert.equal(next.result.earliestFailure, null);
  const price = next.result.artifacts.formalRequests.find(request => request.taskId === "price-unit");
  assert.equal(price.stay.nights, 4);
  assert.equal(price.evidence.temporalFieldRefs.nights.value, 4);
  assert.equal(price.evidence.temporalFieldRefs.nights.valueStatus, "confirmed");
  assert.ok(price.evidence.temporalFieldRefs.nights.sourceEvidenceRefs.length > 0);
});

test("a history event bound to multiple eligible cycles cannot be narrowed by an ungrounded inherited subject", async () => {
  const { dateRange } = require("./helpers/new-core-context-scenarios");
  const first = await confirmedStay();
  const second = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    temporal: dateRange("2026-11-03", "2026-11-05") }], { previous: first.state, history: first.history });
  const shared = { eventId: "shared-history", messageRef: "shared-history", role: "guest",
    timestamp: "2026-09-24T02:00:00.000Z", messageKind: "text", messageText: "兩個住宿需求",
    referenceableCycleIds: second.state.tasks.map(task => task.taskId) };
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    text: "修改住宿晚數", relation: "MODIFICATION",
    temporal: { kind: "nights_only", rawText: "住宿晚數", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 4 },
    refs: [{ eventId: shared.eventId, messageRef: shared.messageRef }]
  }], { previous: second.state, history: [shared] });
  assert.equal(next.result.earliestFailure?.failureCode, "CONTEXT_TARGET_AMBIGUOUS");
  assert.equal(next.result.finalDecision.action, "handoff");
  assert.equal(next.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.deepEqual(next.state.tasks, second.state.tasks);
  assert.equal(next.queries.length, 0);
});

test("unbound incomplete inquiry asks about the unique verified stay without inheriting or modifying it", async () => {
  const first = await confirmedStay();
  const next = await turn([{ capability: "price", kind: "room", identity: "room-b", text: "換一個房型的價格呢？" }],
    { previous: first.state, history: first.history, transformOutput: independent });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.calls, 1);
  assert.equal(next.result.finalDecision.action, "clarification");
  const receipt = next.result.artifacts.executionOutcomes[0].contextClarification;
  assert.equal(receipt?.kind, "confirm_continuation");
  assert.equal(receipt.propertyId, first.c01.propertyScope.propertyId);
  assert.equal(receipt.requestCycleId, first.state.tasks[0].taskId);
  assert.equal(receipt.subjectName, "Room B");
  const text = next.result.finalResponse.replyText;
  assert.ok(text.includes("沿用") && text.includes("2026-10-22") && text.includes("Room B"));
  assert.equal(next.queries.length, 0);
  assert.equal(next.result.artifacts.contextCandidates[0].relationKind, "NEW_REQUEST");
  assert.equal(next.result.artifacts.contextCandidates[0].resolvedTargetRequestCycleId, null);
  assert.deepEqual(next.state.tasks.find(task => task.taskId === first.state.tasks[0].taskId), first.state.tasks[0]);
  const pending = next.state.tasks.find(task => task.taskId !== first.state.tasks[0].taskId);
  assert.equal(pending.checkIn, null);
  assert.equal(pending.checkOut, null);
});

test("multiple legitimate stay targets hand off without choosing or mutating a cycle", async () => {
  const { dateRange } = require("./helpers/new-core-context-scenarios");
  const first = await confirmedStay();
  const second = await turn([{ capability: "availability", kind: "room", identity: "room-b", temporal: dateRange("2026-11-03", "2026-11-05") }],
    { previous: first.state, history: first.history });
  assert.equal(second.result.earliestFailure, null);
  const next = await turn([{ capability: "price", kind: "room", identity: "room-b", text: "這樣的價格呢？" }],
    { previous: second.state, history: [...first.history, ...second.history], transformOutput: independent });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.result.finalDecision.action, "handoff");
  assert.equal(next.result.finalDecision.reviewRequired, true);
  assert.deepEqual(next.state.tasks, second.state.tasks);
  assert.equal(next.queries.length, 0);
  assert.ok(next.result.finalResponse.replyText.includes("盡快回覆"));
});

test("no verified stay gets ordinary missing-date clarification, with no manufactured continuation", async () => {
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-b", text: "想看另一種房型" }]);
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.result.finalDecision.action, "clarification");
  assert.ok(!next.result.artifacts.executionOutcomes[0].contextClarification);
  assert.ok(next.result.finalResponse.replyText.includes("入住日期"));
  assert.equal(next.queries.length, 0);
});


test("explicit occupancy-filter removal plus product scope CLEAR queries all property rooms and preserves the stay", async () => {
  const first = await confirmedStay();
  const next = await turn([{ capability: "availability", kind: "property", identity: null,
    text: "不用以入住人數篩選，改查這些日期的所有房型。", relation: "MODIFICATION", refs: refs(first),
    slots: [["guest_count", null, "CLEAR"], ["product", null, "CLEAR"]] }],
    { previous: first.state, history: first.history });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.calls, 1);
  const request = next.result.artifacts.formalRequests[0];
  assert.deepEqual([request.stay.checkIn, request.stay.checkOut, request.stay.nights], ["2026-10-22", "2026-10-24", 2]);
  assert.equal(request.resolverTask.guestCount, null);
  assert.equal(request.resolverTask.productId, null);
  assert.ok(!request.resolverTask.roomTypeSet?.length);
  assert.equal(next.queries.length, 1);
  assert.equal(next.queries[0].roomType, "all");
  const task = next.state.tasks.find(task => task.taskId === first.state.tasks[0].taskId);
  assert.equal(task.productId, null);
  assert.equal(task.entityId, null);
  assert.equal(task.guestCount, null);
  assert.equal(task.nights, 2);
  const inventory = next.result.artifacts.executionOutcomes[0].facts.availableInventory;
  assert.ok(inventory.some(item => item.canonicalId === "room-a"));
  assert.ok(inventory.some(item => item.canonicalId === "room-b"));
  assert.ok(inventory.filter(item => item.category === "room").every(item => item.capacity === 4));
});

test("ordinary guest-count CLEAR keeps the explicit product and never means all rooms", async () => {
  const first = await confirmedStay();
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-a", text: "人數暫時不確定。",
    relation: "MODIFICATION", refs: refs(first), slots: [["guest_count", null, "CLEAR"]] }],
    { previous: first.state, history: first.history });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.productId, "room-a");
  assert.equal(next.state.tasks[0].guestCount, null);
  assert.equal(next.state.tasks[0].productId, "room-a");
});


test("continuation receipts reject copied objects and cross-property or cross-turn use", async () => {
  const first = await confirmedStay();
  const next = await turn([{ capability: "price", kind: "room", identity: "room-b", text: "想查另一個房型的價格" }],
    { previous: first.state, history: first.history, transformOutput: independent });
  const receipt = next.result.artifacts.executionOutcomes[0].contextClarification;
  const { isContinuationClarification, continuationQuestion } = require("../lib/new-core/continuation-clarification");
  assert.equal(isContinuationClarification(receipt, { propertyId: next.c01.propertyScope.propertyId, turnId: next.c01.turnId }), true);
  assert.equal(isContinuationClarification(structuredClone(receipt)), false);
  assert.equal(continuationQuestion(receipt, { propertyId: "another-property" }), "");
  assert.equal(continuationQuestion(receipt, { turnId: "another-turn" }), "");
});

test("a subsequent verified confirmation may modify the explicitly referenced original stay", async () => {
  const first = await confirmedStay();
  const question = await turn([{ capability: "price", kind: "room", identity: "room-b", text: "想查另一個房型的價格" }],
    { previous: first.state, history: first.history, transformOutput: independent });
  const confirmed = await turn([{ capability: "availability", kind: "room", identity: "room-b", text: "對，沿用剛才那次住宿，換這個房型。",
    relation: "MODIFICATION", refs: refs(first), slots: [["product", "room-b"]] }],
    { previous: question.state, history: [...first.history, ...question.history] });
  assert.equal(confirmed.result.earliestFailure, null);
  const task = confirmed.state.tasks.find(item => item.taskId === first.state.tasks[0].taskId);
  assert.equal(task.productId, "room-b");
  assert.deepEqual([task.checkIn, task.checkOut, task.nights], ["2026-10-22", "2026-10-24", 2]);
  assert.equal(confirmed.queries.length, 1);
});

test("expired history never supplies dates or subject; current verified nights survive ordinary clarification", async () => {
  const { NOW } = require("./helpers/new-core-context-scenarios");
  const first = await confirmedStay();
  const now = new Date(Date.parse(NOW) + 25 * 3600000).toISOString();
  const next = await turn([{ capability: "availability", kind: "property", identity: null, text: "剛才那間改兩晚。",
    temporal: { kind: "nights_only", rawText: "兩晚", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 2 } }],
    { previous: first.state, history: first.history, now });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.c01.referenceableCycles.length, 0);
  assert.equal(next.result.finalDecision.action, "clarification");
  const task = next.state.tasks.find(item => ["pending", "needs_clarification"].includes(item.status));
  assert.equal(task.nights, 2);
  assert.ok(task.nightsEvidence.sourceEvidenceRefs.length);
  assert.equal(task.checkIn, null);
  assert.equal(task.checkOut, null);
  assert.equal(task.productId, null);
  assert.ok(!next.result.artifacts.executionOutcomes[0].contextClarification);
  assert.ok(next.result.finalResponse.replyText.includes("入住日期"));
  assert.ok(next.result.finalResponse.replyText.includes("https://example.invalid/contextfixture"));
  assert.equal(next.queries.length, 0);
});
