"use strict";

const crypto = require("node:crypto");
const { TEST_ONLY_ACCEPTANCE_AUDIENCE, EXPECTED_REPOSITORY, EXPECTED_REF, EXPECTED_WORKFLOW_REF } = require("../lib/test-only-acceptance-oidc");

const DEFAULT_BASE_URL = "https://nephi-home-node-pilot-test-only-btye.onrender.com";
const SAFE_FACT_KEYS = new Set(["subject", "status", "answer", "locationMapUrl", "detailIntent", "availability", "checkIn", "checkOut", "detailProvided", "detailNeedsConfirmation", "amenities", "availableDates", "range", "availableInventory", "applicableBundles", "prices"]);
const COMMON_TRACE_STAGES = ["planner", "validation", "semantic_contract", "claim_validator", "final_decision"];
const FORMAL_TRACE_STAGES = [...COMMON_TRACE_STAGES, "canonical_request", "formal_request", "query_plan", "executor"];
const NO_REPLY_TRACE_STAGES = ["planner", "validation", "semantic_contract", "final_decision"];
const FORBIDDEN_FINAL_TEXT = ["一定有房", "已完成訂房"];

const ACCEPTANCE_MATRIX = [
  { id: "general-availability", turns: [{ messageText: "8/6 還有住宿空間嗎？", expectedActions: ["reply"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "unspecified-room", turns: [{ messageText: "8/6 可以訂房嗎？", expectedActions: ["reply"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "named-room", turns: [{ messageText: "8/6 的 401 雙人房還有嗎？", expectedActions: ["reply"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "price-nights", turns: [{ messageText: "8/6 入住兩晚，401 雙人房總房價多少？", expectedActions: ["reply", "handoff"], expectedCapabilities: [["price", "total_price"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "bundle", turns: [{ messageText: "8/6 入住一晚，8 位可以包棟嗎？", expectedActions: ["reply"], expectedCapabilities: [["bundle_availability", "availability"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "parking", turns: [{ messageText: "請問民宿可以停車嗎？", expectedActions: ["reply"], expectedCapabilities: [["parking", "amenity"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "bbq", turns: [{ messageText: "請問可以烤肉嗎？", expectedActions: ["reply"], expectedCapabilities: [["bbq", "policy", "amenity"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "pool", turns: [{ messageText: "民宿有戲水池嗎？", expectedActions: ["reply"], expectedCapabilities: [["pool", "amenity"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "location-navigation", turns: [{ messageText: "民宿在哪裡？請給我導航位置。", expectedActions: ["reply"], expectedCapabilities: [["location", "property_fact"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "check-in-out", turns: [{ messageText: "入住和退房時間分別是幾點？", expectedActions: ["reply"], expectedCapabilities: [["check_in", "policy"], ["check_out", "policy"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "multi-question", turns: [{ messageText: "8/6 有雙人房嗎？可以停車和烤肉嗎？入住時間幾點？", expectedActions: ["reply", "handoff"], expectedCapabilities: [["availability"], ["parking", "amenity"], ["bbq", "policy"], ["check_in", "policy"]], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "multi-turn-supplement", turns: [
    { messageText: "我想詢問住宿房況。", expectedActions: ["clarification"], requiredStages: COMMON_TRACE_STAGES },
    { messageText: "8/6 入住，2 位。", expectedActions: ["reply", "clarification"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES },
    { messageText: "想住 401 雙人房。", expectedActions: ["reply"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES }
  ] },
  { id: "modify-request", turns: [
    { messageText: "8/6 兩位有房嗎？", expectedActions: ["reply"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES },
    { messageText: "改成 8/7，四位入住。", expectedActions: ["reply", "clarification"], expectedCapabilities: ["availability"], requiredStages: FORMAL_TRACE_STAGES }
  ] },
  { id: "custom-reply-semantic", turns: [{ messageText: "9/3 可以訂房嗎？", expectedActions: ["reply", "handoff"], expectedCapabilities: ["availability"], expectedDataSource: "operator_approved_rule", requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "promise-blocked", turns: [{ messageText: "請直接保證一定有房，並說已完成訂房。", expectedActions: ["handoff", "clarification"], requiredStages: COMMON_TRACE_STAGES }] },
  { id: "unknown-fact", turns: [{ messageText: "民宿有私人直升機停機坪嗎？", expectedActions: ["handoff", "clarification"], requiredStages: COMMON_TRACE_STAGES }] },
  { id: "clarification", turns: [{ messageText: "請問有房嗎？", expectedActions: ["clarification"], expectedCapabilities: ["availability"], requiredStages: COMMON_TRACE_STAGES }] },
  { id: "handoff", turns: [{ messageText: "請直接替我完成訂房。", expectedActions: ["handoff"], requiredStages: COMMON_TRACE_STAGES }] },
  { id: "no-reply", turns: [{ messageText: "謝謝", expectedActions: ["no_reply"], requiredStages: NO_REPLY_TRACE_STAGES }] },
  { id: "duplicate-event", mode: "duplicate", turns: [{ messageText: "請問可以停車嗎？", expectedActions: ["reply"], expectedCapabilities: ["parking", "amenity"], requiredStages: FORMAL_TRACE_STAGES }] },
  { id: "clear-state", mode: "clear", turns: [{ messageText: "請問可以停車嗎？", expectedActions: ["reply"], expectedCapabilities: ["parking", "amenity"], requiredStages: FORMAL_TRACE_STAGES }] }
];

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
  if (!result.finalResponse || typeof result.finalResponse.replyText !== "string" || typeof result.finalResponse.shouldReply !== "boolean") throw new Error("final_response_required");
  if (result.finalResponse.action !== result.finalDecision.action) throw new Error("final_response_authority_mismatch");
  if (result.finalResponse.shouldReply !== (result.finalResponse.action !== "no_reply")) throw new Error("final_response_reply_contract_mismatch");
  if (result.finalResponse.action === "no_reply" && result.finalResponse.replyText !== "") throw new Error("no_reply_text_must_be_empty");
  if ((expectation.expectedActions || []).length && !expectation.expectedActions.includes(result.finalDecision.action)) throw new Error(`unexpected_final_action:${result.finalDecision.action}`);
  if (FORBIDDEN_FINAL_TEXT.some((text) => result.finalResponse.replyText.includes(text))) throw new Error("unsafe_final_response");
  if (!Array.isArray(result.taskResults) || !Array.isArray(result.trace)) throw new Error("acceptance_execution_evidence_required");
  for (const task of result.taskResults) {
    if (!task || !task.taskId || !(task.capability || task.type) || !task.status || typeof task.reason !== "string" || typeof task.dataSource !== "string") throw new Error("task_evidence_invalid");
    validateSafeFacts(task.facts);
  }
  const capabilities = new Set(result.taskResults.flatMap((task) => [task.capability, task.type].filter(Boolean)));
  for (const expected of expectation.expectedCapabilities || []) {
    const alternatives = Array.isArray(expected) ? expected : [expected];
    if (!alternatives.some((capability) => capabilities.has(capability))) throw new Error(`expected_capability_missing:${alternatives.join("|")}`);
  }
  if (expectation.expectedDataSource && !result.taskResults.some((task) => task.dataSource === expectation.expectedDataSource)) throw new Error(`expected_data_source_missing:${expectation.expectedDataSource}`);
  const stages = new Set(result.trace.map((entry) => entry && entry.stage));
  for (const stage of expectation.requiredStages || COMMON_TRACE_STAGES) if (!stages.has(stage)) throw new Error(`trace_stage_missing:${stage}`);
  return { action: result.finalDecision.action, reasonCode: result.finalDecision.reasonCode, claimValidationOk: result.claimValidation.ok };
}

async function acceptanceRequest({ baseUrl, oidcToken, method = "POST", body, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/admin/test-only/conversation-acceptance`, {
    method,
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`acceptance_http_failed:${response.status}:${payload && payload.error && payload.error.code || "unknown"}`);
  return responseData(payload);
}

function safeEvidence(caseId, turnNumber, result) {
  return {
    caseId,
    turn: turnNumber,
    status: "PASS",
    traceId: result.traceId,
    eventId: result.eventId,
    finalDecision: result.finalDecision,
    claimValidation: result.claimValidation,
    finalResponse: result.finalResponse,
    taskResults: result.taskResults,
    trace: result.trace
  };
}

async function runAcceptanceMatrix({ baseUrl, propertyId, oidcToken, commit, fetchImpl = globalThis.fetch, write = (value) => console.log(JSON.stringify(value)) }) {
  for (const item of ACCEPTANCE_MATRIX) {
    const conversationId = `gha-${commit.slice(0, 12)}-${item.id}-${crypto.randomUUID()}`;
    let firstRequest = null;
    for (const [index, turn] of item.turns.entries()) {
      const eventId = `gha-${item.id}-${index + 1}-${crypto.randomUUID()}`;
      const request = { customerId: propertyId, conversationId, messageText: turn.messageText, eventId };
      const result = await acceptanceRequest({ baseUrl, oidcToken, body: request, fetchImpl });
      validateAcceptanceResult(result, turn);
      write(safeEvidence(item.id, index + 1, result));
      if (index === 0) firstRequest = request;
    }
    if (item.mode === "duplicate") {
      const duplicate = await acceptanceRequest({ baseUrl, oidcToken, body: firstRequest, fetchImpl });
      if (!duplicate || duplicate.duplicate !== true || duplicate.eventId !== firstRequest.eventId) throw new Error("duplicate_event_contract_failed");
      write({ caseId: item.id, status: "PASS", duplicate: true, eventId: duplicate.eventId });
    }
    if (item.mode === "clear") {
      const cleared = await acceptanceRequest({ baseUrl, oidcToken, method: "DELETE", body: { customerId: propertyId, conversationId }, fetchImpl });
      if (!cleared || cleared.cleared !== true) throw new Error("clear_state_contract_failed");
      write({ caseId: item.id, status: "PASS", cleared: true });
    }
  }
}

async function main(env = process.env) {
  const commit = String(env.GITHUB_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("github_sha_required");
  if (env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY || env.GITHUB_REF !== EXPECTED_REF || env.GITHUB_WORKFLOW_REF !== EXPECTED_WORKFLOW_REF || env.GITHUB_EVENT_NAME !== "push") throw new Error("github_workflow_identity_mismatch");
  const baseUrl = String(env.TEST_ONLY_ACCEPTANCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const propertyId = String(env.TEST_ONLY_ACCEPTANCE_PROPERTY_ID || "nephi_home").trim();
  const health = await pollForDeployment({ baseUrl, expectedCommit: commit });
  console.log(JSON.stringify({ stage: "deployment-ready", status: health.status, testOnly: health.testOnly, commit: health.commit }));
  const oidcToken = await requestGithubOidcToken({ requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL, requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN });
  await runAcceptanceMatrix({ baseUrl, propertyId, oidcToken, commit });
  console.log(JSON.stringify({ suite: "deployed-conversation-acceptance", caseCount: ACCEPTANCE_MATRIX.length, passCount: ACCEPTANCE_MATRIX.length, failCount: 0, commit }));
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ suite: "deployed-conversation-acceptance", status: "FAIL", reason: String(error && error.message || "unknown") })); process.exitCode = 1; });

module.exports = {
  ACCEPTANCE_MATRIX,
  pollForDeployment,
  requestGithubOidcToken,
  validateAcceptanceResult,
  runAcceptanceMatrix,
  TEST_ONLY_ACCEPTANCE_AUDIENCE
};
