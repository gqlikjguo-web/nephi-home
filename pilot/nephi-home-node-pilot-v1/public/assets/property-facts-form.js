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
  const controlledPolicyFacts = Object.freeze([
    Object.freeze({ canonicalId: "breakfast", publicName: "早餐", displayName: "早餐說明" }),
    Object.freeze({ canonicalId: "pets", publicName: "寵物規則", displayName: "寵物規則" }),
    Object.freeze({ canonicalId: "travel_subsidy", publicName: "國旅補助", displayName: "國旅補助說明" })
  ]);
  const controlledPolicyByCanonicalId = new Map(controlledPolicyFacts.map((item) => [item.canonicalId, item]));
  const validStatuses = new Set(["allowed", "not_allowed", "unknown"]);
  const validScopes = new Set(["whole_property", "bundle_only"]);
  const controlledPolicyVisibleFields = Object.freeze(["status", "appliesTo", "publicText", "notes"]);
  const controlledPolicyHiddenFields = Object.freeze(["canonicalId", "publicName", "category", "fees", "advanceNoticeRequired", "reservationRequired", "conditions", "restrictions", "operatingHours", "availablePeriods", "source", "updatedAt"]);

  function controlledPolicyDisplayName(canonicalId) {
    return controlledPolicyByCanonicalId.get(String(canonicalId || "").trim())?.displayName || "";
  }

  function controlledPolicyCardContract(canonicalId) {
    return {
      displayName: controlledPolicyDisplayName(canonicalId),
      visibleFields: [...controlledPolicyVisibleFields],
      hiddenFields: [...controlledPolicyHiddenFields]
    };
  }

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
      let status = validStatuses.has(fact.status) ? fact.status : "unknown";
      let appliesTo = validScopes.has(fact.appliesTo) ? fact.appliesTo : "whole_property";
      if (fact.appliesTo === "both") appliesTo = "whole_property";
      if (fact.appliesTo === "room_only") status = "unknown";
      if (status !== "allowed") appliesTo = "whole_property";
      return {
        canonicalId: definition.canonicalId,
        publicName: definition.publicName,
        category: "amenity",
        status,
        appliesTo,
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

  function buildControlledPolicyFactDrafts(facts, source = "operator_form") {
    const byId = new Map((facts || []).map((fact) => [String(fact && fact.canonicalId || ""), fact || {}]));
    return controlledPolicyFacts.map((definition) => {
      const fact = byId.get(definition.canonicalId) || {};
      return {
        canonicalId: definition.canonicalId,
        publicName: definition.publicName,
        category: "policy",
        status: String(fact.status || "unknown"),
        appliesTo: String(fact.appliesTo || "whole_property"),
        publicText: String(fact.publicText || ""),
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

  function buildAdminPropertyFactCardGroups(facts, source = "operator_form") {
    const equipmentDrafts = buildHighFrequencyEquipmentDrafts(facts, source);
    const policyDrafts = buildControlledPolicyFactDrafts(facts, source);
    const equipmentById = new Map(equipmentDrafts.map((fact) => [fact.canonicalId, fact]));
    const policyById = new Map(policyDrafts.map((fact) => [fact.canonicalId, fact]));
    const equipmentGroup = (key) => equipment.filter((item) => item.group === key).map((item) => equipmentById.get(item.canonicalId));
    return [
      { key: "basic", publicName: "住宿基本設備", cards: equipmentGroup("basic") },
      { key: "cooking", publicName: "廚房／餐飲", cards: [...equipmentGroup("cooking"), policyById.get("breakfast")] },
      { key: "hygiene", publicName: "衛浴／盥洗", cards: equipmentGroup("hygiene") },
      { key: "infant", publicName: "嬰幼兒設備", cards: equipmentGroup("infant") },
      { key: "special_policy", publicName: "政策／特殊服務", cards: [policyById.get("pets"), policyById.get("travel_subsidy")] }
    ];
  }

  function buildPropertyFactsPayload(propertyId, drafts, now = () => new Date()) {
    return {
      propertyId: String(propertyId || "").trim(),
      facts: (drafts || []).map((draft) => ({
        canonicalId: String(draft.canonicalId || "").trim(),
        publicName: equipmentByCanonicalId(draft.canonicalId)?.publicName || controlledPolicyByCanonicalId.get(String(draft.canonicalId || "").trim())?.publicName || "",
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

  return { buildPropertyFactsPayload, buildHighFrequencyEquipmentDrafts, buildControlledPolicyFactDrafts, buildAdminPropertyFactCardGroups, controlledPolicyCardContract, controlledPolicyDisplayName, controlledPolicyFacts, equipmentByCanonicalId, equipmentFieldPolicy };
});
