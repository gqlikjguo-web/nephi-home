"use strict";

(function expose(root, factory) {
  const registry = typeof module === "object" && module.exports
    ? require("./high-frequency-equipment")
    : root.HighFrequencyEquipment;
  const api = factory(registry);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PropertyFactsFormData = api;
})(typeof globalThis === "object" ? globalThis : this, function createApi(registry) {
  const equipment = registry && registry.HIGH_FREQUENCY_EQUIPMENT || [];
  const equipmentByCanonicalId = registry && registry.equipmentByCanonicalId || (() => null);
  const validStatuses = new Set(["allowed", "not_allowed", "unknown"]);
  const validScopes = new Set(["whole_property", "room_only", "both"]);

  function equipmentFieldPolicy(status) {
    if (status === "allowed") return { showScope: true, showPublicText: true, showNotes: true, publicTextRequired: true };
    if (status === "not_allowed") return { showScope: false, showPublicText: true, showNotes: true, publicTextRequired: false };
    return { showScope: false, showPublicText: false, showNotes: false, publicTextRequired: false };
  }

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

  function arrayField(value) {
    return typeof value === "string" ? value : JSON.stringify(Array.isArray(value) ? value : []);
  }

  function listField(value) {
    return typeof value === "string" ? value : (Array.isArray(value) ? value : []).join("\n");
  }

  function buildHighFrequencyEquipmentDrafts(facts, source = "operator_form") {
    const byId = new Map((facts || []).map((fact) => [String(fact && fact.canonicalId || ""), fact || {}]));
    return equipment.map((definition) => {
      const fact = byId.get(definition.canonicalId) || {};
      const status = validStatuses.has(fact.status) ? fact.status : "unknown";
      return {
        canonicalId: definition.canonicalId,
        publicName: definition.publicName,
        category: "amenity",
        status,
        appliesTo: validScopes.has(fact.appliesTo) ? fact.appliesTo : "whole_property",
        publicText: status === "unknown" ? "" : String(fact.publicText || ""),
        fees: arrayField(fact.fees),
        advanceNoticeRequired: fact.advanceNoticeRequired === true ? "true" : fact.advanceNoticeRequired === false ? "false" : "",
        reservationRequired: fact.reservationRequired === true ? "true" : fact.reservationRequired === false ? "false" : "",
        conditions: listField(fact.conditions),
        restrictions: listField(fact.restrictions),
        operatingHours: arrayField(fact.operatingHours),
        availablePeriods: arrayField(fact.availablePeriods),
        notes: String(fact.notes || ""),
        source: String(fact.source || source),
        updatedAt: String(fact.updatedAt || "")
      };
    });
  }

  function buildPropertyFactsPayload(propertyId, drafts, now = () => new Date()) {
    return {
      propertyId: String(propertyId || "").trim(),
      facts: (drafts || []).map((draft) => ({
        canonicalId: String(draft.canonicalId || "").trim(),
        publicName: equipmentByCanonicalId(draft.canonicalId)?.publicName || "",
        category: String(draft.category || "").trim(),
        status: String(draft.status || "").trim(),
        appliesTo: String(draft.appliesTo || "").trim(),
        publicText: String(draft.status || "").trim() === "unknown" ? "" : String(draft.publicText || "").trim(),
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

  return { buildPropertyFactsPayload, buildHighFrequencyEquipmentDrafts, equipmentByCanonicalId, equipmentFieldPolicy };
});
