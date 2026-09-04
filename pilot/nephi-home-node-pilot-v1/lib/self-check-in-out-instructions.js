"use strict";

const VALID_STATUSES = new Set(["allowed", "conditional", "not_allowed", "unknown"]);

function normalizeSelfCheckInOutInstructions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacy = !Object.hasOwn(source, "status") && (Object.hasOwn(source, "enabled") || Object.hasOwn(source, "content"));
  const status = legacy ? source.enabled === true ? "allowed" : "unknown" : String(source.status || "unknown").trim();
  if (!VALID_STATUSES.has(status)) throw new Error("invalid_self_check_in_out_status");
  return {
    status,
    publicText: String(legacy ? source.content || "" : source.publicText || "").normalize("NFC").trim().slice(0, 1000),
    notes: String(source.notes || "").normalize("NFC").trim().slice(0, 1000)
  };
}

module.exports = { normalizeSelfCheckInOutInstructions };
