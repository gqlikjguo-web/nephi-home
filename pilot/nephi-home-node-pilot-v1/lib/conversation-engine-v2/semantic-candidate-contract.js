"use strict";

const crypto = require("node:crypto");
const { validateUnderstandingContext, evidenceMatchesSource, sourceEventMaps, evidenceRefsFailureCodes } = require("./understanding-validator");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMANTIC_CANDIDATE_COMPILED = Symbol("junzan.semanticCandidateCompiled");
const SEMANTIC_CANDIDATE_PROVENANCE = Symbol("junzan.semanticCandidateProvenance");
const SEMANTIC_CANDIDATE_LIFECYCLE = Symbol("junzan.semanticCandidateLifecycle");
const SEMANTIC_KINDS = new Set(["capability", "catalog_subject", "temporal_pattern", "lodging_scope"]);
const CAPABILITIES = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "lodging_product_capacity", "price", "total_price", "amenity", "amenity_list", "policy", "property_fact", "booking_request", "human_help", "high_risk", "unknown"]);
const DATE_KINDS = new Set(["absolute", "relative", "weekday", "weekend", "range", "contextual", "none"]);
const ANCHORS = new Set(["message_time", "previous_check_in", "previous_check_out", "none"]);
const MAX_CANDIDATES = 24;

function catalogIdentities(catalog) {
  return new Set(["rooms", "amenities", "policies", "faqs", "propertyFacts", "transportFacts"]
    .flatMap((key) => Array.isArray(catalog && catalog[key]) ? catalog[key] : [])
    .map((entity) => String(entity && entity.canonicalId || "").trim())
    .filter(Boolean));
}

function validEvidenceRefs(refs, input) {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 12) return false;
  const sourceMaps = sourceEventMaps(input && input.sourceEvents || []);
  return refs.every((ref) => ref && evidenceMatchesSource(ref, sourceMaps));
}

function validTemporalCandidate(value) {
  return value === null || Boolean(value && typeof value === "object" && !Array.isArray(value)
    && typeof value.rawText === "string" && value.rawText.length <= 200
    && DATE_KINDS.has(value.kind) && ANCHORS.has(value.anchor));
}

function validLodgingScope(value, identities) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value) || !UUID_PATTERN.test(String(value.scopeId || ""))) return false;
  const bundle = value.bundleCanonicalCandidate;
  const rooms = value.roomCanonicalCandidates;
  const guests = value.guestCountCandidate;
  return (bundle === null || typeof bundle === "string" && identities.has(bundle))
    && Array.isArray(rooms) && rooms.length <= 12 && new Set(rooms).size === rooms.length
    && rooms.every((id) => typeof id === "string" && identities.has(id))
    && (guests === null || Number.isInteger(guests) && guests >= 1 && guests <= 100);
}

function deterministicUuid(seed) {
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function compilerCompatibleCapability(taskType, capability) {
  return taskType === capability || new Set([taskType, capability]).size === 2
    && [taskType, capability].every((value) => ["availability", "bundle_availability"].includes(value));
}

function uniquelyOwnedStructuralCapability(candidate, tasks, verifiedRelations, sourceMaps) {
  if (!candidate || candidate.capability !== "unknown"
    || !["temporal_pattern", "lodging_scope"].includes(candidate.semanticKind)) return "";
  const provenance = candidate.provenanceRelationCandidateIndexes;
  if (!Array.isArray(provenance) || provenance.length !== 1) return "";
  const candidateIndex = provenance[0];
  const owners = tasks.filter((task) => task && task.candidateIndex === candidateIndex);
  if (owners.length !== 1 || !CAPABILITIES.has(owners[0].type) || owners[0].type === "unknown") return "";
  const relationEvidence = verifiedRelations.get(candidateIndex);
  if (!Array.isArray(relationEvidence) || !relationEvidence.length) return "";
  const candidateEvidence = Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [];
  if (!candidateEvidence.every((candidateRef) => relationEvidence.some((relationRef) =>
    compilerEvidenceOverlaps(candidateRef, relationRef, sourceMaps)))) return "";
  return owners[0].type;
}

function controlledPendingTask(candidate, tasks, verifiedRelations, identities) {
  if (!candidate || !CAPABILITIES.has(candidate.capability)) return null;
  const catalogIdentity = candidate.propertyCatalogIdentity;
  const canonicalIdentity = candidate.canonicalIdentityCandidate;
  const matches = tasks.filter((task) => {
    if (!verifiedRelations.has(task && task.candidateIndex)
      || !compilerCompatibleCapability(task && task.type, candidate.capability)) return false;
    if (catalogIdentity !== null && catalogIdentity !== undefined) {
      return typeof catalogIdentity === "string" && identities.has(catalogIdentity)
        && canonicalIdentity === catalogIdentity
        && String(task && task.entity && task.entity.canonicalCandidate || "") === catalogIdentity;
    }
    return candidate.semanticKind === "capability" && canonicalIdentity === candidate.capability;
  });
  return matches.length === 1 ? matches[0] : null;
}

function compilerEvidenceOverlaps(left, right, sourceMaps) {
  const byEvent = left && left.eventId ? sourceMaps.byEventId.get(String(left.eventId)) : null;
  const byMessage = left && left.messageRef ? sourceMaps.byMessageRef.get(String(left.messageRef)) : null;
  const source = byEvent || byMessage;
  const rightEvent = right && right.eventId ? sourceMaps.byEventId.get(String(right.eventId)) : null;
  const rightMessage = right && right.messageRef ? sourceMaps.byMessageRef.get(String(right.messageRef)) : null;
  if (!source || source !== (rightEvent || rightMessage)) return false;
  return Number.isInteger(left.startOffset) && Number.isInteger(left.endOffset)
    && Number.isInteger(right.startOffset) && Number.isInteger(right.endOffset)
    && left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function lodgingScopeMatchesCatalog(value, catalog) {
  if (value === null || !value || value.bundleCanonicalCandidate === null) return true;
  const rooms = Array.isArray(catalog && catalog.rooms) ? catalog.rooms : [];
  const bundle = rooms.find((room) => room && room.canonicalId === value.bundleCanonicalCandidate
    && (room.inventoryType === "bundle" || room.category === "bundle"));
  if (!bundle) return false;
  const memberRoomIds = new Set((Array.isArray(bundle.memberRoomIds) ? bundle.memberRoomIds : []).map(String));
  if (!value.roomCanonicalCandidates.every((roomId) => memberRoomIds.has(String(roomId)))) return false;
  return value.guestCountCandidate === null || !Number.isInteger(bundle.capacity)
    || value.guestCountCandidate <= bundle.capacity;
}

function normalizedRelatedLodgingScopes(rawCandidates, catalog, verifiedRelations, sourceMaps) {
  const normalized = rawCandidates.map((candidate) => candidate && candidate.lodgingScopeCandidate);
  const rooms = Array.isArray(catalog && catalog.rooms) ? catalog.rooms : [];
  const bundles = rooms.filter((room) => room && room.inventoryType === "bundle"
    && typeof room.canonicalId === "string" && Array.isArray(room.memberRoomIds));
  const evidenceFor = (candidate) => (Array.isArray(candidate && candidate.provenanceRelationCandidateIndexes)
    ? candidate.provenanceRelationCandidateIndexes.flatMap((index) => verifiedRelations.get(index) || [])
    : []);
  const compatible = (left, right) => JSON.stringify(stableValue(left && left.temporalSemanticCandidate)) === JSON.stringify(stableValue(right && right.temporalSemanticCandidate))
    && left.lodgingScopeCandidate.guestCountCandidate === right.lodgingScopeCandidate.guestCountCandidate
    && evidenceFor(left).some((leftRef) => evidenceFor(right).some((rightRef) => compilerEvidenceOverlaps(leftRef, rightRef, sourceMaps)));

  for (const bundle of bundles) {
    const bundleIndexes = rawCandidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => {
      const scope = candidate && candidate.lodgingScopeCandidate;
      return candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] !== true && scope
        && scope.bundleCanonicalCandidate === bundle.canonicalId;
    });
    if (bundleIndexes.length !== 1) continue;
    const bundleEntry = bundleIndexes[0];
    const memberIds = new Set(bundle.memberRoomIds.map(String));
    const memberEntries = rawCandidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => {
      const scope = candidate && candidate.lodgingScopeCandidate;
      return candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] !== true && scope
        && scope.bundleCanonicalCandidate === null
        && Array.isArray(scope.roomCanonicalCandidates) && scope.roomCanonicalCandidates.length === 1
        && memberIds.has(String(scope.roomCanonicalCandidates[0]))
        && compatible(bundleEntry.candidate, candidate);
    });
    if (!memberEntries.length) continue;
    const explicitRooms = [...new Set(memberEntries.flatMap(({ candidate }) => candidate.lodgingScopeCandidate.roomCanonicalCandidates))].sort();
    const unified = {
      bundleCanonicalCandidate: bundle.canonicalId,
      roomCanonicalCandidates: explicitRooms,
      guestCountCandidate: bundleEntry.candidate.lodgingScopeCandidate.guestCountCandidate
    };
    normalized[bundleEntry.index] = unified;
    for (const entry of memberEntries) normalized[entry.index] = unified;
  }
  return normalized;
}

function compileSemanticCandidates(output, input, { synthesizeMissingCandidates = false } = {}) {
  if (!output || !Array.isArray(output.tasks)) return output;
  const rawCandidates = Array.isArray(output.semanticCandidates)
    ? output.semanticCandidates
    : synthesizeMissingCandidates
      ? output.tasks.map((task) => {
        const relation = (output.contextRelationCandidates || []).find((item) => item && item.candidateIndex === task.candidateIndex);
        const canonicalIdentity = task && task.entity && task.entity.canonicalCandidate;
        const propertyCatalogIdentity = catalogIdentities(input && input.catalog).has(String(canonicalIdentity || ""))
          ? canonicalIdentity
          : null;
        const temporalCandidate = task && task.dependsOnStayContext
          ? (task.stayCandidate && task.stayCandidate.dateExpression) || (output.stay && output.stay.dateExpression)
          : null;
        return {
          semanticKind: "capability",
          capability: task && task.type,
          canonicalIdentityCandidate: canonicalIdentity || null,
          provenanceRelationCandidateIndexes: relation ? [relation.candidateIndex] : [],
          lodgingScopeCandidate: null,
          temporalSemanticCandidate: temporalCandidate || null,
          propertyCatalogIdentity
        };
      })
      : null;
  if (!rawCandidates) return output;
  const recompiledCandidateIds = new Set(rawCandidates
    .filter((candidate) => candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] === true)
    .map((candidate) => candidate.candidateId));
  const context = validateUnderstandingContext(output, input && input.contextSnapshot || { scope: {}, cycles: [] }, { sourceEvents: input && input.sourceEvents || [] });
  const verifiedRelations = context.ok
    ? new Map(context.relations.map((relation) => [relation.candidateIndex, relation.evidenceRefs.map((ref) => ({ ...ref }))]))
    : new Map();
  const identities = catalogIdentities(input && input.catalog);
  const sourceMaps = sourceEventMaps(input && input.sourceEvents || []);
  const normalizedScopes = normalizedRelatedLodgingScopes(rawCandidates, input && input.catalog, verifiedRelations, sourceMaps);
  const scopeIds = new Map();
  const candidateProvenanceIndexes = new Map();
  const candidates = rawCandidates.slice(0, MAX_CANDIDATES).map((rawCandidate, index) => {
    if (rawCandidate && rawCandidate[SEMANTIC_CANDIDATE_COMPILED] === true) {
      candidateProvenanceIndexes.set(rawCandidate.candidateId,
        Array.isArray(rawCandidate[SEMANTIC_CANDIDATE_PROVENANCE]) ? rawCandidate[SEMANTIC_CANDIDATE_PROVENANCE] : []);
      return rawCandidate;
    }
    const rawScope = normalizedScopes[index];
    const scope = rawScope && typeof rawScope === "object" && !Array.isArray(rawScope)
      ? { bundleCanonicalCandidate: rawScope.bundleCanonicalCandidate, roomCanonicalCandidates: rawScope.roomCanonicalCandidates, guestCountCandidate: rawScope.guestCountCandidate }
      : null;
    const scopeSignature = scope === null ? "" : JSON.stringify(stableValue(scope));
    const scopeId = scope === null ? null : (scopeIds.get(scopeSignature) || deterministicUuid(`scope:${scopeSignature}`));
    if (scope !== null) scopeIds.set(scopeSignature, scopeId);
    const provenance = rawCandidate && rawCandidate.provenanceRelationCandidateIndexes;
    const pendingCoverage = rawCandidate && rawCandidate.coverageStatus === "pending_task";
    const rawProvenanceIndexes = Array.isArray(provenance) && provenance.length >= 1 && provenance.length <= 12
      && provenance.every((value) => Number.isInteger(value) && value >= 0)
      && new Set(provenance).size === provenance.length
      ? provenance
      : [];
    const controlledTask = pendingCoverage
      ? controlledPendingTask(rawCandidate, output.tasks, verifiedRelations, identities)
      : null;
    const provenanceIndexes = controlledTask ? [controlledTask.candidateIndex] : rawProvenanceIndexes;
    const evidenceRefs = controlledTask
      ? verifiedRelations.get(controlledTask.candidateIndex).map((ref) => ({ ...ref }))
      : pendingCoverage
        ? (!provenanceIndexes.length && validEvidenceRefs(rawCandidate && rawCandidate.evidenceRefs, input)
          ? rawCandidate.evidenceRefs.map((ref) => ({ ...ref }))
          : [])
        : provenanceIndexes.length && provenanceIndexes.every((candidateIndex) => verifiedRelations.has(candidateIndex))
          ? provenanceIndexes.flatMap((candidateIndex) => verifiedRelations.get(candidateIndex).map((ref) => ({ ...ref })))
          : [];
    const structuralCapability = uniquelyOwnedStructuralCapability(rawCandidate, output.tasks, verifiedRelations, sourceMaps);
    const payload = {
      semanticKind: rawCandidate && rawCandidate.semanticKind,
      capability: structuralCapability || rawCandidate && rawCandidate.capability,
      canonicalIdentityCandidate: rawCandidate && rawCandidate.canonicalIdentityCandidate,
      evidenceRefs,
      lodgingScopeCandidate: scope,
      temporalSemanticCandidate: rawCandidate && rawCandidate.temporalSemanticCandidate,
      propertyCatalogIdentity: rawCandidate && rawCandidate.propertyCatalogIdentity
    };
    const candidateId = deterministicUuid(`candidate:${JSON.stringify(stableValue(payload))}:provenance:${JSON.stringify(provenanceIndexes)}`);
    candidateProvenanceIndexes.set(candidateId, provenanceIndexes);
    const compiledCandidate = { ...payload, candidateId, lodgingScopeCandidate: scope === null ? null : { scopeId, ...scope } };
    Object.defineProperty(compiledCandidate, SEMANTIC_CANDIDATE_COMPILED, { enumerable: false, value: true });
    Object.defineProperty(compiledCandidate, SEMANTIC_CANDIDATE_PROVENANCE, { enumerable: false, value: Object.freeze([...provenanceIndexes]) });
    Object.defineProperty(compiledCandidate, SEMANTIC_CANDIDATE_LIFECYCLE, { enumerable: false, value: pendingCoverage && !controlledTask ? "pending_task" : "bound" });
    return compiledCandidate;
  });
  const validCandidates = validateSemanticCandidates({ semanticCandidates: candidates }, input).validCandidates;
  const relations = Array.isArray(output.contextRelationCandidates) ? output.contextRelationCandidates : [];
  const pendingTaskMatches = new Map(validCandidates.map((candidate) => [candidate.candidateId,
    candidate[SEMANTIC_CANDIDATE_LIFECYCLE] === "pending_task" && recompiledCandidateIds.has(candidate.candidateId)
      ? output.tasks.filter((task) => {
        const relation = relations.find((item) => item && item.candidateIndex === task.candidateIndex);
        return compilerCompatibleCapability(task && task.type, candidate.capability)
          && (!candidate.propertyCatalogIdentity || String(task && task.entity && task.entity.canonicalCandidate || "") === candidate.propertyCatalogIdentity)
          && relation && validEvidenceRefs(relation.evidenceRefs, input)
          && candidate.evidenceRefs.every((candidateRef) => relation.evidenceRefs.some((taskRef) => compilerEvidenceOverlaps(candidateRef, taskRef, sourceMaps)));
      })
      : []]));
  const tasks = output.tasks.map((task) => {
    const relation = relations.find((item) => item && item.candidateIndex === task.candidateIndex);
    const matching = validCandidates.filter((candidate) => compilerCompatibleCapability(task && task.type, candidate.capability)
      && (!candidate.propertyCatalogIdentity || String(task && task.entity && task.entity.canonicalCandidate || "") === candidate.propertyCatalogIdentity)
      && (candidateProvenanceIndexes.get(candidate.candidateId).includes(task && task.candidateIndex)
        || pendingTaskMatches.get(candidate.candidateId).length === 1 && pendingTaskMatches.get(candidate.candidateId)[0] === task)
      && relation && validEvidenceRefs(relation.evidenceRefs, input)
      && candidate.evidenceRefs.every((candidateRef) => relation.evidenceRefs.some((taskRef) => compilerEvidenceOverlaps(candidateRef, taskRef, sourceMaps))));
    const scopes = [...new Set(matching
      .map((candidate) => String(candidate.lodgingScopeCandidate && candidate.lodgingScopeCandidate.scopeId || ""))
      .filter(Boolean))];
    const scopeId = scopes.length === 1 ? scopes[0] : "";
    const owned = scopes.length <= 1 ? matching : [];
    return { ...task, semanticCandidateIds: owned.map((candidate) => candidate.candidateId), lodgingScopeId: scopeId || null };
  });
  return { ...output, tasks, semanticCandidates: candidates };
}
function validateSemanticCandidates(output, input) {
  if (!output || !Array.isArray(output.semanticCandidates)) return { present: false, validCandidates: [], invalidCandidateIds: [] };
  const identities = catalogIdentities(input && input.catalog);
  const counts = new Map();
  for (const candidate of output.semanticCandidates) {
    const id = String(candidate && candidate.candidateId || "");
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const scopeSignatures = new Map();
  const conflictingScopeIds = new Set();
  for (const candidate of output.semanticCandidates) {
    const scope = candidate && candidate.lodgingScopeCandidate;
    if (!scope || !UUID_PATTERN.test(String(scope.scopeId || ""))) continue;
    const signature = JSON.stringify(scope);
    if (scopeSignatures.has(scope.scopeId) && scopeSignatures.get(scope.scopeId) !== signature) conflictingScopeIds.add(scope.scopeId);
    else scopeSignatures.set(scope.scopeId, signature);
  }
  const validCandidates = [];
  const invalidCandidateIds = [];
  const invalidFailureCodes = new Set();
  for (const candidate of output.semanticCandidates.slice(0, MAX_CANDIDATES)) {
    const candidateId = String(candidate && candidate.candidateId || "");
    const catalogIdentity = candidate && candidate.propertyCatalogIdentity;
    const canonicalIdentity = candidate && candidate.canonicalIdentityCandidate;
    const valid = Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)
      && UUID_PATTERN.test(candidateId) && counts.get(candidateId) === 1
      && SEMANTIC_KINDS.has(candidate.semanticKind) && CAPABILITIES.has(candidate.capability)
      && (canonicalIdentity === null || typeof canonicalIdentity === "string" && canonicalIdentity.length <= 120)
      && (catalogIdentity === null || typeof catalogIdentity === "string" && identities.has(catalogIdentity))
      && (!catalogIdentity || canonicalIdentity === catalogIdentity)
      && validEvidenceRefs(candidate.evidenceRefs, input)
      && validLodgingScope(candidate.lodgingScopeCandidate, identities)
      && lodgingScopeMatchesCatalog(candidate.lodgingScopeCandidate, input && input.catalog)
      && !(candidate.lodgingScopeCandidate && conflictingScopeIds.has(candidate.lodgingScopeCandidate.scopeId))
      && validTemporalCandidate(candidate.temporalSemanticCandidate));
    if (valid) validCandidates.push(candidate);
    else {
      for (const code of semanticCandidateFailureCodes(candidate, identities, counts, conflictingScopeIds, input, { requireCandidateId: true })) invalidFailureCodes.add(code);
      if (candidateId) invalidCandidateIds.push(candidateId);
    }
  }
  if (output.semanticCandidates.length > MAX_CANDIDATES) {
    invalidCandidateIds.push(...output.semanticCandidates.slice(MAX_CANDIDATES).map((item) => String(item && item.candidateId || "")).filter(Boolean));
    invalidFailureCodes.add("candidate_count_limit");
  }
  return { present: true, validCandidates, invalidCandidateIds: [...new Set(invalidCandidateIds)], invalidFailureCodes: [...invalidFailureCodes].sort() };
}

function semanticCandidateFailureCodes(candidate, identities, counts, conflictingScopeIds, input, { requireCandidateId }) {
  const codes = [];
  const candidateId = String(candidate && candidate.candidateId || "");
  const catalogIdentity = candidate && candidate.propertyCatalogIdentity;
  const canonicalIdentity = candidate && candidate.canonicalIdentityCandidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return ["candidate_object"];
  if (requireCandidateId && (!UUID_PATTERN.test(candidateId) || counts.get(candidateId) !== 1)) codes.push("candidate_id");
  if (!SEMANTIC_KINDS.has(candidate.semanticKind)) codes.push("semantic_kind");
  if (!CAPABILITIES.has(candidate.capability)) codes.push("capability");
  if (!(canonicalIdentity === null || typeof canonicalIdentity === "string" && canonicalIdentity.length <= 120)) codes.push("canonical_identity");
  if (!(catalogIdentity === null || typeof catalogIdentity === "string" && identities.has(catalogIdentity))) codes.push("property_catalog_identity");
  if (catalogIdentity && canonicalIdentity !== catalogIdentity) codes.push("identity_alignment");
  if (!validEvidenceRefs(candidate.evidenceRefs, input)) codes.push("evidence_refs");
  if (!validLodgingScope(candidate.lodgingScopeCandidate, identities)) codes.push("lodging_scope");
  else if (!lodgingScopeMatchesCatalog(candidate.lodgingScopeCandidate, input && input.catalog)) codes.push("lodging_scope_catalog_conflict");
  if (candidate.lodgingScopeCandidate && conflictingScopeIds.has(candidate.lodgingScopeCandidate.scopeId)) codes.push("lodging_scope_conflict");
  if (!validTemporalCandidate(candidate.temporalSemanticCandidate)) codes.push("temporal_candidate");
  return codes;
}

function diagnosticProvenance(candidate, originCandidate) {
  const source = originCandidate && typeof originCandidate === "object" ? originCandidate : candidate;
  const provenancePresent = Boolean(source && Object.hasOwn(source, "provenanceRelationCandidateIndexes"));
  const rawProvenance = provenancePresent
    ? source.provenanceRelationCandidateIndexes
    : candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] === true
      ? candidate[SEMANTIC_CANDIDATE_PROVENANCE]
      : undefined;
  const provenanceCount = Array.isArray(rawProvenance) ? Math.min(rawProvenance.length, 12) : 0;
  const provenanceRelationCandidateIndexes = Array.isArray(rawProvenance)
    ? rawProvenance.slice(0, 12).filter((value) => Number.isInteger(value) && value >= 0)
    : [];
  return { provenancePresent, provenanceCount, provenanceRelationCandidateIndexes };
}

function diagnosticLifecycle(candidate, originCandidate) {
  const compiledLifecycle = candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] === true
    ? candidate[SEMANTIC_CANDIDATE_LIFECYCLE]
    : "";
  const coverageStatus = originCandidate && ["bound", "pending_task"].includes(originCandidate.coverageStatus)
    ? originCandidate.coverageStatus
    : candidate && ["bound", "pending_task"].includes(candidate.coverageStatus)
      ? candidate.coverageStatus
      : ["bound", "pending_task"].includes(compiledLifecycle) ? compiledLifecycle : "unknown";
  return {
    coverageStatus,
    lifecycle: ["bound", "pending_task"].includes(compiledLifecycle) ? compiledLifecycle : coverageStatus
  };
}

function diagnosticRelationState(originOutput, input, provenanceIndexes) {
  const relations = Array.isArray(originOutput && originOutput.contextRelationCandidates)
    ? originOutput.contextRelationCandidates
    : [];
  const context = validateUnderstandingContext(originOutput, input && input.contextSnapshot || { scope: {}, cycles: [] }, { sourceEvents: input && input.sourceEvents || [] });
  const verifiedIndexes = new Set(context.ok && Array.isArray(context.relations)
    ? context.relations.map((relation) => relation.candidateIndex)
    : []);
  return provenanceIndexes.map((candidateIndex) => {
    const matches = relations.filter((relation) => relation && relation.candidateIndex === candidateIndex);
    const relation = matches.length === 1 ? matches[0] : null;
    const evidenceFailureCodes = relation
      ? evidenceRefsFailureCodes(relation.evidenceRefs, input && input.sourceEvents || [])
      : [];
    const relationExists = Boolean(relation);
    const relationEvidenceValid = relationExists && evidenceFailureCodes.length === 0;
    return Object.freeze({
      candidateIndex,
      relationExists,
      relationContextValid: relationExists && verifiedIndexes.has(candidateIndex),
      relationEvidenceValid,
      evidenceFailureCodes: Object.freeze([...evidenceFailureCodes])
    });
  });
}

function missingRefsDiagnosticReason({ lifecycle, provenancePresent, provenanceCount, provenanceIndexes, provenanceRelations, originCandidate, candidate, input }) {
  const currentEvidenceFailures = evidenceRefsFailureCodes(candidate && candidate.evidenceRefs, input && input.sourceEvents || []);
  if (!currentEvidenceFailures.includes("missing_refs")) return "";
  if (lifecycle === "pending_task") {
    const rawEvidenceFailures = evidenceRefsFailureCodes(originCandidate && originCandidate.evidenceRefs, input && input.sourceEvents || []);
    return rawEvidenceFailures.length ? "pending_invalid_raw_evidence" : "compiled_evidence_lost";
  }
  if (lifecycle !== "bound") return "other";
  if (!provenancePresent || provenanceCount === 0) return "bound_missing_provenance";
  if (provenanceIndexes.length !== provenanceCount) return "other";
  if (provenanceRelations.some((relation) => !relation.relationExists)) return "bound_unknown_provenance_relation";
  if (provenanceRelations.some((relation) => !relation.relationEvidenceValid)) return "bound_relation_evidence_invalid";
  if (provenanceRelations.some((relation) => !relation.relationContextValid)) return "bound_relation_context_invalid";
  return "compiled_evidence_lost";
}

function semanticCandidateDiagnosticSummary(output, input, { raw = false, includeCandidates = false, originOutput = null } = {}) {
  const candidates = Array.isArray(output && output.semanticCandidates) ? output.semanticCandidates.slice(0, MAX_CANDIDATES) : [];
  const identities = catalogIdentities(input && input.catalog);
  const counts = new Map();
  for (const candidate of candidates) {
    const candidateId = String(candidate && candidate.candidateId || "");
    counts.set(candidateId, (counts.get(candidateId) || 0) + 1);
  }
  const scopeSignatures = new Map();
  const conflictingScopeIds = new Set();
  for (const candidate of candidates) {
    const scope = candidate && candidate.lodgingScopeCandidate;
    if (!scope || !UUID_PATTERN.test(String(scope.scopeId || ""))) continue;
    const signature = JSON.stringify(scope);
    if (scopeSignatures.has(scope.scopeId) && scopeSignatures.get(scope.scopeId) !== signature) conflictingScopeIds.add(scope.scopeId);
    else scopeSignatures.set(scope.scopeId, signature);
  }
  const ledger = raw ? null : validateSemanticCandidates(output, input);
  const rawFailureCodes = raw ? [...new Set(candidates.flatMap((candidate) =>
    semanticCandidateFailureCodes(candidate, identities, counts, new Set(), input, { requireCandidateId: false })))].sort() : [];
  const ownershipCount = (Array.isArray(output && output.tasks) ? output.tasks : [])
    .reduce((count, task) => count + (Array.isArray(task && task.semanticCandidateIds) ? task.semanticCandidateIds.length : 0), 0);
  const evidenceFailureCodes = [...new Set(candidates.flatMap((candidate) =>
    evidenceRefsFailureCodes(candidate && candidate.evidenceRefs, input && input.sourceEvents || [])))].sort();
  const summary = {
    candidateCount: candidates.length,
    validCandidateCount: raw ? Math.max(0, candidates.length - (rawFailureCodes.length ? candidates.length : 0)) : ledger.validCandidates.length,
    invalidCandidateCount: raw ? (rawFailureCodes.length ? candidates.length : 0) : ledger.invalidCandidateIds.length,
    ownershipCount: Math.min(ownershipCount, MAX_CANDIDATES),
    failureCodes: Object.freeze(raw ? rawFailureCodes : (ledger.invalidFailureCodes || [])),
    evidenceFailureCodes: Object.freeze(evidenceFailureCodes)
  };
  if (!includeCandidates) return Object.freeze(summary);
  const diagnosticOrigin = originOutput && typeof originOutput === "object" ? originOutput : output;
  const originCandidates = Array.isArray(diagnosticOrigin && diagnosticOrigin.semanticCandidates)
    ? diagnosticOrigin.semanticCandidates.slice(0, MAX_CANDIDATES)
    : [];
  const candidateDiagnostics = candidates.map((candidate, candidateOrdinal) => {
    const originCandidate = originCandidates[candidateOrdinal] || candidate;
    const { coverageStatus, lifecycle } = diagnosticLifecycle(candidate, originCandidate);
    const { provenancePresent, provenanceCount, provenanceRelationCandidateIndexes } = diagnosticProvenance(candidate, originCandidate);
    const provenanceRelations = diagnosticRelationState(diagnosticOrigin, input, provenanceRelationCandidateIndexes);
    const candidateFailureCodes = semanticCandidateFailureCodes(candidate, identities, counts, conflictingScopeIds, input, { requireCandidateId: !raw });
    return Object.freeze({
      candidateOrdinal,
      coverageStatus,
      lifecycle,
      provenancePresent,
      provenanceCount,
      provenanceRelationCandidateIndexes: Object.freeze([...provenanceRelationCandidateIndexes]),
      verifiedRelationCount: provenanceRelations.filter((relation) => relation.relationContextValid).length,
      evidenceRefCount: Array.isArray(candidate && candidate.evidenceRefs) ? Math.min(candidate.evidenceRefs.length, 12) : 0,
      valid: candidateFailureCodes.length === 0,
      failureCodes: Object.freeze([...candidateFailureCodes]),
      missingRefsReason: missingRefsDiagnosticReason({
        lifecycle,
        provenancePresent,
        provenanceCount,
        provenanceIndexes: provenanceRelationCandidateIndexes,
        provenanceRelations,
        originCandidate,
        candidate,
        input
      }),
      provenanceRelations: Object.freeze(provenanceRelations)
    });
  });
  return Object.freeze({ ...summary, candidates: Object.freeze(candidateDiagnostics) });
}

function evidenceSource(ref, sourceMaps) {
  const byEvent = ref && ref.eventId ? sourceMaps.byEventId.get(String(ref.eventId)) : null;
  const byMessage = ref && ref.messageRef ? sourceMaps.byMessageRef.get(String(ref.messageRef)) : null;
  if (byEvent && byMessage && byEvent !== byMessage) return null;
  return byEvent || byMessage || null;
}

function evidenceOverlaps(left, right, sourceMaps) {
  const source = evidenceSource(left, sourceMaps);
  if (!source || source !== evidenceSource(right, sourceMaps)) return false;
  return Number.isInteger(left.startOffset) && Number.isInteger(left.endOffset)
    && Number.isInteger(right.startOffset) && Number.isInteger(right.endOffset)
    && left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function compatibleCapability(taskType, capability) {
  if (taskType === capability) return true;
  return new Set([taskType, capability]).size === 2
    && [taskType, capability].every((value) => ["availability", "bundle_availability"].includes(value));
}

function taskOwnsCandidate(output, input, task, candidate) {
  if (!task || !Array.isArray(task.semanticCandidateIds) || !task.semanticCandidateIds.includes(candidate.candidateId)
    || !compatibleCapability(task.type, candidate.capability)) return false;
  if (candidate.propertyCatalogIdentity
    && String(task.entity && task.entity.canonicalCandidate || "") !== candidate.propertyCatalogIdentity) return false;
  const scopeId = String(candidate.lodgingScopeCandidate && candidate.lodgingScopeCandidate.scopeId || "");
  if (scopeId && String(task.lodgingScopeId || "") !== scopeId) return false;
  const relations = (output.contextRelationCandidates || []).filter((relation) => relation && relation.candidateIndex === task.candidateIndex);
  if (relations.length !== 1 || !validEvidenceRefs(relations[0].evidenceRefs, input)) return false;
  const sourceMaps = sourceEventMaps(input && input.sourceEvents || []);
  return candidate.evidenceRefs.every((candidateRef) =>
    relations[0].evidenceRefs.some((taskRef) => evidenceOverlaps(candidateRef, taskRef, sourceMaps)));
}

function missingSemanticCandidates(output, input, candidates) {
  return candidates.filter((candidate) => !(output.tasks || []).some((task) => taskOwnsCandidate(output, input, task, candidate)));
}

function lifecycleCandidateSignature(candidate) {
  if (!candidate || typeof candidate !== "object") return "";
  const { candidateId, evidenceRefs, ...semantic } = candidate;
  return JSON.stringify(stableValue(semantic));
}

function verifiedRepairTask(repairOutput, input, candidate) {
  if (!repairOutput || !Array.isArray(repairOutput.tasks)
    || candidate && candidate[SEMANTIC_CANDIDATE_COMPILED] === true
      && candidate[SEMANTIC_CANDIDATE_LIFECYCLE] !== "pending_task") return null;
  const directMatches = repairOutput.tasks.filter((task) => Array.isArray(task && task.semanticCandidateIds)
    && task.semanticCandidateIds.includes(candidate.candidateId)
    && taskOwnsCandidate(repairOutput, input, task, candidate));
  const repairCandidates = Array.isArray(repairOutput.semanticCandidates) ? repairOutput.semanticCandidates : [];
  const sourceMaps = sourceEventMaps(input && input.sourceEvents || []);
  const continuityCandidates = directMatches.length ? [] : repairCandidates.filter((repairCandidate) =>
    lifecycleCandidateSignature(repairCandidate) === lifecycleCandidateSignature(candidate)
    && candidate.evidenceRefs.every((pendingRef) => repairCandidate.evidenceRefs.some((repairRef) => evidenceOverlaps(pendingRef, repairRef, sourceMaps))));
  const matches = directMatches.length ? directMatches : continuityCandidates.length === 1
    ? repairOutput.tasks.filter((task) => Array.isArray(task && task.semanticCandidateIds)
      && task.semanticCandidateIds.includes(continuityCandidates[0].candidateId)
      && taskOwnsCandidate(repairOutput, input, task, continuityCandidates[0]))
    : [];
  if (matches.length !== 1) return null;
  const matchedCandidateId = directMatches.length ? candidate.candidateId : continuityCandidates[0].candidateId;
  const canonicalizationResults = repairOutput.repairCanonicalizationResult;
  if (!Array.isArray(canonicalizationResults) || !Object.isFrozen(canonicalizationResults)) return null;
  const canonicalizationMatches = canonicalizationResults.filter((result) => result
    && Object.isFrozen(result)
    && result.taskId === matches[0].taskId
    && result.candidateId === matchedCandidateId);
  if (canonicalizationMatches.length !== 1 || canonicalizationMatches[0].unique !== true
    || typeof canonicalizationMatches[0].canonicalIdentity !== "string" || !canonicalizationMatches[0].canonicalIdentity
    || candidate.propertyCatalogIdentity && canonicalizationMatches[0].canonicalIdentity !== candidate.propertyCatalogIdentity
    || ["capability", "temporal_pattern"].includes(candidate.semanticKind)
      && canonicalizationMatches[0].canonicalIdentity !== candidate.canonicalIdentityCandidate) return null;
  const relations = (repairOutput.contextRelationCandidates || []).filter((relation) => relation && relation.candidateIndex === matches[0].candidateIndex);
  const task = directMatches.length ? matches[0] : { ...matches[0], semanticCandidateIds: [candidate.candidateId] };
  return relations.length === 1 ? { task, relation: relations[0] } : null;
}

module.exports = {
  MAX_CANDIDATES,
  SEMANTIC_KINDS,
  compileSemanticCandidates,
  validateSemanticCandidates,
  semanticCandidateDiagnosticSummary,
  missingSemanticCandidates,
  verifiedRepairTask
};
