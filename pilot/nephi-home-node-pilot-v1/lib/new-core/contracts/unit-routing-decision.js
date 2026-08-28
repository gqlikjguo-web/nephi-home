"use strict";

const UNIT_ROUTING_DECISION_FIELDS = Object.freeze([
  "unitId",
  "disposition",
  "reasonClass",
  "requiresCanonicalExecution",
  "missingGuestFields",
  "operatorActionClass",
  "riskClass"
]);
const DISPOSITIONS = new Set(["ANSWER", "CLARIFY", "HANDOFF", "NO_REPLY"]);
const REASON_CLASSES = new Set([
  "executable_lodging_need",
  "missing_guest_fields",
  "operator_action_required",
  "risk_policy_required",
  "no_executable_need"
]);
const OPERATOR_ACTION_CLASSES = new Set([
  "booking_mutation",
  "reservation_cancellation",
  "refund_approval",
  "date_change",
  "special_arrangement"
]);
const RISK_CLASSES = new Set([
  "access_credential",
  "payment_claim",
  "sensitive_request"
]);

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validateUnitRoutingDecision(value) {
  const errors = [];
  const missingGuestFields = Array.isArray(value && value.missingGuestFields)
    ? value.missingGuestFields
    : null;
  if (!exactKeys(value, UNIT_ROUTING_DECISION_FIELDS)) errors.push("keys");
  if (!boundedText(value && value.unitId)) errors.push("unitId");
  if (!DISPOSITIONS.has(value && value.disposition)) errors.push("disposition");
  if (!REASON_CLASSES.has(value && value.reasonClass)) errors.push("reasonClass");
  if (typeof (value && value.requiresCanonicalExecution) !== "boolean") errors.push("requiresCanonicalExecution");
  if (missingGuestFields === null
    || missingGuestFields.some((field) => !boundedText(field))
    || new Set(missingGuestFields).size !== missingGuestFields.length) {
    errors.push("missingGuestFields");
  }
  if (value && value.operatorActionClass !== null && !OPERATOR_ACTION_CLASSES.has(value.operatorActionClass)) {
    errors.push("operatorActionClass");
  }
  if (value && value.riskClass !== null && !RISK_CLASSES.has(value.riskClass)) errors.push("riskClass");

  if (value && value.disposition === "ANSWER") {
    if (!value.requiresCanonicalExecution || missingGuestFields === null || missingGuestFields.length
      || value.operatorActionClass !== null || value.riskClass !== null
      || value.reasonClass !== "executable_lodging_need") errors.push("answer");
  }
  if (value && value.disposition === "CLARIFY") {
    if (value.requiresCanonicalExecution || missingGuestFields === null || missingGuestFields.length === 0
      || value.operatorActionClass !== null || value.riskClass !== null
      || value.reasonClass !== "missing_guest_fields") errors.push("clarify");
  }
  if (value && value.disposition === "HANDOFF") {
    const operator = value.operatorActionClass !== null;
    const risk = value.riskClass !== null;
    if (value.requiresCanonicalExecution || missingGuestFields === null || missingGuestFields.length
      || operator === risk
      || (operator && value.reasonClass !== "operator_action_required")
      || (risk && value.reasonClass !== "risk_policy_required")) errors.push("handoff");
  }
  if (value && value.disposition === "NO_REPLY") {
    if (value.requiresCanonicalExecution || missingGuestFields === null || missingGuestFields.length
      || value.operatorActionClass !== null || value.riskClass !== null
      || value.reasonClass !== "no_executable_need") errors.push("noReply");
  }

  if (!errors.length) return { ok: true, code: null, errors: [], value };
  const code = value && value.disposition === "ANSWER" ? "ANSWER_NOT_EXECUTABLE"
    : value && value.disposition === "CLARIFY" ? "CLARIFY_WITHOUT_GUEST_FIELD"
      : value && value.disposition === "HANDOFF" ? "HANDOFF_WITHOUT_OPERATOR_OR_RISK"
        : value && value.disposition === "NO_REPLY" ? "NO_REPLY_EXECUTABLE_CONFLICT"
          : "ROUTE_PURPOSE_CONFLICT";
  return { ok: false, code, errors: [...new Set(errors)] };
}

module.exports = {
  UNIT_ROUTING_DECISION_FIELDS,
  DISPOSITIONS,
  REASON_CLASSES,
  OPERATOR_ACTION_CLASSES,
  RISK_CLASSES,
  validateUnitRoutingDecision
};
