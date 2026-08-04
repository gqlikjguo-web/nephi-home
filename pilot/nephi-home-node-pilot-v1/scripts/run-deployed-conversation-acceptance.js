"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TEST_ONLY_ACCEPTANCE_AUDIENCE, EXPECTED_REPOSITORY, EXPECTED_REF, EXPECTED_WORKFLOW_REF } = require("../lib/test-only-acceptance-oidc");

const DEFAULT_BASE_URL = "https://nephi-home-node-pilot-test-only-btye.onrender.com";
const SAFE_FACT_KEYS = new Set(["subject", "status", "answer", "locationMapUrl", "detailIntent", "availability", "checkIn", "checkOut", "detailProvided", "detailNeedsConfirmation", "amenities", "availableDates", "range", "availableInventory", "applicableBundles", "prices"]);
const COMMON_TRACE_STAGES = ["planner", "validation", "semantic_contract", "claim_validator", "final_decision"];
const FORMAL_TRACE_STAGES = [...COMMON_TRACE_STAGES, "canonical_request", "formal_request", "query_plan", "executor"];
const NO_REPLY_TRACE_STAGES = ["planner", "validation", "semantic_contract", "final_decision"];
const FORBIDDEN_FINAL_TEXT = ["一定有房", "已完成訂房"];

const MATRIX_PATH = path.resolve(__dirname, "../tests/fixtures/real-guest-fixed-matrix.json");
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
  if (semanticTags.has("bundle") && canonicalItems.length && !canonicalItems.some((item) => item.capability === "bundle_availability" || item.canonicalEntity && item.canonicalEntity.category === "bundle")) throw new Error("expected_bundle_scope_missing");
  for (const roomNumber of ["301", "402"]) {
    if (semanticTags.has(`room_${roomNumber}`) && canonicalItems.length && !canonicalItems.some((item) => String(item.canonicalEntity && item.canonicalEntity.canonicalId || "").includes(roomNumber))) throw new Error(`expected_room_scope_missing:${roomNumber}`);
  }
  if (semanticTags.has("date_range") && canonicalItems.length && !canonicalItems.some((item) => item.temporalState && item.temporalState.checkIn && item.temporalState.checkOut)) throw new Error("expected_date_range_missing");
  if (semanticTags.has("nights") && canonicalItems.length && !canonicalItems.some((item) => Number.isInteger(item.temporalState && item.temporalState.nights) && item.temporalState.nights > 0)) throw new Error("expected_nights_missing");
  const stages = new Set(result.trace.map((entry) => entry && entry.stage));
  const requiredStages = expectation.requiredStages || (result.finalDecision.action === "no_reply" ? NO_REPLY_TRACE_STAGES : result.finalDecision.action === "reply" && result.taskResults.some((task) => task.status === "answered") ? FORMAL_TRACE_STAGES : COMMON_TRACE_STAGES);
  for (const stage of requiredStages) if (!stages.has(stage)) throw new Error(`trace_stage_missing:${stage}`);
  return { action: result.finalDecision.action, reasonCode: result.finalDecision.reasonCode, claimValidationOk: result.claimValidation.ok };
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
    semanticContractValidationPassed: semanticContract.validationPassed === true
  };
}

function reportTurn({ turnNumber, turn, result, assessment, error, status }) {
  const finalDecision = result && result.finalDecision || {};
  const claimValidation = result && result.claimValidation || {};
  const finalResponse = result && result.finalResponse || {};
  return {
    turn: turnNumber,
    guestQuestion: String(turn && turn.messageText || ""),
    status,
    errorCode: error ? safeErrorCode(error) : "",
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
        `- Result: ${markdownText(turn.status)}`,
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

async function runAcceptanceMatrix({ baseUrl, propertyId, oidcToken, refreshOidcToken, commit, fetchImpl = globalThis.fetch, now = () => new Date(), write = (value) => console.log(JSON.stringify(value)), reportWriter = null }) {
  const failures = [];
  const reportCases = [];
  let currentOidcToken = oidcToken;
  let passCount = 0;
  let partialCount = 0;
  let executableCaseCount = 0;
  let executableTurnCount = 0;
  let notExecutableCaseCount = 0;
  let notExecutableTurnCount = 0;
  const turnCount = ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0);
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
  for (const item of ACCEPTANCE_MATRIX) {
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
      const request = { customerId: propertyId, conversationId, messageText: turn.messageText, eventId };
      let result = null;
      let turnReported = false;
      try {
        result = await requestForCase(item.id, index + 1, { body: request });
        lastResult = result;
        if (!firstRequest) firstRequest = request;
        validateAcceptanceResult(result, turn);
        const assessment = assessFinalResponseEvidence(result, turn);
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
    caseCount: ACCEPTANCE_MATRIX.length,
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
async function main(env = process.env) {
  const commit = String(env.GITHUB_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("github_sha_required");
  if (env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY || env.GITHUB_REF !== EXPECTED_REF || env.GITHUB_WORKFLOW_REF !== EXPECTED_WORKFLOW_REF || env.GITHUB_EVENT_NAME !== "push") throw new Error("github_workflow_identity_mismatch");
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
    reportWriter: (report) => writeAcceptanceReport(report, reportDirectory)
  });
  console.log(JSON.stringify({ suite: "deployed-conversation-acceptance", ...summary, commit }));
}
if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({
    suite: "deployed-conversation-acceptance",
    status: "FAIL",
    errorCode: safeErrorCode(error),
    caseCount: Number.isInteger(error && error.caseCount) ? error.caseCount : ACCEPTANCE_MATRIX.length,
    turnCount: Number.isInteger(error && error.turnCount) ? error.turnCount : ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0),
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
  loadAcceptanceMatrix,
  NOT_EXECUTABLE_STATUS,
  pollForDeployment,
  requestGithubOidcToken,
  validateAcceptanceResult,
  assessFinalResponseEvidence,
  writeAcceptanceReport,
  runAcceptanceMatrix,
  TEST_ONLY_ACCEPTANCE_AUDIENCE
};
