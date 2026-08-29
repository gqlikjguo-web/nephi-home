"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { NEW_CORE_OPENAI_MODEL } = require("../lib/new-core/openai-model-authority");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1
} = require("../lib/providers/openai-understanding-v1");
const { assembleReadOnlyShadowComparison } = require("../lib/new-core/shadow-core");

const PROPERTY_ID = "task14-shadow-property";
const EMPTY_OLD_CORE_SUMMARY = Object.freeze({ semanticUnits: [], routes: [], lifecycles: [], canonicalItems: [] });
const ZERO_COUNTERS = Object.freeze({
  stateWrites: 0, messageWrites: 0, reviewWrites: 0,
  resolverCalls: 0, postgresMutations: 0, lineCalls: 0
});
const CASES = Object.freeze([
  { id: "AC-PRD-001", input: "好", minimumAcceptedRuns: 5, expected: "單純確認，不回覆" },
  { id: "AC-PRD-002", input: "了解，謝謝您", minimumAcceptedRuns: 5, expected: "單純確認與致謝，不回覆" },
  { id: "AC-PRD-003", input: "有開車,感謝留車位, 我們只有四位,謝謝!!", minimumAcceptedRuns: 5, expected: "補充交通與四位入住資訊，不產生可執行回覆" },
  { id: "AC-PRD-004", input: "你好 想問明年二月的4～7 有開放訂房了嗎", minimumAcceptedRuns: 5, expected: "理解為住宿房況與日期範圍，不改寫為設施或旅宿事實" },
  { id: "AC-PRD-005", input: "想了解包棟的", minimumAcceptedRuns: 5, expected: "承接上一輪房況日期並限定包棟，或安全追問" },
  { id: "AC-OAI-001", input: "好的，謝謝您", minimumAcceptedRuns: 5, expected: "單純確認與致謝，不回覆" },
  { id: "AC-OAI-002", input: "請問 2026/10/09 到 10/10 包棟還可以預訂嗎？", minimumAcceptedRuns: 5, expected: "理解為指定日期的包棟房況查詢" },
  { id: "AC-OAI-003", input: "想了解包棟價格", minimumAcceptedRuns: 5, expected: "理解為包棟價格；缺日期時追問日期" }
]);

function hash(value) {
  return `h:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function event(id, role, messageText, referenceableCycleIds = []) {
  return {
    eventId: id, messageRef: `message-${id}`, role,
    timestamp: "2026-08-29T08:00:00.000Z", messageKind: "text", messageText,
    referenceableCycleIds
  };
}

function caseContext(caseId) {
  if (caseId === "AC-PRD-005") return {
    recentConversation: [event("prd004", "guest", CASES[3].input, ["cycle-prd-004"])],
    referenceableCycles: [{
      propertyId: PROPERTY_ID, requestCycleId: "cycle-prd-004", status: "active",
      requestKind: "availability", capability: "availability",
      expiresAt: "2026-08-30T08:00:00.000Z",
      subject: { kind: "property", catalogIdentity: null }, missingFields: [],
      confirmedValues: { checkIn: "2027-02-04", checkOut: "2027-02-07", guestCount: null, searchFrom: null, searchTo: null },
      slotRefs: ["temporal"]
    }]
  };
  if (caseId === "AC-PRD-003") return {
    recentConversation: [event("prd003-prior", "guest", "我們準備入住", ["cycle-prd-003"])],
    referenceableCycles: [{
      propertyId: PROPERTY_ID, requestCycleId: "cycle-prd-003", status: "active",
      requestKind: "availability", capability: "availability",
      expiresAt: "2026-08-30T08:00:00.000Z",
      subject: { kind: "property", catalogIdentity: null }, missingFields: ["checkIn", "checkOut"],
      confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
      slotRefs: []
    }]
  };
  return { recentConversation: [], referenceableCycles: [] };
}

function buildCaseInput(caseDefinition, runNumber) {
  const context = caseContext(caseDefinition.id);
  const suffix = `${caseDefinition.id.toLowerCase()}-${runNumber}`;
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1", traceId: `task14-trace-${suffix}`, turnId: `task14-turn-${suffix}`,
    verifiedPropertyBinding: { propertyId: PROPERTY_ID, channel: "task14-shadow" },
    verifiedConversationScope: { channel: "task14-shadow", userId: "task14-guest" },
    sourceEvents: [{
      eventId: `event-${suffix}`, messageRef: `message-${suffix}`, role: "guest",
      timestamp: "2026-08-29T08:05:00.000Z", messageKind: "text", messageText: caseDefinition.input
    }],
    recentConversation: context.recentConversation,
    stateV3Snapshot: { scope: { propertyId: PROPERTY_ID }, referenceableCycles: context.referenceableCycles },
    publicCatalog: {
      propertyId: PROPERTY_ID, timezone: "Asia/Taipei",
      capabilityCatalog: [
        "availability", "available_dates", "price", "total_price", "capacity", "property_fact",
        "amenity", "policy", "location", "booking_operator_request", "high_risk", "unsupported"
      ],
      publicSubjectCatalog: [
        { propertyId: PROPERTY_ID, catalogIdentity: "property-main", kind: "property", publicName: "本館" },
        { propertyId: PROPERTY_ID, catalogIdentity: "bundle-main", kind: "bundle", publicName: "包棟" },
        { propertyId: PROPERTY_ID, catalogIdentity: "room-main", kind: "room", publicName: "客房" },
        { propertyId: PROPERTY_ID, catalogIdentity: "amenity-parking", kind: "amenity", publicName: "停車位" }
      ]
    }
  });
}

function validateRunConfiguration({ apiKey, coreSha }) {
  if (!String(apiKey || "").trim()) throw new Error("OPENAI_TEST_API_KEY_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(String(coreSha || ""))) throw new Error("TASK14_CORE_SHA_REQUIRED");
  return { minimumAcceptedCalls: 40, requestedModel: NEW_CORE_OPENAI_MODEL, coreSha };
}

function rawUnitProjection(unit) {
  return {
    unitIdHash: hash(unit.unitId), purpose: unit.purpose, capability: unit.capability,
    subjectKind: unit.subject && unit.subject.kind,
    subjectIdentityHash: unit.subject && unit.subject.catalogIdentity ? hash(unit.subject.catalogIdentity) : null,
    stayDependent: unit.stayDependent, temporalCandidate: unit.temporalCandidate,
    safetyCandidate: unit.safetyCandidate,
    slotCandidates: unit.slotCandidates
  };
}

function controlledUnitProjection(unit, understanding, c10) {
  const keyHash = hash(unit.unitId);
  const link = understanding.validatedContextLinks.find((item) => item.unitId === unit.unitId);
  const find = (field) => c10.newCoreSummary[field].find((item) => item.keyHash === keyHash);
  const route = find("routes");
  const lifecycle = find("lifecycles");
  return {
    purpose: unit.purpose, capability: unit.capability, subjectKind: unit.subject.kind,
    stayDependent: unit.stayDependent, temporalCandidate: unit.temporalCandidate,
    contextAction: link ? link.actionCandidate : null,
    lifecycle: lifecycle ? lifecycle.action : null,
    replyDisposition: route ? route.disposition : null,
    c08Owned: Boolean(find("canonicalItems"))
  };
}

function semanticShape(run) {
  return run.rawUnits.map((unit) => [
    unit.purpose, unit.capability, unit.subjectKind, unit.stayDependent,
    unit.safetyCandidate && (unit.safetyCandidate.operatorActionClass || unit.safetyCandidate.riskClass)
  ].map((value) => value === null ? "null" : String(value)).join("|")).sort().join(";") || "NO_RAW_UNIT";
}

function zeroSideEffects(value) {
  return value && Object.keys(ZERO_COUNTERS).every((key) => value[key] === 0)
    && Object.keys(value).length === Object.keys(ZERO_COUNTERS).length;
}

function rawMeaningMatches(caseId, rawUnits, rawLinks = []) {
  const noDanger = rawUnits.every((unit) => !["high_risk", "policy", "property_fact", "unsupported"].includes(unit.capability));
  if (["AC-PRD-001", "AC-PRD-002", "AC-OAI-001"].includes(caseId)) {
    return rawUnits.length > 0 && rawUnits.every((unit) => unit.purpose === "acknowledgement"
      && unit.capability === null && unit.safetyCandidate === null);
  }
  if (caseId === "AC-PRD-003") return noDanger && rawUnits.some((unit) => ["supplement", "context_update"].includes(unit.purpose)
    && unit.capability === null && unit.safetyCandidate === null
    && unit.slotCandidates.some((slot) => slot.slot === "guest_count" && slot.value === 4)
    && unit.slotCandidates.some((slot) => slot.slot === "transport"));
  if (caseId === "AC-PRD-004") return noDanger && rawUnits.some((unit) => ["availability", "available_dates"].includes(unit.capability)
    && unit.stayDependent && unit.temporalCandidate);
  if (caseId === "AC-PRD-005") return noDanger && rawUnits.some((unit) => unit.subjectKind === "bundle"
    && rawLinks.some((link) => link.unitIdHash === unit.unitIdHash
      && ["CONTINUE", "MODIFY"].includes(link.actionCandidate)));
  if (caseId === "AC-OAI-002") return rawUnits.some((unit) => unit.capability === "availability"
    && unit.subjectKind === "bundle" && unit.stayDependent && unit.temporalCandidate
    && unit.temporalCandidate.checkInCandidate && unit.temporalCandidate.checkOutCandidate);
  if (caseId === "AC-OAI-003") return rawUnits.some((unit) => unit.capability === "price"
    && unit.subjectKind === "bundle" && unit.stayDependent && unit.temporalCandidate === null);
  return false;
}

function controlledBehaviorMatches(caseId, units) {
  if (["AC-PRD-001", "AC-PRD-002", "AC-OAI-001"].includes(caseId)) return units.length > 0
    && units.every((unit) => unit.purpose === "acknowledgement" && unit.lifecycle === "NONE"
      && unit.replyDisposition === "NO_REPLY" && !unit.c08Owned);
  if (caseId === "AC-PRD-003") return units.some((unit) => ["supplement", "context_update"].includes(unit.purpose)
    && unit.replyDisposition === "NO_REPLY" && !unit.c08Owned);
  if (caseId === "AC-PRD-004") return units.some((unit) => ["availability", "available_dates"].includes(unit.capability)
    && unit.replyDisposition !== "HANDOFF" && unit.replyDisposition !== "NO_REPLY");
  if (caseId === "AC-PRD-005") return units.some((unit) => unit.subjectKind === "bundle"
    && (["CONTINUE", "MODIFY"].includes(unit.contextAction) || unit.replyDisposition === "CLARIFY"));
  if (caseId === "AC-OAI-002") return units.some((unit) => unit.capability === "availability"
    && unit.subjectKind === "bundle" && unit.replyDisposition === "ANSWER" && unit.c08Owned);
  if (caseId === "AC-OAI-003") return units.some((unit) => unit.capability === "price"
    && unit.subjectKind === "bundle" && unit.replyDisposition === "CLARIFY" && !unit.c08Owned);
  return false;
}

function classifyRun(caseDefinition, run) {
  if (run.requestedModel !== NEW_CORE_OPENAI_MODEL || run.resolvedModel !== NEW_CORE_OPENAI_MODEL) {
    return { accepted: false, classification: "MODEL_IDENTITY_MISMATCH", plainReason: "實際請求或回應模型不是 Luna，本次不計入驗收" };
  }
  if (!run.propertyIsolation || !zeroSideEffects(run.sideEffectCounters)) {
    return { accepted: true, classification: "OTHER_RUNTIME_FAILURE", plainReason: "Shadow 隔離或零副作用證據失敗" };
  }
  if (!Array.isArray(run.rawUnits) || run.rawUnits.length === 0) {
    return { accepted: true, classification: "OTHER_RUNTIME_FAILURE", plainReason: "OpenAI 回應未產生可審查的理解單元" };
  }
  if (!rawMeaningMatches(caseDefinition.id, run.rawUnits, run.rawLinks)) {
    return { accepted: true, classification: "OPENAI_UNDERSTANDING_ERROR", plainReason: "OpenAI 對客人意思、能力、主體、日期或回覆意圖的理解不符合產品預期" };
  }
  if (run.failureCodes.length || !controlledBehaviorMatches(caseDefinition.id, run.units)) {
    return { accepted: true, classification: "CONTRACT_TOO_NARROW", plainReason: "OpenAI 意思正確，但現有 C03-C09 未接受或未形成預期安全處理" };
  }
  return { accepted: true, classification: "PASS", plainReason: "產品語意與安全處理符合預期" };
}

function understandingText(run) {
  const counts = {};
  for (const unit of run.rawUnits) {
    const safety = unit.safetyCandidate && (unit.safetyCandidate.operatorActionClass || unit.safetyCandidate.riskClass) || "無 safety";
    const shape = `${unit.purpose}/${unit.capability || "無 capability"}/${unit.subjectKind || "無 subject"}/${safety}`;
    counts[shape] = (counts[shape] || 0) + 1;
  }
  return Object.entries(counts).map(([shape, count]) => `${shape}×${count}`).join("；") || "沒有可審查理解";
}

function actionText(run) {
  const counts = {};
  for (const unit of run.units) {
    const shape = `${unit.lifecycle}/${unit.replyDisposition}/C08=${unit.c08Owned ? "YES" : "NO"}`;
    counts[shape] = (counts[shape] || 0) + 1;
  }
  return Object.entries(counts).map(([shape, count]) => `${shape}×${count}`).join("；") || "未形成受控核心處理";
}

function summarizeCase(caseDefinition, runs) {
  const results = runs.map((run) => classifyRun(caseDefinition, run));
  const accepted = results.filter((result) => result.accepted).length;
  const classifications = {};
  const shapes = {};
  runs.forEach((run, index) => {
    classifications[results[index].classification] = (classifications[results[index].classification] || 0) + 1;
    shapes[run.semanticShape] = (shapes[run.semanticShape] || 0) + 1;
  });
  const pass = accepted >= caseDefinition.minimumAcceptedRuns && results.every((result) => result.classification === "PASS");
  const actual = pass ? "所有觀察樣本都形成預期安全產品行為" : Object.entries(classifications).map(([key, count]) => `${key}×${count}`).join("；");
  return {
    caseId: caseDefinition.id, totalRuns: runs.length, acceptedLunaRuns: accepted,
    shapeDistribution: shapes, classificationDistribution: classifications,
    status: pass ? "PASS" : "BLOCKED",
    humanReview: {
      INPUT: caseDefinition.input,
      OPENAI_UNDERSTANDING: [...new Set(runs.map(understandingText))].join(" | "),
      JUNZAN_ACTION: [...new Set(runs.map(actionText))].join(" | "),
      EXPECTED_PRODUCT_BEHAVIOR: caseDefinition.expected,
      ACTUAL_PRODUCT_BEHAVIOR: actual,
      RESULT: pass ? "PASS" : "FAIL",
      FAIL_REASON_PLAIN_LANGUAGE: pass ? "" : [...new Set(results.filter((item) => item.classification !== "PASS").map((item) => item.plainReason))].join("；")
    }
  };
}

async function executeRun(caseDefinition, runNumber, apiKey, coreSha) {
  const input = buildCaseInput(caseDefinition, runNumber);
  const diagnostics = [];
  try {
    const understanding = await callOpenAIUnderstandingV1(input, {
      apiKey,
      onDiagnostic: (item) => diagnostics.push(item)
    });
    const provider = understanding[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC];
    const c10 = assembleReadOnlyShadowComparison({
      understandingTurnInput: input, oldCoreOutcomeSummary: EMPTY_OLD_CORE_SUMMARY,
      coreSha, understandingResult: understanding
    });
    const rawUnits = understanding.understandingOutput.units.map(rawUnitProjection);
    const rawLinks = understanding.contextLinkCandidates.map((link) => ({
      unitIdHash: hash(link.unitId), actionCandidate: link.actionCandidate,
      targetRequestCycleIdHash: link.targetRequestCycleId ? hash(link.targetRequestCycleId) : null
    }));
    const units = understanding.validatedUnits.map((unit) => controlledUnitProjection(unit, understanding, c10));
    const failureCodes = [...understanding.failedUnits.map((item) => item.failureCode), ...(c10.failureCodes || [])];
    const run = {
      caseId: caseDefinition.id, runNumber,
      requestedModel: provider.requestedModel, resolvedModel: provider.resolvedModel,
      providerAttemptCount: provider.providerAttemptCount, providerAttempts: provider.providerAttempts,
      unitCount: rawUnits.length, rawUnits, rawLinks, units,
      purpose: rawUnits.map((unit) => unit.purpose), capability: rawUnits.map((unit) => unit.capability),
      subject: rawUnits.map((unit) => unit.subjectKind), stayDependency: rawUnits.map((unit) => unit.stayDependent),
      temporalCandidate: rawUnits.map((unit) => unit.temporalCandidate),
      contextCandidate: rawLinks, lifecycle: units.map((unit) => unit.lifecycle),
      replyDisposition: units.map((unit) => unit.replyDisposition), c08Ownership: units.map((unit) => unit.c08Owned),
      c11Markers: [...new Set([...diagnostics.map((item) => item.targetMarker), ...(c10.validationCodes || [])])],
      c10Diff: c10.diffSummary || null, failureCodes,
      sideEffectCounters: c10.sideEffectCounters || null,
      propertyIsolation: input.propertyScope.propertyId === PROPERTY_ID
    };
    run.semanticShape = semanticShape(run);
    return run;
  } catch (error) {
    const provider = error && error[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC];
    return {
      caseId: caseDefinition.id, runNumber,
      requestedModel: provider ? provider.requestedModel : NEW_CORE_OPENAI_MODEL,
      resolvedModel: provider ? provider.resolvedModel : "",
      providerAttemptCount: provider ? provider.providerAttemptCount : 0,
      providerAttempts: provider ? provider.providerAttempts : [], unitCount: 0,
      rawUnits: [], rawLinks: [], units: [], semanticShape: "NO_RAW_UNIT",
      purpose: [], capability: [], subject: [], stayDependency: [], temporalCandidate: [],
      contextCandidate: [], lifecycle: [], replyDisposition: [], c08Ownership: [],
      c11Markers: diagnostics.map((item) => item.targetMarker), c10Diff: null,
      failureCodes: [error && error.code || "OTHER_RUNTIME_FAILURE"],
      sideEffectCounters: ZERO_COUNTERS, propertyIsolation: true
    };
  }
}

function privateArtifactPath(value) {
  const resolved = path.resolve(value || `/tmp/junzan-task14-luna-only-${Date.now()}.json`);
  if (!resolved.startsWith("/tmp/")) throw new Error("PRIVATE_ARTIFACT_MUST_BE_IN_TMP");
  return resolved;
}

async function main() {
  const config = validateRunConfiguration({
    apiKey: process.env.OPENAI_TEST_API_KEY,
    coreSha: process.env.TASK14_CORE_SHA
  });
  const artifactPath = privateArtifactPath(process.env.TASK14_PRIVATE_ARTIFACT_PATH);
  const runs = [];
  for (const caseDefinition of CASES) {
    let accepted = 0;
    let runNumber = 0;
    while (accepted < caseDefinition.minimumAcceptedRuns && runNumber < 15) {
      runNumber += 1;
      const run = await executeRun(caseDefinition, runNumber, process.env.OPENAI_TEST_API_KEY, config.coreSha);
      runs.push(run);
      if (classifyRun(caseDefinition, run).accepted) accepted += 1;
    }
    const caseRuns = runs.filter((run) => run.caseId === caseDefinition.id);
    if (new Set(caseRuns.map((run) => run.semanticShape)).size > 1) {
      let extraAccepted = 0;
      while (extraAccepted < 5 && runNumber < 25) {
        runNumber += 1;
        const run = await executeRun(caseDefinition, runNumber, process.env.OPENAI_TEST_API_KEY, config.coreSha);
        runs.push(run);
        if (classifyRun(caseDefinition, run).accepted) extraAccepted += 1;
      }
    }
  }
  const cases = CASES.map((item) => summarizeCase(item, runs.filter((run) => run.caseId === item.id)));
  const classifications = runs.map((run) => classifyRun(CASES.find((item) => item.id === run.caseId), run));
  const artifact = {
    schemaVersion: 1, classification: "PRIVATE_REAL_OPENAI_EVIDENCE_DO_NOT_COMMIT",
    generatedAt: new Date().toISOString(), coreSha: config.coreSha, requestedModel: NEW_CORE_OPENAI_MODEL,
    runs, cases
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const safe = {
    suite: "new-core-openai-shadow-acceptance", evidenceLevel: "REAL_OPENAI_PLANNER",
    requestedModel: NEW_CORE_OPENAI_MODEL,
    resolvedModels: [...new Set(runs.map((run) => run.resolvedModel).filter(Boolean))],
    logicalRuns: runs.length,
    providerAttempts: runs.reduce((sum, run) => sum + run.providerAttemptCount, 0),
    acceptedLunaRuns: classifications.filter((item) => item.accepted).length,
    cases,
    classificationCounts: Object.fromEntries(["OPENAI_UNDERSTANDING_ERROR", "CONTRACT_TOO_NARROW", "MODEL_IDENTITY_MISMATCH", "OTHER_RUNTIME_FAILURE"].map((name) => [name, classifications.filter((item) => item.classification === name).length])),
    c11Markers: [...new Set(runs.flatMap((run) => run.c11Markers))],
    shadowSideEffects: runs.every((run) => zeroSideEffects(run.sideEffectCounters)) ? "ALL_ZERO" : "FAIL",
    propertyIsolation: runs.every((run) => run.propertyIsolation) ? "PASS" : "FAIL",
    privateArtifactPath: artifactPath,
    status: cases.every((item) => item.status === "PASS") ? "PASS" : "BLOCKED"
  };
  console.log(JSON.stringify(safe));
  if (safe.status !== "PASS") process.exitCode = 1;
}

module.exports = { CASES, buildCaseInput, classifyRun, summarizeCase, validateRunConfiguration };

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ status: "BLOCKED", code: error.message }));
  process.exitCode = 1;
});
