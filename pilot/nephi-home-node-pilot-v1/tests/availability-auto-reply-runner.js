"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applicationService = require("../lib/new-core/application-service");

assert.equal(typeof applicationService.applyAvailabilityAutoReplyGate, "function",
  "shared application service must expose the deterministic per-item availability gate");

const answer = Object.freeze({
  unitId: "unit-1", disposition: "ANSWER", reasonClass: "executable_lodging_need",
  requiresCanonicalExecution: true, missingGuestFields: [], operatorActionClass: null, riskClass: null
});
const handoff = Object.freeze({
  unitId: "unit-2", disposition: "HANDOFF", reasonClass: "operator_action_required",
  requiresCanonicalExecution: false, missingGuestFields: [], operatorActionClass: "date_change", riskClass: null
});

assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "availability" }, { availabilityAutoReplyEnabled: false }), true);
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "available_dates" }, { availabilityAutoReplyEnabled: false }), true);
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "bundle_availability" }, { availabilityAutoReplyEnabled: false }), true);
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "availability" }, { availabilityAutoReplyEnabled: true }), false);
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "availability" }, {}), false, "missing setting must default ON");
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "amenity_list" }, { availabilityAutoReplyEnabled: false }), false);
assert.equal(applicationService.availabilityAutoReplySuppressed({ capability: "booking_operator_request" }, { availabilityAutoReplyEnabled: false }), false,
  "operator booking work must never be silenced");
assert.equal(applicationService.noExecutionDecision([], ["NO_REPLY"], [], []).action, "no_reply",
  "a suppressed-only turn must still use the existing FinalDecision NO_REPLY authority");

const html = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/assets/admin.js"), "utf8");
assert.match(html, /id="availabilityAutoReply"[\s\S]*class="availability-bulk"/);
assert.ok(html.indexOf("房況管理") < html.indexOf("id=\"availabilityAutoReply\""));
assert.ok(html.indexOf("id=\"availabilityAutoReply\"") < html.indexOf("id=\"monthlyInventoryControls\""));
assert.match(js, /availabilityAutoReplyEnabled/);
assert.match(js, /\/api\/property-profile/);

console.log("availability auto reply runner passed");
