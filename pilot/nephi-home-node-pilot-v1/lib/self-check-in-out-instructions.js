"use strict";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSelfCheckInOutInstructions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const month = source.applicableMonth === null || source.applicableMonth === "" || source.applicableMonth === undefined
    ? null : Number(source.applicableMonth);
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new Error("invalid_self_check_in_out_month");
  const validUntil = String(source.validUntil || "").trim() || null;
  const parsedDate = validUntil && new Date(`${validUntil}T00:00:00Z`);
  if (validUntil && (!DATE_PATTERN.test(validUntil) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== validUntil)) throw new Error("invalid_self_check_in_out_valid_until");
  return {
    applicableMonth: month,
    validUntil,
    content: String(source.content || "").normalize("NFC").trim().slice(0, 2000),
    enabled: source.enabled === true
  };
}

module.exports = { normalizeSelfCheckInOutInstructions };
