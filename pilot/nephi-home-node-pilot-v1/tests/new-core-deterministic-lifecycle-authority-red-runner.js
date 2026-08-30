"use strict";

const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");
const { validateContextLink } = require("../lib/new-core/context-link-validator");
const { createLifecycleDecision } = require("../lib/new-core/lifecycle-manager");

const NOW = "2026-08-29T08:00:00.000Z";
const FUTURE = "2026-08-30T08:00:00.000Z";
const scope = { propertyId: "property-a", channel: "manual-test", userId: "guest-a" };

function evidence(text) {
  return { eventId: "event-current", messageRef: "message-current", startOffset: 0, endOffset: text.length, quote: text };
}

function cycle(requestCycleId) {
  return {
    requestCycleId,
    requestKind: "pricing",
    capability: "price",
    status: "pending",
    expiresAt: FUTURE,
    subject: { kind: "bundle", catalogIdentity: "bundle-a" },
    missingFields: ["checkIn", "checkOut"],
    confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
    slotRefs: ["productId"]
  };
}

function input(text, cycles = []) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: `trace-${text.length}-${cycles.length}`,
    turnId: `turn-${text.length}-${cycles.length}`,
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: [{ eventId: "event-current", messageRef: "message-current", role: "guest", timestamp: NOW, messageKind: "text", messageText: text }],
    recentConversation: cycles.length ? [{
      eventId: "event-history", messageRef: "message-history", role: "guest",
      timestamp: "2026-08-29T07:00:00.000Z", messageKind: "text", messageText: "先前需求",
      referenceableCycleIds: cycles.map((candidate) => candidate.requestCycleId)
    }] : [],
    stateV3Snapshot: { scope, referenceableCycles: cycles },
    publicCatalog: {
      propertyId: scope.propertyId,
      timezone: "Asia/Taipei",
      capabilityCatalog: Object.keys(CAPABILITY_REGISTRY),
      publicSubjectCatalog: [
        { propertyId: scope.propertyId, catalogIdentity: "bundle-a", kind: "bundle", publicName: "包棟" },
        { propertyId: scope.propertyId, catalogIdentity: "amenity-parking", kind: "amenity", publicName: "停車" },
        { propertyId: scope.propertyId, catalogIdentity: "amenity-singing", kind: "amenity", publicName: "唱歌設備" }
      ]
    }
  });
}

function runBoundary({ id, text, unit, cycles = [], relationKind = "NONE", targetRequestCycleIdCandidate = null }) {
  const turnInput = input(text, cycles);
  const normalizedEvidence = validateAndNormalizeSourceEvidence([evidence(text)], turnInput.sourceEvents);
  if (!normalizedEvidence.ok) throw new Error(`${id}: evidence setup failed`);
  const semantic = validateSemanticUnit({
    unit: {
      unitId: `unit-${id}`,
      evidenceRefs: [evidence(text)],
      temporalCandidate: null,
      contextLinkCandidateId: `link-${id}`,
      safetyCandidate: null,
      slotCandidates: [],
      confidenceBand: "high",
      ...unit
    },
    validatedEvidenceRefs: normalizedEvidence.value,
    understandingTurnInput: turnInput,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(turnInput),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  if (!semantic.ok) throw new Error(`${id}: semantic setup failed: ${semantic.code}`);
  const context = validateContextLink({
    unit: semantic.value,
    linkCandidate: {
      contextLinkCandidateId: `link-${id}`,
      unitId: `unit-${id}`,
      relationKind,
      currentSourceEvidenceRefs: [evidence(text)],
      referencedHistoryEventRefs: targetRequestCycleIdCandidate === null ? [] : [{
        eventId: "event-history", messageRef: "message-history"
      }]
    },
    understandingTurnInput: turnInput,
    validatedEvidenceRefs: normalizedEvidence.value,
    now: NOW
  });
  if (!context.ok) return { ok: false, code: context.code, boundary: "C05" };
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-${id}`,
    unit: semantic.value,
    validatedContextLink: context.value
  });
  return lifecycle.ok
    ? { ok: true, action: lifecycle.value.action, targetRequestCycleId: lifecycle.value.targetRequestCycleId }
    : { ok: false, code: lifecycle.code, boundary: "C06" };
}

const actionable = (capability, kind, catalogIdentity, stayDependent) => ({
  purpose: "lodging_question", capability,
  subject: { kind, catalogIdentity }, stayDependent
});

const cases = [
  { id: "parking_actionable_none", expected: { ok: true, action: "START", targetRequestCycleId: null },
    actual: runBoundary({ id: "parking", text: "請問有停車嗎", unit: actionable("amenity", "amenity", "amenity-parking", false) }) },
  { id: "singing_actionable_none", expected: { ok: true, action: "START", targetRequestCycleId: null },
    actual: runBoundary({ id: "singing", text: "有唱歌嗎", unit: actionable("amenity", "amenity", "amenity-singing", false) }) },
  { id: "bundle_price_actionable_none", expected: { ok: true, action: "START", targetRequestCycleId: null },
    actual: runBoundary({ id: "bundle-price", text: "禮拜六包棟多少錢", unit: { ...actionable("price", "bundle", "bundle-a", true), temporalCandidate: { rawText: "禮拜六", kind: "weekday", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null } } }) },
  { id: "unique_pending_supplement", expected: { ok: true, action: "CONTINUE", targetRequestCycleId: "cycle-a" },
    actual: runBoundary({ id: "continue", text: "9/20到9/21", cycles: [cycle("cycle-a")], relationKind: "SUPPLEMENT", targetRequestCycleIdCandidate: "history-evidence", unit: { ...actionable("price", "bundle", "bundle-a", true), temporalCandidate: { rawText: "9/20到9/21", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null } } }) },
  { id: "acknowledgement_none", expected: { ok: true, action: "NONE", targetRequestCycleId: null },
    actual: runBoundary({ id: "ack", text: "好的，謝謝您", unit: { purpose: "acknowledgement", capability: null, subject: { kind: null, catalogIdentity: null }, stayDependent: false } }) },
  { id: "explicit_modify", expected: { ok: true, action: "MODIFY", targetRequestCycleId: "cycle-a" },
    actual: runBoundary({ id: "modify", text: "改成9/21", cycles: [cycle("cycle-a")], relationKind: "MODIFICATION", targetRequestCycleIdCandidate: "cycle-a", unit: { purpose: "correction", capability: null, subject: { kind: null, catalogIdentity: null }, stayDependent: false } }) },
  { id: "explicit_end", expected: { ok: true, action: "END", targetRequestCycleId: "cycle-a" },
    actual: runBoundary({ id: "end", text: "不用查了", cycles: [cycle("cycle-a")], relationKind: "TERMINATION", targetRequestCycleIdCandidate: "cycle-a", unit: { purpose: "cancellation", capability: null, subject: { kind: null, catalogIdentity: null }, stayDependent: false } }) },
  { id: "ambiguous_pending_targets", expected: { ok: false, code: "CONTEXT_TARGET_AMBIGUOUS", boundary: "C05" },
    actual: runBoundary({ id: "ambiguous", text: "9/20到9/21", cycles: [cycle("cycle-a"), cycle("cycle-b")], relationKind: "SUPPLEMENT", targetRequestCycleIdCandidate: "history-evidence", unit: { ...actionable("price", "bundle", "bundle-a", true), temporalCandidate: { rawText: "9/20到9/21", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null } } }) }
];

const results = cases.map((item) => ({
  id: item.id,
  expected: item.expected,
  actual: item.actual,
  status: JSON.stringify(item.actual) === JSON.stringify(item.expected) ? "PASS" : "RED"
}));
console.log(JSON.stringify({ suite: "new-core-deterministic-lifecycle-authority-red", results }));
if (results.some((item) => item.status === "RED")) process.exitCode = 1;
