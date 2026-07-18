"use strict";

function key(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function allEntities(catalog) { return [...(catalog.rooms || []), ...(catalog.amenities || []), ...(catalog.policies || []), ...(catalog.faqs || [])]; }
function resolveEntity(catalog, candidate = {}) {
  const expected = candidate.category;
  const entities = allEntities(catalog).filter((item) => expected === "room" ? ["room", "bundle"].includes(item.category) : expected === "amenity" ? ["amenity", "policy"].includes(item.category) : expected === "room_feature" ? item.category === "room" : expected === "activity" ? item.category === "amenity" : item.category === expected);
  const raw = key(candidate.rawText);
  const matches = raw ? entities.filter((item) => [item.publicName, item.type, ...(item.aliases || []), ...(item.features || [])].map(key).some((alias) => alias && alias === raw)) : [];
  if (matches.length > 1 && ["room", "room_feature"].includes(expected)) return { status: "matched_set", entities: matches };
  const canonical = key(candidate.canonicalCandidate);
  if (canonical) { const exact = entities.find((item) => key(item.canonicalId) === canonical); if (exact) return { status: "resolved", entity: exact }; }
  if (!raw) return { status: "not_found", candidates: [] };
  if (matches.length === 1) return { status: "resolved", entity: matches[0] };
  if (matches.length > 1 && ["room", "room_feature"].includes(expected)) return { status: "matched_set", entities: matches };
  return matches.length > 1 ? { status: "ambiguous", candidates: matches.map((item) => ({ canonicalId: item.canonicalId, publicName: item.publicName })) } : { status: "not_found", candidates: [] };
}

module.exports = { resolveEntity };
