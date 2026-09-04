"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeCanonicalQueryPlans } = require("../lib/conversation-engine-v2/capability-executor");
const { createCanonicalRequest } = require("../lib/conversation-engine-v2/canonical-request");
const { projectCapabilityRegistry } = require("../lib/new-core/capability-subject-policy");

const root = path.join(__dirname, "..");
const identity = "self_check_in_out_instructions";
const setting = { applicableMonth: 9, validUntil: "2026-12-31", content: "本館採自助入住，入住當天會提供入住密碼及相關說明。", enabled: true };
const property = { propertyId: "alpha", displayName: "Alpha", timezone: "Asia/Taipei", rooms: [], commonAnswers: {}, propertyFacts: [], selfCheckInOutInstructions: setting };
const catalog = buildPropertyCatalog(property);
const fact = catalog.policies.find((item) => item.canonicalId === identity);
assert.ok(fact, "RED: approved self check-in/out identity must be projected into the formal property catalog");
assert.equal(fact.answer, setting.content);
assert.deepEqual(fact.applicability, { applicableMonth: 9, validUntil: "2026-12-31" });
assert.match(projectCapabilityRegistry().policy.understandingDescription, /self-check-in|self check-in/i, "RED: shared policy guidance must expose the approved semantic identity");

function plan(taskId, checkIn) {
  const temporalState = { rawText: checkIn || "", expressionType: checkIn ? "date" : "none", checkIn: checkIn || null, checkOut: checkIn ? `${checkIn.slice(0, 8)}${String(Number(checkIn.slice(8)) + 1).padStart(2, "0")}` : null, nights: checkIn ? 1 : null, searchRange: null, timezone: "Asia/Taipei", resolutionStatus: checkIn ? "resolved" : "absent", resolutionSource: checkIn ? "explicit" : "none", repairReasonCode: "", applicableTaskIds: checkIn ? [taskId] : [], ambiguity: null, originalExpression: checkIn || "", provenance: [], ruleRefs: [], derivedFromFieldRefs: [], fields: {} };
  const canonicalRequest = createCanonicalRequest({ taskId, capability: "policy", canonicalEntity: { category: "policy", canonicalId: identity, canonicalSet: [], status: "resolved", rawText: "" }, lodgingProduct: { productType: "any", productId: null }, detailIntent: "general", temporalState, stayDependency: false, requiredFields: [], resolverId: "property_catalog", riskLevel: "low", responseMode: "answer", evidenceRefs: [] });
  return { formalRequestId: `cycle:${taskId}`, taskId, requestCycleId: "cycle", propertyId: property.propertyId, canonicalRequest, capability: "policy", resolverId: "property_catalog", riskLevel: "low", responseMode: "answer", detailIntent: "general", conditions: { stay: { checkIn: temporalState.checkIn, checkOut: temporalState.checkOut }, inventory: { mode: "any" }, topic: {} }, entity: canonicalRequest.canonicalEntity };
}

const september = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("sep", "2026-09-20")], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(september.outcome, "answered", "matching check-in month must use the formal fact");
const october = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("oct", "2026-10-20")], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(october.outcome, "unknown", "non-matching check-in month must not use the fact");
const noDateScoped = executeCanonicalQueryPlans({ property, catalog, queryPlans: [plan("none", null)], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(noDateScoped.outcome, "unknown", "month-scoped instructions require an explicit check-in date");
const unrestrictedProperty = { ...property, selfCheckInOutInstructions: { ...setting, applicableMonth: null } };
const unrestricted = executeCanonicalQueryPlans({ property: unrestrictedProperty, catalog: buildPropertyCatalog(unrestrictedProperty), queryPlans: [{ ...plan("open", null), propertyId: "alpha" }], now: new Date("2026-09-04T00:00:00+08:00") })[0];
assert.equal(unrestricted.outcome, "answered", "unrestricted and current instructions may answer without a check-in date");
const expired = executeCanonicalQueryPlans({ property: unrestrictedProperty, catalog: buildPropertyCatalog(unrestrictedProperty), queryPlans: [{ ...plan("expired", null), propertyId: "alpha" }], now: new Date("2027-01-01T00:00:00+08:00") })[0];
assert.equal(expired.outcome, "unknown", "expired instructions must not be used");

const html = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/assets/admin.js"), "utf8");
assert.match(js, /selfCheckInOutForm[\s\S]*selfCheckInOutApplicableMonth[\s\S]*selfCheckInOutValidUntil[\s\S]*selfCheckInOutContent[\s\S]*selfCheckInOutEnabled/);
assert.doesNotMatch(html, /self-check-in-out[^\n]*style=/i, "feature must not introduce bespoke inline styling");
assert.match(js, /selfCheckInOutInstructions/);
assert.match(js, /selfCheckInOutForm/);

console.log("self check-in/out instructions: PASS");
