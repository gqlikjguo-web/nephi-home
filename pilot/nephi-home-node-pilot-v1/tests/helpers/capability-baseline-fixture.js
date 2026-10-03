"use strict";
// FAKE_INTEGRATION: only model transport and inventory reads are doubles.
// Admission, lifecycle, State, Canonical, service Resolver and reply are real modules.
const { executeNewCoreTurn } = require("../../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../../lib/providers/openai-understanding-v1");
const { createConversationStateV3, readConversationStateV3 } = require("../../lib/conversation-contracts/conversation-state-v3");
const { createMvpService } = require("../../lib/mvp-service");
const { requestCycleRefsForResult } = require("../../lib/new-core/production-turn-adapter");
const { fixtureSourceObligations } = require("./understanding-source-obligations-fixture");
const NOW = "2026-10-02T08:00:00.000Z";
const SCOPE = { propertyId: "receipt-property", channel: "isolated-channel", userId: "isolated-guest" };
function property(propertyId) {
  const room = (id, type, capacity) => ({ id, name: id, type, capacity, basePrice: 1500,
    mondayThursdayPrice: 1500, fridayPrice: 1500, saturdayHolidayPrice: 1500, sundayPrice: 1500 });
  return { propertyId, timezone: "Asia/Taipei", displayName: "Isolated receipt property",
    rooms: [room("double-a", "雙人房", 2), room("double-b", "雙人房", 2), room("quad-a", "四人房", 4), room("quad-b", "四人房", 4)],
    commonAnswers: {}, businessProfile: { publicSlug: "isolated-receipt" },
    propertyFacts: [["policy", "travel_subsidy"], ["amenity", "parking"], ["amenity", "clothes_dryer"]].map(([category, canonicalId]) => ({
      category, canonicalId, publicName: canonicalId, status: category === "policy" ? "allowed" : "provided",
      publicText: `Official fixture fact: ${canonicalId}.`, source: "operator_form", appliesTo: "whole_property"
    })) };
}
function envelope(input, specs) {
  const units = specs.map((s, i) => {
    const e = input.sourceEvents[i], evidenceRefs = [{ eventId: e.eventId, messageRef: e.messageRef,
      startOffset: 0, endOffset: e.messageText.length, quote: e.messageText }];
    const subject = s.roomType ? input.publicSubjectCatalog.find(x => x.kind === "matched_room_set" && x.publicName === s.roomType)
      : { kind: s.kind, catalogIdentity: s.identity };
    return { unitId: s.id || `unit-${i}`, purpose: s.purpose || "lodging_question", capability: s.capability,
      subject: { kind: subject.kind, catalogIdentity: subject.catalogIdentity },
      stayDependent: s.stayDependent ?? ["availability", "price", "total_price"].includes(s.capability),
      evidenceRefs, temporalCandidate: s.temporal || null, slotCandidates: (s.slots || []).map(([slot, value, operation = "SET"], j) => ({
        slotCandidateId: `slot-${i}-${j}`, slot, value, operation, evidenceRefs })),
      ...(s.setProduct ? { slotCandidates: [{ slotCandidateId: `product-${i}`, slot: "product", value: subject.catalogIdentity, operation: "SET", evidenceRefs }] } : {}),
      quantityCandidate: null, safetyCandidate: s.safety || null, contextLinkCandidateId: `link-${i}`, confidenceBand: "high" };
  });
  const links = units.map((u, i) => ({ unitId: u.unitId, contextLinkCandidateId: u.contextLinkCandidateId,
    relationKind: specs[i].relation || "NEW_REQUEST", currentSourceEvidenceRefs: u.evidenceRefs,
    referencedHistoryEventRefs: specs[i].refs || [], referencedCurrentUnitId: specs[i].sourceUnitId || null }));
  const requirements = specs.map((s, i) => {
    const requiredFields = units[i].subject.kind === null ? [] : ["subject"];
    if (s.temporal) {
      requiredFields.push("temporalCandidate");
      for (const key of ["checkInCandidate", "checkOutCandidate", "nightsCandidate", "relativeSemantics"])
        if (s.temporal[key] != null) requiredFields.push(`temporalCandidate.${key}`);
    }
    for (const [slot] of s.slots || []) requiredFields.push(`slot:${slot}`);
    if (s.setProduct) requiredFields.push("slot:product");
    return { obligationId: `obligation-${i}`, unitId: units[i].unitId, purpose: units[i].purpose, capability: s.capability,
      sourceEvidenceRefs: units[i].evidenceRefs, requiredFields, relationKind: links[i].relationKind,
      referencedHistoryEventRefs: links[i].referencedHistoryEventRefs, referencedCurrentUnitId: links[i].referencedCurrentUnitId };
  });
  return { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units }, contextLinkCandidates: links,
    sourceObligations: fixtureSourceObligations(input.sourceEvents, requirements) };
}
let serial = 0;
async function run(specs, { previous, history = previous?.history || [], now = NOW, scope = SCOPE,
  transform = value => value, inventory = "available" } = {}) {
  const p = property(scope.propertyId), id = `receipt-turn-${++serial}`;
  const state = readConversationStateV3(previous?.state || createConversationStateV3({ ...scope, tasks: [],
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.parse(now) + 86400000).toISOString() }), scope, now);
  const events = specs.map((s, i) => ({ eventId: `${id}-${i}`, messageRef: `${id}-${i}`, role: "guest",
    timestamp: now, messageKind: "text", messageText: s.text }));
  const service = createMvpService({ customerSettings: { getProperty: () => p }, persistence: {}, availability: { getRows: (_id, start, end) => {
    const rows = [];
    for (let ms = Date.parse(start); ms < Date.parse(end); ms += 86400000)
      rows.push({ date: new Date(ms).toISOString().slice(0, 10), ...Object.fromEntries(p.rooms.map(r => [r.id, inventory])) });
    return rows;
  } } });
  const queries = [], bodies = [], diagnostics = []; let calls = 0, c01;
  const result = await executeNewCoreTurn({ scope, property: p, state, now, publicBaseUrl: "https://example.invalid",
    input: { turnId: id, traceId: id, message: events.map(e => e.messageText).join("\n"), sourceEvents: events, recentConversation: history },
    providerConfig: { apiKey: "fixture-only" }, onDiagnostic: item => diagnostics.push(item),
    resolver: { availability: q => { queries.push(q); return service.searchAvailability(q); },
      availableDates: () => { throw Error("unexpected available dates"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, nowMs: () => Date.parse(now), fetchImpl: async (_url, request) => {
      c01 = input; bodies.push(JSON.parse(request.body));
      const output = transform(envelope(input, specs), ++calls, input);
      if (output instanceof Error) throw output;
      return { ok: true, status: 200, headers: { get: () => "fixture-only" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna",
        status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    } }) });
  return { result, state: JSON.parse(JSON.stringify(result.state)), calls, c01, bodies, diagnostics, queries,
    history: [...history, ...events.map(e => ({ ...e, referenceableCycleIds: requestCycleRefsForResult(result) }))], events };
}
const refs = turn => turn.events.map(({ eventId, messageRef }) => ({ eventId, messageRef }));
const stay = () => ({ capability: "availability", roomType: "雙人房", text: "10/6雙人房住三晚",
  temporal: { kind: "month_day", rawText: "10/6", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 3 } });
module.exports = { run, refs, stay, NOW, SCOPE, property, envelope };
