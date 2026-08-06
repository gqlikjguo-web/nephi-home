"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TEST_ONLY_ACCEPTANCE_AUDIENCE, EXPECTED_REPOSITORY, EXPECTED_REF, EXPECTED_WORKFLOW_REF } = require("../lib/test-only-acceptance-oidc");
const { getCapabilityDefinition } = require("../lib/conversation-engine-v2/capability-registry");

const DEFAULT_BASE_URL = "https://nephi-home-node-pilot-test-only-btye.onrender.com";
const SAFE_FACT_KEYS = new Set(["subject", "status", "answer", "locationMapUrl", "detailIntent", "availability", "checkIn", "checkOut", "detailProvided", "detailNeedsConfirmation", "amenities", "availableDates", "range", "availableInventory", "applicableBundles", "prices"]);
const COMMON_TRACE_STAGES = ["planner", "validation", "semantic_contract", "claim_validator", "final_decision"];
const FORMAL_TRACE_STAGES = [...COMMON_TRACE_STAGES, "canonical_request", "formal_request", "query_plan", "executor"];
const NO_REPLY_TRACE_STAGES = ["planner", "validation", "semantic_contract", "final_decision"];
const FORBIDDEN_FINAL_TEXT = ["一定有房", "已完成訂房"];

const MATRIX_PATH = path.resolve(__dirname, "../tests/fixtures/real-guest-fixed-matrix.json");
const SUPPLEMENTAL_MATRIX_PATH = path.resolve(__dirname, "../tests/fixtures/real-guest-supplemental-matrix.json");
const NOT_EXECUTABLE_STATUS = "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API";
const OPERATOR_CONTEXT_CASES = new Map([
  ["rg-040-modify-guests-bed", "operator_prior_context_cannot_be_established"],
  ["rg-041-modify-room-mix", "operator_prior_context_cannot_be_established"],
  ["rg-042-modify-date", "operator_prior_context_cannot_be_established"]
]);
const NON_TEXT_SEMANTICS = new Set(["non_text_event", "non_text_marker"]);
const FORBIDDEN_PROVIDER_MARKERS = ["json", "seed", "fixture", "pglite", "fake_planner", "fake_composer"];

function semanticCapabilityGroups(tags = []) {
  const groups = [];
  const add = (alternatives) => {
    const normalized = [...new Set(alternatives)].sort();
    const key = normalized.join("|");
    if (!groups.some((item) => item.join("|") === key)) groups.push(normalized);
  };
  const values = new Set(tags);
  if ([...values].some((tag) => ["availability", "date_clarification"].includes(tag))) add(["availability", "available_dates", "room_options", "bundle_availability"]);
  if ([...values].some((tag) => ["price", "total_price", "holiday_price"].includes(tag))) add(["price", "total_price"]);
  if ([...values].some((tag) => ["extra_bed", "baby_crib", "bathtub", "amenity", "common_space", "kitchen", "towel", "mahjong", "switch", "board_games", "ktv"].includes(tag))) add(["amenity", "policy", "property_fact"]);
  if ([...values].some((tag) => ["deposit", "payment", "cancellation", "refund", "refund_policy", "payment_method", "deposit_process", "payment_timing", "pet_policy", "check_in", "late_arrival", "latest_arrival", "quiet_hours", "noise_policy", "property_rule", "cleaning_fee"].includes(tag))) add(["policy", "property_fact"]);
  if ([...values].some((tag) => ["bbq", "bbq_equipment", "bbq_fee", "bbq_food_order", "bbq_hours", "food_order"].includes(tag))) add(["bbq", "amenity", "policy"]);
  if ([...values].some((tag) => ["pool", "pool_fee", "seasonal_hours"].includes(tag))) add(["pool", "amenity", "policy"]);
  if (values.has("parking")) add(["parking", "amenity", "property_fact"]);
  if ([...values].some((tag) => ["location", "navigation"].includes(tag))) add(["location", "property_fact"]);
  if ([...values].some((tag) => ["booking", "booking_process"].includes(tag))) add(["booking_request", "availability", "policy"]);
  if (values.has("bundle_capacity")) add(["capacity", "bundle_availability", "property_fact"]);
  if (values.has("sensitive_access_info")) add(["high_risk", "human_help", "unknown"]);
  if (values.has("payment_claim")) add(["policy", "high_risk", "human_help", "unknown"]);
  if (values.has("unknown_property_fact")) add(["property_fact", "unknown", "human_help"]);
  return groups;
}

function executionReasonForTurn(item, turn) {
  if (turn && turn.requiresPriorContextFromSource === true) return "operator_prior_context_cannot_be_established";
  if (turn && (turn.eventKind || (turn.expectedSemantic || []).some((tag) => NON_TEXT_SEMANTICS.has(tag)))) return "native_non_text_event_requires_line_transport";
  if (item && item.channelCapabilityRequired === "real_non_text_event_injection") return "native_non_text_event_requires_line_transport";
  return "";
}

function loadAcceptanceMatrix(filePath = MATRIX_PATH) {
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!source || !Array.isArray(source.cases)) throw new Error("real_guest_matrix_cases_required");
  const turnCount = source.cases.reduce((sum, item) => sum + (Array.isArray(item.turns) ? item.turns.length : 0), 0);
  if (source.cases.length !== 53 || turnCount !== 61) throw new Error("real_guest_matrix_fixed_count_mismatch");
  return source.cases.map((item) => {
    const caseReason = OPERATOR_CONTEXT_CASES.get(item.id) || "";
    return {
      id: item.id,
      bucket: item.bucket,
      sourceRef: item.sourceRef,
      ...(caseReason ? { executionStatus: NOT_EXECUTABLE_STATUS, executionReasonCode: caseReason } : {}),
      turns: item.turns.map((turn) => {
        const turnReason = executionReasonForTurn(item, turn);
        return {
          messageText: turn.input,
          expectedActions: turn.allowedActions,
          expectedSemantic: turn.expectedSemantic || [],
          expectedCapabilities: semanticCapabilityGroups(turn.expectedSemantic || []),
          forbidClaims: turn.forbidClaims || [],
          ...(turnReason ? { executionStatus: NOT_EXECUTABLE_STATUS, executionReasonCode: turnReason } : {})
        };
      })
    };
  });
}

const ACCEPTANCE_MATRIX = loadAcceptanceMatrix();

function loadSupplementalAcceptanceMatrix(filePath = SUPPLEMENTAL_MATRIX_PATH) {
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!source || !Array.isArray(source.cases)) throw new Error("supplemental_real_guest_matrix_cases_required");
  const turnCount = source.cases.reduce((sum, item) => sum + (Array.isArray(item.turns) ? item.turns.length : 0), 0);
  if (source.cases.length !== 24 || turnCount !== 29) throw new Error("supplemental_real_guest_matrix_fixed_count_mismatch");
  return source.cases.map((item) => ({
    id: item.id,
    bucket: item.bucket,
    sourceRef: item.sourceRef || source.source,
    turns: item.turns.map((turn) => ({
      ...(typeof turn.input === "string" ? { messageText: turn.input } : {}),
      ...(turn.lineEvent ? { lineEvent: JSON.parse(JSON.stringify(turn.lineEvent)) } : {}),
      expectedActions: turn.allowedActions,
      expectedSemantic: turn.expectedSemantic || [],
      expectedCapabilities: semanticCapabilityGroups(turn.expectedSemantic || []),
      forbidClaims: turn.forbidClaims || [],
      establishOperatorContext: turn.establishOperatorContext === true,
      pastDatePolicy: turn.pastDatePolicy || ""
    }))
  }));
}

const SUPPLEMENTAL_ACCEPTANCE_MATRIX = loadSupplementalAcceptanceMatrix();
const DEPLOYED_ACCEPTANCE_MATRIX = [...ACCEPTANCE_MATRIX, ...SUPPLEMENTAL_ACCEPTANCE_MATRIX];
const TARGET_PREFLIGHT_TURNS = Object.freeze({
  "rg-003-price-nights": [1],
  "rg-004-bundle-price": [1],
  "rg-006-named-room-availability": [1],
  "rg-013-booking-request-full": [1],
  "rg-023-pool-fee": [1],
  "rg-029-checkin-latest": [1],
  "rg-033-kitchen": [1],
  "rg-037-multi-pool-price-checkin": [1],
  "rg-038-conversation-room-price-payment": [1],
  "rg-039-conversation-booking-refund": [1],
  "rgs-003-bbq": [1],
  "rgs-005-parking": [1],
  "rgs-010-pets": [1],
  "rgs-014-bundle-price": [1],
  "rgs-019-modify-room-mix": [1],
  "rgs-020-modify-date": [1, 2, 3]
});
const TARGET_PREFLIGHT_CASE_IDS = Object.freeze(Object.keys(TARGET_PREFLIGHT_TURNS));

function selectAcceptanceMatrix({ matrix = DEPLOYED_ACCEPTANCE_MATRIX, caseIds } = {}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) throw new Error("acceptance_case_ids_required");
  const normalized = caseIds.map((value) => String(value));
  if (normalized.some((value) => !value.trim())) throw new Error("acceptance_case_id_blank");
  const trimmed = normalized.map((value) => value.trim());
  if (new Set(trimmed).size !== trimmed.length) throw new Error("acceptance_case_id_duplicate");
  const byId = new Map(matrix.map((item) => [item.id, item]));
  for (const id of trimmed) if (!byId.has(id)) throw new Error(`acceptance_case_id_unknown:${id}`);
  return trimmed.map((id) => byId.get(id));
}

function validateWorkflowIdentity(env) {
  if (env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY
    || env.GITHUB_REF !== EXPECTED_REF
    || env.GITHUB_WORKFLOW_REF !== EXPECTED_WORKFLOW_REF
    || !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error("github_workflow_identity_mismatch");
  }
}

function acceptanceMatrixForMode(env) {
  const mode = String(env.TEST_ONLY_ACCEPTANCE_MODE || "").trim();
  if (mode === "full_matrix") {
    if (String(env.TEST_ONLY_ACCEPTANCE_CASE_IDS || "").trim()) throw new Error("full_matrix_case_filter_forbidden");
    return { mode, matrix: DEPLOYED_ACCEPTANCE_MATRIX };
  }
  if (mode !== "target_preflight") throw new Error("acceptance_mode_invalid");
  const rawIds = String(env.TEST_ONLY_ACCEPTANCE_CASE_IDS || "").split(",");
  const selected = selectAcceptanceMatrix({ caseIds: rawIds });
  const matrix = selected.map((item) => ({
    ...item,
    turns: TARGET_PREFLIGHT_TURNS[item.id].map((turnNumber) => item.turns[turnNumber - 1])
  }));
  if (matrix.length !== TARGET_PREFLIGHT_CASE_IDS.length
    || matrix.some((item, index) => item.id !== TARGET_PREFLIGHT_CASE_IDS[index] || item.turns.some((turn) => !turn))
    || matrix.reduce((sum, item) => sum + item.turns.length, 0) !== 18) {
    throw new Error("target_preflight_case_set_mismatch");
  }
  return { mode, matrix };
}

function delay(milliseconds) { return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve(); }
function responseData(payload) { return payload && payload.ok === true && payload.data ? payload.data : payload; }

function assertSafeNestedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unsafe_nested_fact_shape");
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`unsafe_nested_fact_key:${key}`);
}

function validateSafeFacts(facts) {
  const value = facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {};
  for (const key of Object.keys(value)) if (!SAFE_FACT_KEYS.has(key)) throw new Error(`unsafe_fact_key:${key}`);
  if (value.range !== undefined) assertSafeNestedKeys(value.range, new Set(["from", "to"]));
  for (const inventory of value.availableInventory || []) assertSafeNestedKeys(inventory, new Set(["publicName", "capacity", "category"]));
  for (const bundle of value.applicableBundles || []) assertSafeNestedKeys(bundle, new Set(["name", "note"]));
  for (const price of value.prices || []) {
    assertSafeNestedKeys(price, new Set(["inventory", "daily", "total", "currency"]));
    assertSafeNestedKeys(price.inventory, new Set(["publicName", "capacity", "category"]));
    for (const daily of price.daily || []) assertSafeNestedKeys(daily, new Set(["date", "price", "source"]));
  }
}

async function pollForDeployment({ baseUrl, expectedCommit, fetchImpl = globalThis.fetch, timeoutMs = 10 * 60 * 1000, intervalMs = 10_000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  do {
    try {
      const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/health`, { method: "GET", headers: { accept: "application/json" } });
      lastStatus = Number(response && response.status) || 0;
      const health = response && response.ok ? responseData(await response.json()) : null;
      if (health && health.status === "ready" && health.testOnly === true && health.commit === expectedCommit) return health;
    } catch { lastStatus = 0; }
    if (Date.now() >= deadline) break;
    await delay(intervalMs);
  } while (Date.now() <= deadline);
  throw new Error(`deployment_health_timeout:${lastStatus}`);
}

async function requestGithubOidcToken({ requestUrl, requestToken, fetchImpl = globalThis.fetch }) {
  if (!requestUrl || !requestToken) throw new Error("github_oidc_request_environment_required");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", TEST_ONLY_ACCEPTANCE_AUDIENCE);
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${requestToken}` } });
  if (!response || !response.ok) throw new Error(`github_oidc_request_failed:${Number(response && response.status) || 0}`);
  const payload = await response.json();
  if (!payload || typeof payload.value !== "string" || !payload.value) throw new Error("github_oidc_token_missing");
  return payload.value;
}

function validateAcceptanceResult(result, expectation = {}) {
  if (!result || typeof result !== "object") throw new Error("acceptance_result_required");
  if (!result.traceId || !result.eventId) throw new Error("acceptance_evidence_ids_required");
  if (!result.finalDecision || typeof result.finalDecision.action !== "string") throw new Error("final_decision_required");
  if (!result.claimValidation || typeof result.claimValidation.ok !== "boolean" || !Array.isArray(result.claimValidation.errors)) throw new Error("claim_validation_required");
  if (result.claimValidation.ok !== true) throw new Error("claim_validation_rejected");
  if (!result.finalResponse || typeof result.finalResponse.replyText !== "string" || typeof result.finalResponse.shouldReply !== "boolean") throw new Error("final_response_required");
  if (result.finalResponse.action !== result.finalDecision.action) throw new Error("final_response_authority_mismatch");
  if (result.finalResponse.shouldReply !== (result.finalResponse.action !== "no_reply")) throw new Error("final_response_reply_contract_mismatch");
  if (result.finalResponse.action === "no_reply" && result.finalResponse.replyText !== "") throw new Error("no_reply_text_must_be_empty");
  if ((expectation.expectedActions || []).length && !expectation.expectedActions.includes(result.finalDecision.action)) throw new Error(`unexpected_final_action:${result.finalDecision.action}`);
  const forbiddenText = [...FORBIDDEN_FINAL_TEXT, ...(expectation.forbidClaims || [])];
  if (forbiddenText.some((value) => value && result.finalResponse.replyText.includes(value))) throw new Error("unsafe_final_response");
  if (!Array.isArray(result.taskResults) || !Array.isArray(result.trace)) throw new Error("acceptance_execution_evidence_required");
  const catalog = result.trace.find((entry) => entry && entry.stage === "property_catalog");
  if (!catalog || !["postgres", "postgresql"].includes(String(catalog.providerType || "").toLowerCase())) throw new Error("deployed_provider_not_postgresql");
  const planner = result.trace.find((entry) => entry && entry.stage === "planner");
  if (!planner || planner.parserSucceeded !== true) throw new Error("planner_semantic_path_required");
  const semanticContract = result.trace.find((entry) => entry && entry.stage === "semantic_contract");
  if (!semanticContract || semanticContract.validationPassed !== true) throw new Error("semantic_contract_validation_required");
  for (const task of result.taskResults) {
    if (!task || !task.taskId || !(task.capability || task.type) || !task.status || typeof task.reason !== "string" || typeof task.dataSource !== "string") throw new Error("task_evidence_invalid");
    if (task.status === "answered" && !task.dataSource.trim()) throw new Error("answered_task_data_source_required");
    if (task.status === "answered" && FORBIDDEN_PROVIDER_MARKERS.some((marker) => task.dataSource.toLowerCase().includes(marker))) throw new Error("forbidden_deployed_data_source");
    validateSafeFacts(task.facts);
  }
  const canonicalItems = result.trace.filter((entry) => entry && entry.stage === "canonical_request").flatMap((entry) => Array.isArray(entry.items) ? entry.items : []);
  const capabilities = new Set([
    ...result.taskResults.flatMap((task) => [task.capability, task.type].filter(Boolean)),
    ...canonicalItems.map((item) => item && item.capability).filter(Boolean)
  ]);
  for (const expected of expectation.expectedCapabilities || []) {
    const alternatives = Array.isArray(expected) ? expected : [expected];
    if (!alternatives.some((capability) => capabilities.has(capability))) throw new Error(`expected_capability_missing:${alternatives.join("|")}`);
  }
  if (expectation.expectedDataSource && !result.taskResults.some((task) => task.dataSource === expectation.expectedDataSource)) throw new Error(`expected_data_source_missing:${expectation.expectedDataSource}`);
  const semanticTags = new Set(expectation.expectedSemantic || []);
  const missingSemanticEvidence = missingExpectedSemanticEvidence(result, expectation);
  if (missingSemanticEvidence.length) throw new Error(`expected_semantic_evidence_missing:${missingSemanticEvidence.join("|")}`);
  if (semanticTags.has("bundle") && canonicalItems.length && !canonicalItems.some((item) => item.capability === "bundle_availability" || item.canonicalEntity && item.canonicalEntity.category === "bundle")) throw new Error("expected_bundle_scope_missing");
  for (const roomNumber of ["301", "402"]) {
    if (semanticTags.has(`room_${roomNumber}`) && canonicalItems.length && !canonicalItems.some((item) => String(item.canonicalEntity && item.canonicalEntity.canonicalId || "").includes(roomNumber))) throw new Error(`expected_room_scope_missing:${roomNumber}`);
  }
  if (semanticTags.has("date_range") && canonicalItems.length && !canonicalItems.some((item) => item.temporalState && (
    item.temporalState.checkIn && item.temporalState.checkOut
    || item.temporalState.repairReasonCode === "past_date" && item.temporalState.expressionType === "date_range"
  ))) throw new Error("expected_date_range_missing");
  if (semanticTags.has("nights") && canonicalItems.length && !canonicalItems.some((item) => Number.isInteger(item.temporalState && item.temporalState.nights) && item.temporalState.nights > 0)) throw new Error("expected_nights_missing");
  if (expectation.pastDatePolicy === "reject_if_resolved_past") {
    const resolvedCheckIns = canonicalItems.map((item) => String(item && item.temporalState && item.temporalState.checkIn || "")).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const evaluatedDate = String(expectation.evaluatedAt instanceof Date ? expectation.evaluatedAt.toISOString() : expectation.evaluatedAt || "").slice(0, 10);
    const canonicalPastDate = canonicalItems.some((item) => item && item.temporalState && item.temporalState.repairReasonCode === "past_date");
    if (canonicalPastDate || evaluatedDate && resolvedCheckIns.some((value) => value < evaluatedDate)) {
      if (!/(已過|過去|日期.{0,6}過|無法查詢)/u.test(result.finalResponse.replyText)) throw new Error("past_date_not_explicitly_rejected");
      if (result.taskResults.some((task) => task.status === "answered" && ["availability", "price", "total_price"].includes(task.capability || task.type))) throw new Error("past_date_formal_query_forbidden");
    }
  }
  const stages = new Set(result.trace.map((entry) => entry && entry.stage));
  const requiredStages = expectation.requiredStages || (result.finalDecision.action === "no_reply" ? NO_REPLY_TRACE_STAGES : result.finalDecision.action === "reply" && result.taskResults.some((task) => task.status === "answered") ? FORMAL_TRACE_STAGES : COMMON_TRACE_STAGES);
  for (const stage of requiredStages) if (!stages.has(stage)) throw new Error(`trace_stage_missing:${stage}`);
  return { action: result.finalDecision.action, reasonCode: result.finalDecision.reasonCode, claimValidationOk: result.claimValidation.ok };
}

function validateNativeAcceptanceResult(result, expectation = {}) {
  if (!result || typeof result !== "object" || !result.traceId || !result.eventId) throw new Error("acceptance_evidence_ids_required");
  const expectedType = String(expectation.lineEvent && expectation.lineEvent.message && expectation.lineEvent.message.type || "");
  if (!result.nativeEvent || result.nativeEvent.type !== expectedType || result.nativeEvent.transport !== "shared_line_message_gate" || result.nativeEvent.engineInvoked !== false) throw new Error("native_line_transport_evidence_required");
  if (!result.finalDecision || result.finalDecision.action !== "no_reply" || result.finalDecision.reasonCode !== "line_non_text_event_ignored") throw new Error("native_line_no_reply_decision_required");
  if (!result.finalResponse || result.finalResponse.action !== "no_reply" || result.finalResponse.shouldReply !== false || result.finalResponse.replyText !== "") throw new Error("native_line_no_reply_response_required");
  if (!result.claimValidation || result.claimValidation.ok !== true || result.claimValidation.notApplicable !== true) throw new Error("native_line_claim_validation_boundary_required");
  if (!Array.isArray(result.taskResults) || result.taskResults.length || !Array.isArray(result.trace)) throw new Error("native_line_engine_must_not_run");
  if (result.trace.some((entry) => entry && ["planner", "canonical_request", "query_plan", "executor"].includes(entry.stage))) throw new Error("native_line_engine_must_not_run");
  if (!result.trace.some((entry) => entry && entry.stage === "line_transport" && entry.reasonCode === "line_non_text_event_ignored")) throw new Error("native_line_transport_trace_required");
  return { action: "no_reply", reasonCode: "line_non_text_event_ignored", claimValidationOk: true };
}

function assessFinalResponseEvidence(result, expectation = {}) {
  const reasons = [];
  const replyText = result && result.finalResponse && typeof result.finalResponse.replyText === "string" ? result.finalResponse.replyText : "";
  const action = result && result.finalDecision && result.finalDecision.action || "";
  const claimValidation = result && result.claimValidation || {};
  const answeredTasks = Array.isArray(result && result.taskResults) ? result.taskResults.filter((task) => task && task.status === "answered") : [];
  const coveredTaskIds = new Set(Array.isArray(claimValidation.coveredTaskIds) ? claimValidation.coveredTaskIds : []);
  const forbiddenText = [...FORBIDDEN_FINAL_TEXT, ...(expectation.forbidClaims || [])];
  const unauthorizedCommitmentDetected = forbiddenText.some((value) => value && replyText.includes(value));
  reasons.push(...missingExpectedSemanticEvidence(result, expectation).map((tag) => `expected_semantic_evidence_missing:${tag}`));

  if (claimValidation.ok !== true || (claimValidation.errors || []).length || (claimValidation.missingTaskIds || []).length || (claimValidation.unexpectedTaskIds || []).length) {
    reasons.push("claim_validation_does_not_prove_complete_coverage");
  }
  if (unauthorizedCommitmentDetected) reasons.push("unauthorized_commitment_detected");
  if (action === "no_reply") {
    if (replyText !== "") reasons.push("no_reply_contains_final_response_text");
  } else if (!replyText.trim()) {
    reasons.push("reply_text_required_for_final_action");
  }

  for (const task of answeredTasks) {
    if (!task.dataSource || !task.dataSource.trim()) reasons.push("answered_task_data_source_unproven");
    if (!task.facts || typeof task.facts !== "object" || Array.isArray(task.facts) || !Object.keys(task.facts).length) {
      reasons.push("answered_task_fact_evidence_unavailable");
    }
    if (!coveredTaskIds.has(task.taskId)) reasons.push("answered_task_not_covered_by_claim_validator");
  }

  const uniqueReasons = [...new Set(reasons)];
  const passed = uniqueReasons.length === 0;
  return {
    status: passed ? "PASS" : "FAIL",
    completeAnswer: passed,
    formalDataConsistent: passed,
    omissionDetected: uniqueReasons.some((reason) => reason.includes("not_covered") || reason.includes("unavailable") || reason.includes("coverage") || reason.includes("reply_text")),
    unsupportedGuessDetected: passed ? false : null,
    offTopicDetected: passed ? false : null,
    unauthorizedCommitmentDetected,
    reasons: uniqueReasons
  };
}
async function acceptanceRequest({ baseUrl, oidcToken, method = "POST", body, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/admin/test-only/conversation-acceptance`, {
    method,
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const rawCode = String(payload && payload.error && payload.error.code || "");
    const error = new Error("acceptance_http_failed");
    error.code = "acceptance_http_failed";
    error.httpStatus = Number.isInteger(response.status) ? response.status : 0;
    error.httpErrorCode = /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : "UNKNOWN";
    throw error;
  }
  return responseData(payload);
}

function safeEvidence(caseId, turnNumber, result) {
  return {
    case: `${caseId}:turn-${turnNumber}`,
    status: "PASS",
    traceId: result.traceId,
    finalDecisionAction: result.finalDecision.action,
    claimValidationOk: result.claimValidation.ok === true
  };
}

function safeNotExecutableEvidence(caseId, turnNumber, reasonCode) {
  return {
    case: caseId,
    turn: turnNumber,
    status: NOT_EXECUTABLE_STATUS,
    reasonCode
  };
}

function safeErrorCode(error) {
  const raw = String(error && (error.code || error.message) || "unknown");
  const code = raw.split(":", 1)[0];
  return /^[a-z][a-z0-9_]*$/.test(code) ? code : "acceptance_case_failed";
}

function safeHttpEvidence(error, occurredAt) {
  if (!error || error.code !== "acceptance_http_failed") return {};
  const timestamp = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  return {
    httpStatus: Number.isInteger(error.httpStatus) ? error.httpStatus : 0,
    httpErrorCode: /^[A-Z][A-Z0-9_]{0,79}$/.test(String(error.httpErrorCode || "")) ? error.httpErrorCode : "UNKNOWN",
    occurredAt: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString()
  };
}

function safeFailureEvidence(caseId, turnNumber, error, result, occurredAt) {
  const finalDecision = result && result.finalDecision && typeof result.finalDecision === "object" ? result.finalDecision : {};
  const claimValidation = result && result.claimValidation && typeof result.claimValidation === "object" ? result.claimValidation : {};
  const taskResults = result && Array.isArray(result.taskResults) ? result.taskResults : [];
  return {
    case: caseId,
    turn: turnNumber,
    errorCode: safeErrorCode(error),
    ...safeHttpEvidence(error, occurredAt),
    finalDecisionAction: typeof finalDecision.action === "string" ? finalDecision.action : "",
    finalDecisionReasonCode: typeof finalDecision.reasonCode === "string" ? finalDecision.reasonCode : "",
    claimValidationOk: typeof claimValidation.ok === "boolean" ? claimValidation.ok : null,
    tasks: taskResults.map((task) => ({
      capability: task && typeof (task.capability || task.type) === "string" ? task.capability || task.type : "",
      status: task && typeof task.status === "string" ? task.status : "",
      reason: task && typeof task.reason === "string" ? task.reason : "",
      dataSource: task && typeof task.dataSource === "string" ? task.dataSource : ""
    }))
  };
}

function safeReportFacts(facts) {
  try {
    validateSafeFacts(facts);
    return JSON.parse(JSON.stringify(facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {}));
  } catch {
    return {};
  }
}

function formalEvidenceForReport(result) {
  return (result && Array.isArray(result.taskResults) ? result.taskResults : []).map((task) => ({
    taskId: String(task && task.taskId || "").slice(0, 80),
    capability: String(task && (task.capability || task.type) || "").slice(0, 80),
    status: String(task && task.status || "").slice(0, 80),
    reason: String(task && task.reason || "").slice(0, 160),
    dataSource: String(task && task.dataSource || "").slice(0, 80),
    facts: safeReportFacts(task && task.facts)
  }));
}

function runtimeEvidenceForReport(result) {
  const trace = result && Array.isArray(result.trace) ? result.trace : [];
  const catalog = trace.find((entry) => entry && entry.stage === "property_catalog") || {};
  const planner = trace.find((entry) => entry && entry.stage === "planner") || {};
  const semanticContract = trace.find((entry) => entry && entry.stage === "semantic_contract") || {};
  return {
    providerType: String(catalog.providerType || "").slice(0, 40),
    plannerParserSucceeded: planner.parserSucceeded === true,
    semanticContractValidationPassed: semanticContract.validationPassed === true,
    planner: trace.filter((entry) => entry && ["planner", "planner_error"].includes(entry.stage)),
    validation: trace.filter((entry) => entry && ["validation", "semantic_contract", "context_validation"].includes(entry.stage)),
    canonicalRequest: trace.filter((entry) => entry && entry.stage === "canonical_request"),
    conversationState: trace.filter((entry) => entry && ["context_execution", "state", "pending_request"].includes(entry.stage)),
    queryPlan: trace.filter((entry) => entry && ["formal_request", "query_plan"].includes(entry.stage)),
    resolverExecution: trace.filter((entry) => entry && entry.stage === "executor"),
    transport: trace.filter((entry) => entry && entry.stage === "line_transport")
  };
}

function earliestFailureLayer(error) {
  const code = safeErrorCode(error);
  if (code === "acceptance_http_failed" || code.startsWith("native_line_")) return "line_transport";
  if (code.startsWith("planner_") || code === "expected_capability_missing" || code.startsWith("expected_semantic_evidence_missing")) return "planner";
  if (code.startsWith("semantic_") || code.startsWith("trace_stage_missing")) return "validation";
  if (code.startsWith("expected_room_scope") || code.startsWith("expected_bundle_scope") || code.startsWith("expected_date") || code.startsWith("expected_nights") || code.startsWith("past_date")) return "canonical_request";
  if (code.includes("provider") || code.includes("data_source") || code.includes("fact_") || code.startsWith("unsafe_fact") || code.startsWith("unsafe_nested")) return "resolver_execution";
  if (code.startsWith("unexpected_final_action")) return "final_decision";
  if (code.startsWith("claim_") || code.includes("covered_by_claim") || code.includes("coverage")) return "claim_validator";
  if (code.includes("final_response") || code.includes("reply_text") || code.includes("unauthorized_commitment") || code.includes("no_reply")) return "final_response";
  return "acceptance_evidence";
}

function reportTurn({ turnNumber, turn, result, assessment, error, status }) {
  const finalDecision = result && result.finalDecision || {};
  const claimValidation = result && result.claimValidation || {};
  const finalResponse = result && result.finalResponse || {};
  return {
    turn: turnNumber,
    guestQuestion: String(turn && turn.messageText || ""),
    nativeEvent: turn && turn.lineEvent ? { type: String(turn.lineEvent.message && turn.lineEvent.message.type || "") } : null,
    status,
    errorCode: error ? safeErrorCode(error) : "",
    earliestFailureLayer: error ? earliestFailureLayer(error) : "",
    traceId: String(result && result.traceId || "").slice(0, 160),
    runtimeEvidence: runtimeEvidenceForReport(result),
    formalEvidence: formalEvidenceForReport(result),
    finalDecision: {
      action: String(finalDecision.action || "").slice(0, 40),
      reasonCode: String(finalDecision.reasonCode || "").slice(0, 160)
    },
    claimValidation: {
      ok: typeof claimValidation.ok === "boolean" ? claimValidation.ok : null,
      errors: Array.isArray(claimValidation.errors) ? claimValidation.errors.map((value) => String(value).slice(0, 120)) : [],
      coveredTaskIds: Array.isArray(claimValidation.coveredTaskIds) ? claimValidation.coveredTaskIds.map((value) => String(value).slice(0, 80)) : [],
      missingTaskIds: Array.isArray(claimValidation.missingTaskIds) ? claimValidation.missingTaskIds.map((value) => String(value).slice(0, 80)) : []
    },
    finalResponse: {
      action: String(finalResponse.action || "").slice(0, 40),
      shouldReply: typeof finalResponse.shouldReply === "boolean" ? finalResponse.shouldReply : null,
      replyText: typeof finalResponse.replyText === "string" ? finalResponse.replyText : ""
    },
    operatorContext: result && result.operatorContext ? result.operatorContext : null,
    assessment
  };
}

function markdownText(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function acceptanceReportMarkdown(report) {
  const lines = [
    "# JunZan AI deployed real-guest acceptance report",
    "",
    `- Commit: ${markdownText(report.commit)}`,
    `- Generated at: ${markdownText(report.generatedAt)}`,
    `- PASS: ${Number(report.summary && report.summary.passCount) || 0}`,
    `- FAIL: ${Number(report.summary && report.summary.failCount) || 0}`,
    `- Not executable: ${Number(report.summary && report.summary.notExecutableCaseCount) || 0}`,
    ""
  ];
  for (const item of report.cases || []) {
    lines.push(`## ${markdownText(item.caseId)} — ${markdownText(item.status)}`, "");
    for (const turn of item.turns || []) {
      lines.push(
        `### Turn ${turn.turn}`,
        "",
        `- Guest question: ${markdownText(turn.guestQuestion)}`,
        `- Native event: ${markdownText(turn.nativeEvent && turn.nativeEvent.type)}`,
        `- Result: ${markdownText(turn.status)}`,
        `- Earliest failure layer: ${markdownText(turn.earliestFailureLayer)}`,
        `- Planner / validation / canonical / state / query / resolver evidence: ${markdownText(JSON.stringify(turn.runtimeEvidence || {}))}`,
        `- Formal evidence: ${markdownText(JSON.stringify(turn.formalEvidence || []))}`,
        `- Actual FinalResponse: ${markdownText(turn.finalResponse && turn.finalResponse.replyText)}`,
        `- Complete answer: ${markdownText(turn.assessment && turn.assessment.completeAnswer)}`,
        `- Formal-data consistent: ${markdownText(turn.assessment && turn.assessment.formalDataConsistent)}`,
        `- Omission detected: ${markdownText(turn.assessment && turn.assessment.omissionDetected)}`,
        `- Unsupported guess detected: ${markdownText(turn.assessment && turn.assessment.unsupportedGuessDetected)}`,
        `- Off-topic detected: ${markdownText(turn.assessment && turn.assessment.offTopicDetected)}`,
        `- Unauthorized commitment detected: ${markdownText(turn.assessment && turn.assessment.unauthorizedCommitmentDetected)}`,
        `- Reasons: ${markdownText((turn.assessment && turn.assessment.reasons || []).join(", "))}`,
        ""
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeAcceptanceReport(report, outputDirectory) {
  const directory = String(outputDirectory || "").trim();
  if (!directory) throw new Error("acceptance_report_directory_required");
  const resolvedDirectory = path.resolve(directory);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const jsonPath = path.join(resolvedDirectory, "junzan-real-guest-acceptance-report.json");
  const markdownPath = path.join(resolvedDirectory, "junzan-real-guest-acceptance-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, acceptanceReportMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function isRefreshableOidcRejection(error) {
  return Boolean(error
    && error.code === "acceptance_http_failed"
    && error.httpStatus === 403
    && error.httpErrorCode === "ACCEPTANCE_OIDC_REJECTED");
}

async function runAcceptanceMatrix({ baseUrl, propertyId, oidcToken, refreshOidcToken, commit, matrix = ACCEPTANCE_MATRIX, fetchImpl = globalThis.fetch, now = () => new Date(), write = (value) => console.log(JSON.stringify(value)), reportWriter = null, reportFinalizer = null }) {
  const failures = [];
  const reportCases = [];
  let currentOidcToken = oidcToken;
  let passCount = 0;
  let partialCount = 0;
  let executableCaseCount = 0;
  let executableTurnCount = 0;
  let notExecutableCaseCount = 0;
  let notExecutableTurnCount = 0;
  const turnCount = matrix.reduce((sum, item) => sum + item.turns.length, 0);
  async function requestForCase(caseId, turnNumber, options) {
    try {
      return await acceptanceRequest({ baseUrl, oidcToken: currentOidcToken, fetchImpl, ...options });
    } catch (error) {
      if (!isRefreshableOidcRejection(error) || typeof refreshOidcToken !== "function") throw error;
      write({
        case: caseId,
        turn: turnNumber,
        status: "OIDC_IDENTITY_REJECTED",
        errorCode: safeErrorCode(error),
        ...safeHttpEvidence(error, now())
      });
      currentOidcToken = await refreshOidcToken();
      return acceptanceRequest({ baseUrl, oidcToken: currentOidcToken, fetchImpl, ...options });
    }
  }
  for (const item of matrix) {
    const caseReport = { caseId: item.id, bucket: item.bucket || "", status: "", turns: [] };
    const conversationId = `gha-${commit.slice(0, 12)}-${item.id}-${crypto.randomUUID()}`;
    let firstRequest = null;
    let lastResult = null;
    let caseFailed = false;
    let caseExecuted = false;
    let caseSkipped = false;
    for (const [index, turn] of item.turns.entries()) {
      const reasonCode = item.executionStatus === NOT_EXECUTABLE_STATUS
        ? item.executionReasonCode
        : turn.executionStatus === NOT_EXECUTABLE_STATUS
          ? turn.executionReasonCode
          : "";
      if (reasonCode) {
        notExecutableTurnCount += 1;
        caseSkipped = true;
        caseReport.turns.push({
          turn: index + 1,
          guestQuestion: String(turn.messageText || ""),
          nativeEvent: turn.lineEvent ? { type: String(turn.lineEvent.message && turn.lineEvent.message.type || "") } : null,
          status: NOT_EXECUTABLE_STATUS,
          reasonCode,
          formalEvidence: [],
          finalResponse: { action: "", shouldReply: null, replyText: "" },
          assessment: { status: NOT_EXECUTABLE_STATUS, completeAnswer: false, formalDataConsistent: false, omissionDetected: null, unsupportedGuessDetected: null, offTopicDetected: null, unauthorizedCommitmentDetected: null, reasons: [reasonCode] }
        });
        write(safeNotExecutableEvidence(item.id, index + 1, reasonCode));
        continue;
      }
      caseExecuted = true;
      executableTurnCount += 1;
      const eventId = `gha-${item.id}-${index + 1}-${crypto.randomUUID()}`;
      const request = {
        customerId: propertyId,
        conversationId,
        eventId,
        ...(turn.lineEvent ? { lineEvent: turn.lineEvent } : { messageText: turn.messageText }),
        ...(turn.establishOperatorContext ? { establishOperatorContext: true } : {})
      };
      let result = null;
      let turnReported = false;
      try {
        result = await requestForCase(item.id, index + 1, { body: request });
        lastResult = result;
        if (!firstRequest) firstRequest = request;
        if (turn.lineEvent) validateNativeAcceptanceResult(result, turn);
        else validateAcceptanceResult(result, { ...turn, ...(turn.pastDatePolicy ? { evaluatedAt: now() } : {}) });
        if (turn.establishOperatorContext && (!result.operatorContext || result.operatorContext.established !== true || result.operatorContext.source !== "engine_final_response" || JSON.stringify(result.operatorContext.finalResponse) !== JSON.stringify(result.finalResponse))) throw new Error("operator_context_not_established_from_engine");
        const assessment = assessFinalResponseEvidence(result, turn);
        if (turn.lineEvent) Object.assign(assessment, { status: "PASS", completeAnswer: true, formalDataConsistent: true, omissionDetected: false, unsupportedGuessDetected: false, offTopicDetected: false, unauthorizedCommitmentDetected: false, reasons: ["native_event_safely_ignored_at_line_transport"] });
        caseReport.turns.push(reportTurn({ turnNumber: index + 1, turn, result, assessment, status: assessment.status }));
        turnReported = true;
        if (assessment.status !== "PASS") {
          const evidenceError = new Error(assessment.reasons[0] || "final_response_evidence_unproven");
          evidenceError.code = assessment.reasons[0] || "final_response_evidence_unproven";
          throw evidenceError;
        }
        write(safeEvidence(item.id, index + 1, result));
      } catch (error) {
        if (!turnReported) {
          const assessed = result ? assessFinalResponseEvidence(result, turn) : { status: "FAIL", completeAnswer: false, formalDataConsistent: false, omissionDetected: null, unsupportedGuessDetected: null, offTopicDetected: null, unauthorizedCommitmentDetected: null, reasons: [] };
          const assessment = {
            ...assessed,
            status: "FAIL",
            completeAnswer: false,
            formalDataConsistent: false,
            reasons: [...new Set([safeErrorCode(error), ...(assessed.reasons || [])])]
          };
          caseReport.turns.push(reportTurn({ turnNumber: index + 1, turn, result, assessment, error, status: "FAIL" }));
        }
        const failure = safeFailureEvidence(item.id, index + 1, error, result, now());
        failures.push(failure);
        write(failure);
        caseFailed = true;
      }
    }
    if (!caseExecuted) {
      notExecutableCaseCount += 1;
      caseReport.status = NOT_EXECUTABLE_STATUS;
      reportCases.push(caseReport);
      continue;
    }
    executableCaseCount += 1;
    if (caseFailed) {
      caseReport.status = "FAIL";
      reportCases.push(caseReport);
      continue;
    }
    try {
      if (item.mode === "duplicate") {
        const duplicate = await requestForCase(item.id, item.turns.length, { body: firstRequest });
        if (!duplicate || duplicate.duplicate !== true || duplicate.eventId !== firstRequest.eventId) throw new Error("duplicate_event_contract_failed");
      }
      if (item.mode === "clear") {
        const cleared = await requestForCase(item.id, item.turns.length, { method: "DELETE", body: { customerId: propertyId, conversationId } });
        if (!cleared || cleared.cleared !== true) throw new Error("clear_state_contract_failed");
      }
      if (caseSkipped) {
        partialCount += 1;
        caseReport.status = "PARTIAL_NOT_EXECUTABLE";
      } else {
        passCount += 1;
        caseReport.status = "PASS";
      }
    } catch (error) {
      const failure = safeFailureEvidence(item.id, item.turns.length, error, lastResult, now());
      failures.push(failure);
      write(failure);
      caseReport.status = "FAIL";
    }
    reportCases.push(caseReport);
  }
  const summary = {
    caseCount: matrix.length,
    turnCount,
    executableCaseCount,
    executableTurnCount,
    passCount,
    partialCount,
    failCount: reportCases.filter((item) => item.status === "FAIL").length,
    notExecutableCaseCount,
    notExecutableTurnCount
  };
  const report = {
    schemaVersion: 1,
    commit,
    generatedAt: now().toISOString(),
    environment: {
      runtime: "test-only-render",
      propertyId,
      requiredPlanner: "openai",
      requiredProvider: "postgresql"
    },
    summary,
    cases: reportCases
  };
  if (!failures.length && typeof reportFinalizer === "function") {
    try {
      report.attribution = reportFinalizer(report);
    } catch (error) {
      report.attribution = { status: safeErrorCode(error) };
      if (typeof reportWriter === "function") reportWriter(report);
      Object.assign(error, summary, { report });
      throw error;
    }
  }
  if (typeof reportWriter === "function") reportWriter(report);
  if (failures.length) {
    const error = new Error("deployed_acceptance_matrix_failed");
    error.code = "deployed_acceptance_matrix_failed";
    Object.assign(error, summary);
    error.report = report;
    throw error;
  }
  return summary;
}

function missingExpectedSemanticEvidence(result, expectation = {}) {
  const tags = new Set(expectation.expectedSemantic || []);
  const tasks = Array.isArray(result && result.taskResults) ? result.taskResults : [];
  const canonicalItems = Array.isArray(result && result.trace)
    ? result.trace.filter((entry) => entry && entry.stage === "canonical_request").flatMap((entry) => Array.isArray(entry.items) ? entry.items : [])
    : [];
  const capabilities = new Set([
    ...tasks.flatMap((task) => [task && task.capability, task && task.type].filter(Boolean)),
    ...canonicalItems.map((item) => item && item.capability).filter(Boolean)
  ]);
  const canonicalIds = new Set(canonicalItems.map((item) => String(item && item.canonicalEntity && item.canonicalEntity.canonicalId || "")).filter(Boolean));
  const requirements = new Map([
    ["price", () => capabilities.has("price") || capabilities.has("total_price")],
    ["total_price", () => capabilities.has("total_price") || capabilities.has("price")],
    ["pool", () => capabilities.has("pool") || canonicalIds.has("pool")],
    ["check_in", () => canonicalIds.has("check_in")],
    ["parking", () => capabilities.has("parking") || canonicalIds.has("parking")],
    ["bbq", () => capabilities.has("bbq") || canonicalIds.has("bbq")],
    ["ktv", () => canonicalIds.has("ktv") || canonicalIds.has("singing")]
  ]);
  return [...tags].filter((tag) => requirements.has(tag) && !requirements.get(tag)());
}

const OPAQUE_REPAIR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPAIR_KINDS = new Set(["coverage_repair", "task_collection_repair", "semantic_repair"]);

function canonicalRepairEvidenceMatchesExpectation(item, expectation = {}) {
  const capability = String(item && item.capability || "");
  const expectedCapabilities = Array.isArray(expectation.expectedCapabilities) ? expectation.expectedCapabilities : [];
  const capabilityMatch = expectedCapabilities.some((alternatives) =>
    Array.isArray(alternatives) && alternatives.includes(capability));
  const semanticTags = new Set(Array.isArray(expectation.expectedSemantic) ? expectation.expectedSemantic : []);
  const canonicalId = String(item && item.canonicalEntity && item.canonicalEntity.canonicalId || "").toLowerCase();
  const category = String(item && item.canonicalEntity && item.canonicalEntity.category || "").toLowerCase();
  const subjectMatches = [
    ["pool", () => canonicalId === "pool"],
    ["check_in", () => canonicalId === "check_in"],
    ["parking", () => canonicalId === "parking"],
    ["bbq", () => canonicalId === "bbq"],
    ["kitchen", () => canonicalId === "kitchen"],
    ["ktv", () => canonicalId === "ktv" || canonicalId === "singing"],
    ["bundle", () => category === "bundle" || capability === "bundle_availability"]
  ];
  const numberedRoomTags = [...semanticTags].filter((tag) => /^room_\d+$/i.test(tag));
  const roomShapeTags = [...semanticTags].filter((tag) =>
    /(?:^|_)(?:room|rooms)(?:_|$)/i.test(tag) && !/^room_\d+$/i.test(tag));
  const formalSubjectRequired = subjectMatches.some(([tag]) => semanticTags.has(tag))
    || numberedRoomTags.length > 0
    || roomShapeTags.length > 0;
  const subjectMatch = subjectMatches.some(([tag, matches]) => semanticTags.has(tag) && matches())
    || numberedRoomTags.some((tag) => canonicalId.includes(tag.slice(5)))
    || roomShapeTags.length > 0 && category === "room";
  if (formalSubjectRequired) return subjectMatch && (capabilityMatch || expectedCapabilities.length === 0);
  if (capabilityMatch) return true;
  const replacementDateExpected = [...semanticTags].some((tag) =>
    ["replace_date_range", "clarify_existing_booking", "confirm_replacement_date"].includes(tag));
  const temporalState = item && item.temporalState || {};
  return expectedCapabilities.length === 0
    && replacementDateExpected
    && Boolean(temporalState.checkIn || temporalState.checkOut || temporalState.expressionType);
}

function directlyAttributedCanonicalEvidence(runtime, expectation) {
  const provenance = [];
  for (const entry of Array.isArray(runtime.planner) ? runtime.planner : []) {
    for (const item of Array.isArray(entry && entry.repairProvenance) ? entry.repairProvenance : []) {
      const kind = String(item && item.kind || "");
      const sourceValid = kind === "coverage_repair"
        ? entry.coverageRepairPerformed === true || entry.coverageRepairFallback === true
        : kind === "task_collection_repair"
          ? entry.taskCollectionRepairPerformed === true
            && Number(entry.preservedTaskCount) >= 1
            && Number(entry.fallbackTaskCount) >= 1
          : false;
      provenance.push({ kind, correlationId: String(item && item.correlationId || ""), sourceValid });
    }
  }
  for (const entry of Array.isArray(runtime.validation) ? runtime.validation : []) {
    for (const item of Array.isArray(entry && entry.repairProvenance) ? entry.repairProvenance : []) {
      const kind = String(item && item.kind || "");
      provenance.push({ kind, correlationId: String(item && item.correlationId || ""), sourceValid: kind === "semantic_repair" });
    }
  }
  if (!provenance.length || provenance.length > 24) return null;
  const provenanceIds = new Set();
  for (const item of provenance) {
    if (!item.sourceValid || !REPAIR_KINDS.has(item.kind) || !OPAQUE_REPAIR_ID_PATTERN.test(item.correlationId)
      || provenanceIds.has(item.correlationId)) return null;
    provenanceIds.add(item.correlationId);
  }
  const canonicalItems = (Array.isArray(runtime.canonicalRequest) ? runtime.canonicalRequest : [])
    .flatMap((entry) => Array.isArray(entry && entry.items) ? entry.items : []);
  const canonicalByCorrelation = new Map();
  const correlationByCanonicalTask = new Map();
  for (const item of canonicalItems) {
    if (!Object.hasOwn(item || {}, "repairCorrelationId")) continue;
    const correlationId = String(item && item.repairCorrelationId || "");
    const taskId = String(item && item.taskId || "");
    if (!OPAQUE_REPAIR_ID_PATTERN.test(correlationId) || !provenanceIds.has(correlationId)
      || !taskId || canonicalByCorrelation.has(correlationId)
      || correlationByCanonicalTask.has(taskId) && correlationByCanonicalTask.get(taskId) !== correlationId) return null;
    canonicalByCorrelation.set(correlationId, item);
    correlationByCanonicalTask.set(taskId, correlationId);
  }
  if (canonicalByCorrelation.size !== provenanceIds.size) return null;
  const joined = provenance.map((item) => canonicalByCorrelation.get(item.correlationId));
  return joined.some((item) => canonicalRepairEvidenceMatchesExpectation(item, expectation))
    ? joined
    : null;
}

function validateTargetPreflightAttribution(report) {
  const evidence = [];
  for (const caseId of TARGET_PREFLIGHT_CASE_IDS) {
    const item = (report.cases || []).find((candidate) => candidate.caseId === caseId);
    if (!item || item.status !== "PASS" || !Array.isArray(item.turns) || !item.turns.length) {
      throw Object.assign(new Error("TARGET_PASS_ATTRIBUTION_UNPROVEN"), { code: "TARGET_PASS_ATTRIBUTION_UNPROVEN" });
    }
    const expectedTurnCount = TARGET_PREFLIGHT_TURNS[caseId].length;
    if (item.turns.length !== expectedTurnCount) throw Object.assign(new Error("TARGET_PASS_ATTRIBUTION_UNPROVEN"), { code: "TARGET_PASS_ATTRIBUTION_UNPROVEN" });
    let completeTurnCount = 0;
    for (let turnIndex = 0; turnIndex < item.turns.length; turnIndex += 1) {
      const turn = item.turns[turnIndex];
      const runtime = turn.runtimeEvidence || {};
      const sourceCase = DEPLOYED_ACCEPTANCE_MATRIX.find((candidate) => candidate.id === caseId);
      const sourceTurnNumber = TARGET_PREFLIGHT_TURNS[caseId][turnIndex];
      const expectation = sourceCase && sourceCase.turns[sourceTurnNumber - 1];
      const expectedCapabilities = Array.isArray(expectation && expectation.expectedCapabilities) ? expectation.expectedCapabilities : [];
      const canonicalItems = (Array.isArray(runtime.canonicalRequest) ? runtime.canonicalRequest : [])
        .flatMap((entry) => Array.isArray(entry && entry.items) ? entry.items : []);
      const actualCapabilities = new Set(canonicalItems.map((entry) => String(entry && entry.capability || "")).filter(Boolean));
      const capabilityMissing = expectedCapabilities.some((alternatives) =>
        !alternatives.some((capability) => actualCapabilities.has(capability)));
      const semanticMissing = missingExpectedSemanticEvidence({ trace: runtime.canonicalRequest || [] }, expectation || {});
      const requiresNoAvailabilityQuery = Array.isArray(expectation && expectation.expectedActions)
        && expectation.expectedActions.includes("clarification")
        && (expectation.expectedSemantic || []).some((tag) => ["availability", "date_clarification", "price", "total_price", "holiday_price"].includes(tag));
      const prematureAvailabilityQuery = requiresNoAvailabilityQuery
        && (runtime.queryPlan || []).flatMap((entry) => Array.isArray(entry && entry.items) ? entry.items : [])
          .some((entry) => {
            const operation = String(entry && entry.operation || "");
            const capability = operation === "availability_resolver" ? String(entry && entry.capability || "") : operation;
            const definition = getCapabilityDefinition(capability);
            return operation === "availability_resolver" || definition && definition.resolverId === "availability_resolver";
          });
      const directlyAttributedEvidence = directlyAttributedCanonicalEvidence(runtime, expectation || {});
      const intendedBoundaryProven = caseId === "rg-023-pool-fee"
        ? Boolean(directlyAttributedEvidence
          && directlyAttributedEvidence.some((entry) => entry
            && entry.canonicalEntity
            && entry.canonicalEntity.canonicalId === "pool"))
        : Boolean(directlyAttributedEvidence);
      const completeTrace = runtime.providerType === "postgres"
        || runtime.providerType === "postgresql";
      if (!completeTrace
        || runtime.plannerParserSucceeded !== true
        || !(runtime.planner || []).length
        || runtime.semanticContractValidationPassed !== true
        || !(runtime.canonicalRequest || []).length
        || !(runtime.conversationState || []).length
        || !(runtime.queryPlan || []).length
        || !(runtime.resolverExecution || []).length
        || !turn.claimValidation || turn.claimValidation.ok !== true
        || !turn.finalDecision || !turn.finalDecision.action
        || !turn.finalResponse || typeof turn.finalResponse.replyText !== "string"
        || !intendedBoundaryProven
        || capabilityMissing
        || semanticMissing.length
        || prematureAvailabilityQuery) {
        throw Object.assign(new Error("TARGET_PASS_ATTRIBUTION_UNPROVEN"), { code: "TARGET_PASS_ATTRIBUTION_UNPROVEN" });
      }
      completeTurnCount += 1;
    }
    evidence.push({ caseId, completeTurnCount, providerType: "postgresql", traceStatus: "complete", repairAttribution: "proven" });
  }
  return { status: "TARGET_PASS_ATTRIBUTION_PROVEN", cases: evidence };
}
async function main(env = process.env) {
  const commit = String(env.GITHUB_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("github_sha_required");
  validateWorkflowIdentity(env);
  const acceptance = acceptanceMatrixForMode(env);
  const baseUrl = String(env.TEST_ONLY_ACCEPTANCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const propertyId = String(env.TEST_ONLY_ACCEPTANCE_PROPERTY_ID || "nephi_home").trim();
  const reportDirectory = String(env.TEST_ONLY_ACCEPTANCE_REPORT_DIR || "").trim();
  if (!reportDirectory) throw new Error("acceptance_report_directory_required");
  const health = await pollForDeployment({ baseUrl, expectedCommit: commit });
  console.log(JSON.stringify({ stage: "deployment-ready", status: health.status, testOnly: health.testOnly, commit: health.commit }));
  const oidcRequest = { requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL, requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN };
  const oidcToken = await requestGithubOidcToken(oidcRequest);
  const summary = await runAcceptanceMatrix({
    baseUrl,
    propertyId,
    oidcToken,
    refreshOidcToken: () => requestGithubOidcToken(oidcRequest),
    commit,
    matrix: acceptance.matrix,
    reportFinalizer: acceptance.mode === "target_preflight" ? validateTargetPreflightAttribution : null,
    reportWriter: (report) => writeAcceptanceReport(report, reportDirectory)
  });
  console.log(JSON.stringify({ suite: "deployed-conversation-acceptance", mode: acceptance.mode, ...summary, commit }));
}
if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({
    suite: "deployed-conversation-acceptance",
    status: "FAIL",
    errorCode: safeErrorCode(error),
    caseCount: Number.isInteger(error && error.caseCount) ? error.caseCount : DEPLOYED_ACCEPTANCE_MATRIX.length,
    turnCount: Number.isInteger(error && error.turnCount) ? error.turnCount : DEPLOYED_ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0),
    executableCaseCount: Number.isInteger(error && error.executableCaseCount) ? error.executableCaseCount : 0,
    executableTurnCount: Number.isInteger(error && error.executableTurnCount) ? error.executableTurnCount : 0,
    passCount: Number.isInteger(error && error.passCount) ? error.passCount : 0,
    partialCount: Number.isInteger(error && error.partialCount) ? error.partialCount : 0,
    failCount: Number.isInteger(error && error.failCount) ? error.failCount : 1,
    notExecutableCaseCount: Number.isInteger(error && error.notExecutableCaseCount) ? error.notExecutableCaseCount : 0,
    notExecutableTurnCount: Number.isInteger(error && error.notExecutableTurnCount) ? error.notExecutableTurnCount : 0
  }));
  process.exitCode = 1;
});

module.exports = {
  ACCEPTANCE_MATRIX,
  SUPPLEMENTAL_ACCEPTANCE_MATRIX,
  DEPLOYED_ACCEPTANCE_MATRIX,
  TARGET_PREFLIGHT_CASE_IDS,
  TARGET_PREFLIGHT_TURNS,
  loadAcceptanceMatrix,
  loadSupplementalAcceptanceMatrix,
  NOT_EXECUTABLE_STATUS,
  pollForDeployment,
  requestGithubOidcToken,
  validateAcceptanceResult,
  validateNativeAcceptanceResult,
  assessFinalResponseEvidence,
  writeAcceptanceReport,
  runAcceptanceMatrix,
  selectAcceptanceMatrix,
  validateWorkflowIdentity,
  acceptanceMatrixForMode,
  validateTargetPreflightAttribution,
  TEST_ONLY_ACCEPTANCE_AUDIENCE
};
