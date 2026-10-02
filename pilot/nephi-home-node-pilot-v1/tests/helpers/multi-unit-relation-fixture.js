"use strict";
// FAKE_INTEGRATION only: authored semantic candidates and in-memory facts.
// Every decision/admission/Context/Resolver/response uses the existing core.
const { executeNewCoreTurn } = require("../../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../../lib/conversation-contracts/conversation-state-v3");
const { requestCycleRefsForResult } = require("../../lib/new-core/production-turn-adapter");
const { createMvpService } = require("../../lib/mvp-service");
const { fixtureSourceObligations } = require("./understanding-source-obligations-fixture");
const NOW = "2026-10-02T01:00:00.000Z";
const TEMPORAL = { kind: "date_range", rawText: "2026-10-08入住，2026-10-09退房", checkInCandidate: "2026-10-08",
  checkOutCandidate: "2026-10-09", nightsCandidate: 1 };
const FACTS = [["policy", "travel_subsidy"], ["policy", "breakfast"], ["policy", "pets"],
  ["policy", "check_in"], ["policy", "check_out"], ["amenity", "parking"], ["amenity", "bathtub"], ["amenity", "reading_lounge"]];
let serial = 0;
function property(propertyId) {
  return { propertyId, displayName: "Isolated relation matrix", timezone: "Asia/Taipei",
    rooms: [{ id: "room-r", name: "Orchard suite", capacity: 4, basePrice: 1400,
      mondayThursdayPrice: 1400, fridayPrice: 1400, saturdayHolidayPrice: 1400, sundayPrice: 1400 }],
    commonAnswers: {}, businessProfile: {}, propertyFacts: FACTS.map(([category, canonicalId]) => ({
      canonicalId, category, publicName: canonicalId, status: category === "policy" ? "allowed" : "provided",
      publicText: `Registered ${canonicalId} facts for ${propertyId}.`, source: "operator_form", appliesTo: "whole_property"
    })) };
}
function lodging(capability = "availability") {
  const operator = capability === "booking_operator_request";
  return { id: "stay", text: `Orchard suite, ${TEMPORAL.rawText}, 2 guests.`, capability,
    purpose: operator ? "operator_request" : "lodging_question", kind: "room", identity: "room-r",
    stayDependent: !operator, temporal: TEMPORAL, guests: 2,
    safety: operator ? { operatorActionClass: "booking_mutation", riskClass: null } : null };
}
function information(kind, identity, id = "information") {
  return { id, text: `Please explain the ${identity} service.`, capability: kind, purpose: "lodging_question",
    kind, identity, stayDependent: false };
}
function envelope(input, specs) {
  const units = specs.map((spec, index) => {
    const event = input.sourceEvents[index];
    const ref = { eventId: event.eventId, messageRef: event.messageRef, startOffset: 0,
      endOffset: event.messageText.length, quote: event.messageText };
    const slotCandidates = [];
    if (spec.guests != null) {
      const startOffset = event.messageText.indexOf(`${spec.guests} guests`);
      const guestRef = { ...ref, startOffset, endOffset: startOffset + `${spec.guests} guests`.length,
        quote: `${spec.guests} guests` };
      slotCandidates.push({ slotCandidateId: `${spec.id}-guests`, slot: "guest_count", operation: "SET",
        value: spec.guests, evidenceRefs: [guestRef] });
    }
    if (spec.eligibility) slotCandidates.push({ slotCandidateId: `${spec.id}-need`, slot: "information_need",
      operation: "SET", value: "eligibility", evidenceRefs: [ref] });
    return { unitId: spec.id, contextLinkCandidateId: `${spec.id}-link`, purpose: spec.purpose,
      capability: spec.capability, subject: { kind: spec.kind, catalogIdentity: spec.identity },
      stayDependent: spec.stayDependent, temporalCandidate: spec.temporal || null, evidenceRefs: [ref],
      slotCandidates, quantityCandidate: null, safetyCandidate: spec.safety || null, confidenceBand: "high" };
  });
  const links = units.map((unit, index) => ({ unitId: unit.unitId, contextLinkCandidateId: unit.contextLinkCandidateId,
    relationKind: specs[index].relation || "NEW_REQUEST", currentSourceEvidenceRefs: unit.evidenceRefs,
    referencedHistoryEventRefs: specs[index].refs || [], referencedCurrentUnitId: specs[index].sourceUnitId || null }));
  const requirements = specs.map((spec, index) => {
    const requiredFields = ["subject"];
    if (spec.temporal) requiredFields.push("temporalCandidate", "temporalCandidate.checkInCandidate",
      "temporalCandidate.checkOutCandidate", "temporalCandidate.nightsCandidate");
    if (spec.guests != null) requiredFields.push("slot:guest_count");
    if (spec.eligibility) requiredFields.push("slot:information_need");
    return { obligationId: `${spec.id}-obligation`, unitId: spec.id, purpose: spec.purpose, capability: spec.capability,
      sourceEvidenceRefs: units[index].evidenceRefs, requiredFields, relationKind: links[index].relationKind,
      referencedHistoryEventRefs: links[index].referencedHistoryEventRefs, referencedCurrentUnitId: links[index].referencedCurrentUnitId };
  });
  return { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units }, contextLinkCandidates: links,
    sourceObligations: fixtureSourceObligations(input.sourceEvents, requirements) };
}
function setRelation(output, id, relationKind, refs = [], sourceUnitId = null) {
  const link = output.contextLinkCandidates.find(item => item.unitId === id);
  Object.assign(link, { relationKind, referencedHistoryEventRefs: refs, referencedCurrentUnitId: sourceUnitId });
  Object.assign(output.sourceObligations.requirements.find(item => item.unitId === id),
    { relationKind, referencedHistoryEventRefs: refs, referencedCurrentUnitId: sourceUnitId });
}
async function run(specs, { previous, transform = value => value, propertyId = "relation-alpha", unknown = false } = {}) {
  const id = `relation-turn-${++serial}`, p = property(propertyId), scope = { propertyId, channel: "isolated", userId: "guest-matrix" };
  if (unknown) p.propertyFacts = p.propertyFacts.map(fact => ({ ...fact, status: "unknown", publicText: "" }));
  const state = previous?.result.state || createConversationStateV3({ ...scope, tasks: [], createdAt: NOW, updatedAt: NOW,
    expiresAt: "2026-10-03T01:00:00.000Z" });
  const sourceEvents = specs.map((spec, index) => ({ eventId: `${id}-${index}`, messageRef: `${id}-${index}`,
    role: "guest", timestamp: NOW, messageKind: "text", messageText: spec.text }));
  const service = createMvpService({ customerSettings: { getProperty: () => p }, persistence: {}, availability: {
    getRows: (_propertyId, start, end) => {
      const rows = [];
      for (let ms = Date.parse(start); ms < Date.parse(end); ms += 86400000)
        rows.push({ date: new Date(ms).toISOString().slice(0, 10), "room-r": "available" });
      return rows;
    }
  } });
  const queries = [], diagnostics = [], bodies = [], outputs = [];
  let calls = 0, c01;
  const result = await executeNewCoreTurn({ scope, property: p, state, now: NOW, publicBaseUrl: "https://example.invalid",
    input: { turnId: id, traceId: id, message: sourceEvents.map(event => event.messageText).join("\n"), sourceEvents,
      recentConversation: previous?.history || [] }, providerConfig: { apiKey: "isolated-double" },
    onDiagnostic: entry => diagnostics.push(entry),
    resolver: { availability: query => { queries.push(query); return service.searchAvailability(query); },
      availableDates: () => { throw Error("unexpected date search"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, nowMs: () => Date.parse(NOW),
      fetchImpl: async (_url, request) => {
        c01 = input; bodies.push(JSON.parse(request.body));
        const output = transform(envelope(input, specs), ++calls, input);
        if (output instanceof Error) throw output;
        outputs.push(structuredClone(output));
        return { ok: true, status: 200, headers: { get: () => "fake-request" }, text: async () => JSON.stringify({
          model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }]
        }) };
      } }) });
  const history = sourceEvents.map(event => ({ ...event, referenceableCycleIds: requestCycleRefsForResult(result) }));
  const meta = result.artifacts.understanding?.[Symbol.for("junzan.openAiUnderstandingV1ProviderDiagnostic")];
  return { result, queries, diagnostics, bodies, calls, outputs, c01, history,
    attempts: meta?.attemptEvidence || result.understandingAttempts || [] };
}
const refs = previous => previous.history.map(({ eventId, messageRef }) => ({ eventId, messageRef }));
module.exports = { run, lodging, information, setRelation, refs, FACTS, NOW };
