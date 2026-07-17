"use strict";

function key(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function allEntities(catalog) { return [...(catalog.rooms || []), ...(catalog.amenities || []), ...(catalog.policies || [])]; }
function resolveEntity(catalog, candidate = {}) {
  const expected = candidate.category;
  const entities = allEntities(catalog).filter((item) => expected === "room_feature" ? item.category === "room" : expected === "activity" ? item.category === "amenity" : item.category === expected);
  const canonical = key(candidate.canonicalCandidate);
  if (canonical) { const exact = entities.find((item) => key(item.canonicalId) === canonical); if (exact) return { status: "resolved", entity: exact }; }
  const raw = key(candidate.rawText);
  if (!raw) return { status: "not_found", candidates: [] };
  const matches = entities.filter((item) => [item.publicName, item.type, ...(item.aliases || []), ...(item.features || [])].map(key).some((alias) => alias && alias === raw));
  return matches.length === 1 ? { status: "resolved", entity: matches[0] } : matches.length > 1 ? { status: "ambiguous", candidates: matches.map((item) => ({ canonicalId: item.canonicalId, publicName: item.publicName })) } : { status: "not_found", candidates: [] };
}

module.exports = { resolveEntity };
