"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PropertyFactsFormData = api;
})(typeof globalThis === "object" ? globalThis : this, function createApi() {
  function lines(value) {
    return String(value || "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  }

  function jsonArray(value, field) {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) throw new Error(`${field} 必須是 JSON 陣列`);
    return parsed;
  }

  function nullableBoolean(value) {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return null;
  }

  function buildPropertyFactsPayload(propertyId, drafts, now = () => new Date()) {
    return {
      propertyId: String(propertyId || "").trim(),
      facts: (drafts || []).map((draft) => ({
        canonicalId: String(draft.canonicalId || "").trim(),
        category: String(draft.category || "").trim(),
        status: String(draft.status || "").trim(),
        appliesTo: String(draft.appliesTo || "").trim(),
        publicText: String(draft.publicText || "").trim(),
        fees: jsonArray(draft.fees, "fees"),
        advanceNoticeRequired: nullableBoolean(draft.advanceNoticeRequired),
        reservationRequired: nullableBoolean(draft.reservationRequired),
        conditions: lines(draft.conditions),
        restrictions: lines(draft.restrictions),
        operatingHours: jsonArray(draft.operatingHours, "operatingHours"),
        availablePeriods: jsonArray(draft.availablePeriods, "availablePeriods"),
        notes: String(draft.notes || "").trim(),
        source: String(draft.source || "operator_form").trim(),
        updatedAt: String(draft.updatedAt || now().toISOString()).trim()
      }))
    };
  }

  return { buildPropertyFactsPayload };
});
