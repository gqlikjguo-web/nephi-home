"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeCanonicalQueryPlans } = require("../lib/conversation-engine-v2/capability-executor");
const { createCanonicalRequest } = require("../lib/conversation-engine-v2/canonical-request");
const { projectCapabilityRegistry } = require("../lib/new-core/capability-subject-policy");
const { normalizeSelfCheckInOutInstructions } = require("../lib/self-check-in-out-instructions");

const root = path.join(__dirname, "..");
const identity = "self_check_in_out_instructions";
const setting = { status: "allowed", publicText: "本館採自助入住，入住當天會提供入住密碼及相關說明。", notes: "門鎖資訊由業者管理" };
const property = { propertyId: "alpha", displayName: "Alpha", timezone: "Asia/Taipei", rooms: [], commonAnswers: {}, propertyFacts: [], selfCheckInOutInstructions: setting };
const catalog = buildPropertyCatalog(property);
const fact = catalog.policies.find((item) => item.canonicalId === identity);
assert.ok(fact, "RED: approved self check-in/out identity must be projected into the formal property catalog");
assert.equal(fact.status, "confirmed_yes");
assert.equal(fact.answer, setting.publicText);
assert.equal(Object.hasOwn(fact, "applicability"), false, "RED: self check-in/out must not retain date applicability");
assert.match(projectCapabilityRegistry().policy.understandingDescription, /self-check-in|self check-in/i, "RED: shared policy guidance must expose the approved semantic identity");
assert.deepEqual(normalizeSelfCheckInOutInstructions({ enabled: true, content: "舊資料內容", applicableMonth: 9, validUntil: "2026-12-31" }), { status: "allowed", publicText: "舊資料內容", notes: "" }, "legacy JSONB must remain readable without retaining date behavior");
assert.deepEqual(normalizeSelfCheckInOutInstructions(null), { status: "unknown", publicText: "", notes: "" });
assert.equal(buildPropertyCatalog({ ...property, selfCheckInOutInstructions: { status: "allowed", publicText: "", notes: "不得外洩" } }).policies.find((item) => item.canonicalId === identity).status, "unknown", "a status without formal public text must not create an answer");

function plan(taskId, checkIn) {
  const temporalState = { rawText: checkIn || "", expressionType: checkIn ? "date" : "none", checkIn: checkIn || null, checkOut: checkIn ? `${checkIn.slice(0, 8)}${String(Number(checkIn.slice(8)) + 1).padStart(2, "0")}` : null, nights: checkIn ? 1 : null, searchRange: null, timezone: "Asia/Taipei", resolutionStatus: checkIn ? "resolved" : "absent", resolutionSource: checkIn ? "explicit" : "none", repairReasonCode: "", applicableTaskIds: checkIn ? [taskId] : [], ambiguity: null, originalExpression: checkIn || "", provenance: [], ruleRefs: [], derivedFromFieldRefs: [], fields: {} };
  const canonicalRequest = createCanonicalRequest({ taskId, capability: "policy", canonicalEntity: { category: "policy", canonicalId: identity, canonicalSet: [], status: "resolved", rawText: "" }, lodgingProduct: { productType: "any", productId: null }, detailIntent: "general", temporalState, stayDependency: false, requiredFields: [], resolverId: "property_catalog", riskLevel: "low", responseMode: "answer", evidenceRefs: [] });
  return { formalRequestId: `cycle:${taskId}`, taskId, requestCycleId: "cycle", propertyId: property.propertyId, canonicalRequest, capability: "policy", resolverId: "property_catalog", riskLevel: "low", responseMode: "answer", detailIntent: "general", conditions: { stay: { checkIn: temporalState.checkIn, checkOut: temporalState.checkOut }, inventory: { mode: "any" }, topic: {} }, entity: canonicalRequest.canonicalEntity };
}

const september = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("sep", "2026-09-20")], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(september.outcome, "answered", "matching check-in month must use the formal fact");
const october = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("oct", "2026-10-20")], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(october.outcome, "answered", "the formal policy must not retain date applicability");
const noDate = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("none", null)], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(noDate.outcome, "answered", "the formal policy must be usable without a check-in date");

const html = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/assets/admin.js"), "utf8");
assert.doesNotMatch(js, /selfCheckInOutApplicableMonth|selfCheckInOutValidUntil|selfCheckInOutEnabled/, "RED: date and enable controls must be removed");
assert.match(js, /selfCheckInOutCard\(\)[^\n]*propertyFactCardRow/, "RED: the card must use the shared policy-card renderer");
assert.match(js, /selfCheckInOutPayload\(\)[^\n]*status[^\n]*publicText[^\n]*notes/, "RED: storage must use the shared policy field names");
assert.doesNotMatch(html, /self-check-in-out[^\n]*style=/i, "feature must not introduce bespoke inline styling");
assert.match(js, /selfCheckInOutInstructions/);
assert.match(js, /selfCheckInOutForm/);
assert.doesNotMatch(js, /profile\.after\(section\)/, "RED: self check-in/out must not remain a standalone section above formal facts");
assert.match(js, /dataset\.groupKey=group\.key/, "RED: policy groups need a stable UI placement identity");
assert.match(js, /special_policy[\s\S]*appendSelfCheckInOutCard/, "RED: self check-in/out must be appended to the existing policy/special-service grid");
assert.match(js, /function selfCheckInOutCard\(\)\{const row=propertyFactCardRow/, "the new card must reuse the existing policy-card renderer");
assert.doesNotMatch(js, /function selfCheckInOutCard\(\)[^\n]*document\.createElement\("form"\)/, "the policy grid must not contain a nested form");
assert.doesNotMatch(js, /function selfCheckInOutCard\(\)[^\n]*element\("button"/, "the card must use the existing formal-data save action");

console.log("self check-in/out instructions: PASS");
