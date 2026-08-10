"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const MAX_TASKS = 24;
const MAX_CANDIDATES = 24;
const MAX_RELATIONS = 24;
const MAX_EVIDENCE_REFS = 12;
const MAX_LIST_ITEMS = 24;
const RESPONSE_ROLES = new Set(["primary", "coverage_repair"]);
const storage = new AsyncLocalStorage();

function boundedString(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).slice(0, maxLength);
}

function boundedInteger(value, minimum = 0, maximum = 1000000) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function boundedStrings(value, maxItems = MAX_LIST_ITEMS, maxLength = 200) {
  return (Array.isArray(value) ? value : []).slice(0, maxItems).map((item) => boundedString(item, maxLength));
}

function evidenceRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
    eventId: boundedString(ref && ref.eventId, 120),
    messageRef: boundedString(ref && ref.messageRef, 120),
    startOffset: boundedInteger(ref && ref.startOffset),
    endOffset: boundedInteger(ref && ref.endOffset),
    quote: boundedString(ref && ref.quote, 500)
  }));
}

function dateInterpretation(value) {
  const dateExpression = value && value.dateExpression && typeof value.dateExpression === "object"
    ? value.dateExpression
    : {};
  return {
    dateExpression: {
      rawText: boundedString(dateExpression.rawText, 200),
      kind: boundedString(dateExpression.kind, 40),
      anchor: boundedString(dateExpression.anchor, 40)
    },
    checkInCandidate: value && value.checkInCandidate !== undefined && value.checkInCandidate !== null
      ? boundedString(value.checkInCandidate, 40)
      : null,
    checkOutCandidate: value && value.checkOutCandidate !== undefined && value.checkOutCandidate !== null
      ? boundedString(value.checkOutCandidate, 40)
      : null,
    nightsCandidate: boundedInteger(value && value.nightsCandidate, 1, 60),
    guestCountCandidate: boundedInteger(value && value.guestCountCandidate, 1, 100)
  };
}

function nullableDateInterpretation(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? dateInterpretation(value)
    : null;
}

function lodgingScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    bundleCanonicalCandidate: value.bundleCanonicalCandidate === null || value.bundleCanonicalCandidate === undefined
      ? null
      : boundedString(value.bundleCanonicalCandidate, 120),
    roomCanonicalCandidates: boundedStrings(value.roomCanonicalCandidates, 12, 120),
    guestCountCandidate: boundedInteger(value.guestCountCandidate, 1, 100)
  };
}

function temporalSemantic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    rawText: boundedString(value.rawText, 200),
    kind: boundedString(value.kind, 40),
    anchor: boundedString(value.anchor, 40)
  };
}

function taskSnapshot(task, taskOrdinal) {
  const entity = task && task.entity && typeof task.entity === "object" ? task.entity : {};
  const eligibility = task && task.eligibilityEvidence && typeof task.eligibilityEvidence === "object"
    ? task.eligibilityEvidence
    : {};
  return {
    taskOrdinal,
    candidateIndex: boundedInteger(task && task.candidateIndex),
    taskId: boundedString(task && task.taskId, 80),
    type: boundedString(task && task.type, 80),
    sourceText: boundedString(task && task.sourceText, 500),
    detailIntent: boundedString(task && task.detailIntent, 80),
    requestedOutputs: boundedStrings(task && task.requestedOutputs, MAX_LIST_ITEMS, 80),
    eligibilityEvidence: {
      kind: boundedString(eligibility.kind, 40),
      sourceText: boundedString(eligibility.sourceText, 200)
    },
    dependsOnStayContext: task && task.dependsOnStayContext === true,
    entity: {
      category: boundedString(entity.category, 80),
      rawText: boundedString(entity.rawText, 200),
      canonicalCandidate: entity.canonicalCandidate === null || entity.canonicalCandidate === undefined
        ? null
        : boundedString(entity.canonicalCandidate, 120),
      confidence: typeof entity.confidence === "number" && Number.isFinite(entity.confidence) ? entity.confidence : null
    },
    stayCandidate: nullableDateInterpretation(task && task.stayCandidate),
    confidence: typeof (task && task.confidence) === "number" && Number.isFinite(task.confidence) ? task.confidence : null
  };
}

function semanticCandidateSnapshot(candidate, candidateOrdinal) {
  return {
    candidateOrdinal,
    semanticKind: boundedString(candidate && candidate.semanticKind, 80),
    capability: boundedString(candidate && candidate.capability, 80),
    canonicalIdentityCandidate: candidate && candidate.canonicalIdentityCandidate !== null && candidate.canonicalIdentityCandidate !== undefined
      ? boundedString(candidate.canonicalIdentityCandidate, 120)
      : null,
    coverageStatus: boundedString(candidate && candidate.coverageStatus, 40),
    provenanceRelationCandidateIndexes: (Array.isArray(candidate && candidate.provenanceRelationCandidateIndexes)
      ? candidate.provenanceRelationCandidateIndexes
      : []).slice(0, 12).map((index) => boundedInteger(index)).filter((index) => index !== null),
    evidenceRefs: evidenceRefs(candidate && candidate.evidenceRefs),
    lodgingScopeCandidate: lodgingScope(candidate && candidate.lodgingScopeCandidate),
    temporalSemanticCandidate: temporalSemantic(candidate && candidate.temporalSemanticCandidate),
    propertyCatalogIdentity: candidate && candidate.propertyCatalogIdentity !== null && candidate.propertyCatalogIdentity !== undefined
      ? boundedString(candidate.propertyCatalogIdentity, 120)
      : null
  };
}

function relationSnapshot(relation, relationOrdinal) {
  return {
    relationOrdinal,
    candidateIndex: boundedInteger(relation && relation.candidateIndex),
    kind: boundedString(relation && relation.kind, 80),
    candidateRequestCycleRefs: boundedStrings(relation && relation.candidateRequestCycleRefs, 12, 120),
    evidenceRefs: evidenceRefs(relation && relation.evidenceRefs)
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function rawUnderstandingSnapshot(output, metadata = {}) {
  const discourse = output && output.discourse && typeof output.discourse === "object" ? output.discourse : {};
  return deepFreeze({
    stage: "raw_parsed_output",
    responseRole: RESPONSE_ROLES.has(metadata.responseRole) ? metadata.responseRole : "primary",
    providerAttemptNumber: boundedInteger(metadata.providerAttemptNumber, 1, 2) || 1,
    schemaVersion: Number.isInteger(output && output.schemaVersion) ? output.schemaVersion : null,
    discourse: {
      relation: boundedString(discourse.relation, 80),
      confidence: typeof discourse.confidence === "number" && Number.isFinite(discourse.confidence) ? discourse.confidence : null
    },
    stay: dateInterpretation(output && output.stay),
    tasks: (Array.isArray(output && output.tasks) ? output.tasks : []).slice(0, MAX_TASKS).map(taskSnapshot),
    semanticCandidates: (Array.isArray(output && output.semanticCandidates) ? output.semanticCandidates : []).slice(0, MAX_CANDIDATES).map(semanticCandidateSnapshot),
    contextRelationCandidates: (Array.isArray(output && output.contextRelationCandidates) ? output.contextRelationCandidates : []).slice(0, MAX_RELATIONS).map(relationSnapshot),
    ambiguities: boundedStrings(output && output.ambiguities, MAX_LIST_ITEMS, 300),
    missingInformation: boundedStrings(output && output.missingInformation, MAX_LIST_ITEMS, 120),
    needsHuman: output && output.needsHuman === true,
    shouldIgnore: output && output.shouldIgnore === true,
    reason: boundedString(output && output.reason, 120)
  });
}

function captureTestOnlyAcceptanceRawUnderstanding(output, input, metadata = {}) {
  const context = storage.getStore();
  const propertyId = boundedString(input && input.catalog && input.catalog.propertyId, 160).trim();
  if (!context || !propertyId || propertyId !== context.propertyId || context.snapshots.length >= 2) return null;
  const snapshot = rawUnderstandingSnapshot(output, metadata);
  context.snapshots.push(snapshot);
  return snapshot;
}

async function runWithTestOnlyAcceptanceRawUnderstanding({ propertyId } = {}, callback) {
  const exactPropertyId = boundedString(propertyId, 160).trim();
  if (!exactPropertyId || typeof callback !== "function") throw new TypeError("test-only acceptance raw understanding scope is required");
  return storage.run({ propertyId: exactPropertyId, snapshots: [] }, async () => {
    const value = await callback();
    const snapshots = Object.freeze(storage.getStore().snapshots.slice());
    return { value, rawUnderstandingSnapshots: snapshots };
  });
}

module.exports = {
  captureTestOnlyAcceptanceRawUnderstanding,
  runWithTestOnlyAcceptanceRawUnderstanding
};
