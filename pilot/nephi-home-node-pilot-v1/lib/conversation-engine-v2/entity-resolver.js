"use strict";

function key(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function allEntities(catalog) { return [...(catalog.rooms || []), ...(catalog.amenities || []), ...(catalog.policies || []), ...(catalog.faqs || [])]; }
function fragmentIsSpecificEnough(value) {
  const characters = [...value];
  const containsCompactScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
  return characters.length >= (containsCompactScript ? 2 : 4);
}
function uniqueEntities(entities) {
  const byCanonicalId = new Map();
  for (const entity of entities) if (!byCanonicalId.has(entity.canonicalId)) byCanonicalId.set(entity.canonicalId, entity);
  return [...byCanonicalId.values()];
}
function regexEscape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mentionedAlias(sourceText, alias) {
  const normalizedAlias = String(alias || "").normalize("NFKC").toLowerCase().trim();
  const compactAlias = key(normalizedAlias);
  if (!fragmentIsSpecificEnough(compactAlias)) return false;
  const normalizedSource = String(sourceText || "").normalize("NFKC").toLowerCase();
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(normalizedAlias)) {
    return key(normalizedSource).includes(compactAlias);
  }
  const tokens = normalizedAlias.match(/[\p{L}\p{N}]+/gu) || [];
  if (!tokens.length) return false;
  const phrase = tokens.map(regexEscape).join("[^\\p{L}\\p{N}]+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}($|[^\\p{L}\\p{N}])`, "u").test(normalizedSource);
}
function mentionedAliasWithOneSubstitution(sourceText, alias) {
  const normalizedAlias = String(alias || "").normalize("NFKC").toLowerCase().trim();
  const candidate = [...key(normalizedAlias)];
  if (candidate.length < 4) return false;
  const oneSubstitution = (sourceValue) => {
    const source = [...key(sourceValue)];
    if (source.length !== candidate.length) return false;
    let differences = 0;
    for (let index = 0; index < candidate.length; index += 1) if (source[index] !== candidate[index]) differences += 1;
    return differences === 1;
  };
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(normalizedAlias)) {
    return oneSubstitution(sourceText);
  }
  const aliasTokens = normalizedAlias.match(/[\p{L}\p{N}]+/gu) || [];
  const sourceTokens = String(sourceText || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!aliasTokens.length || sourceTokens.length < aliasTokens.length) return false;
  for (let start = 0; start <= sourceTokens.length - aliasTokens.length; start += 1) {
    if (oneSubstitution(sourceTokens.slice(start, start + aliasTokens.length).join(""))) return true;
  }
  return false;
}
function mentionedPropertyFacts(catalog, sourceText) {
  const facts = uniqueEntities([...(catalog && catalog.amenities || []), ...(catalog && catalog.policies || []), ...(catalog && catalog.faqs || [])]
    .filter((item) => item && item.canonicalId && (item.answer || ["confirmed_yes", "confirmed_no"].includes(item.status))));
  const aliasOwners = new Map();
  for (const fact of facts) {
    for (const alias of [fact.publicName, ...(fact.aliases || [])]) {
      const aliasKey = key(alias);
      if (!fragmentIsSpecificEnough(aliasKey)) continue;
      if (!aliasOwners.has(aliasKey)) aliasOwners.set(aliasKey, new Set());
      aliasOwners.get(aliasKey).add(fact.canonicalId);
    }
  }
  return facts.flatMap((entity) => {
    const mention = [entity.publicName, ...(entity.aliases || [])]
      .filter((alias) => aliasOwners.get(key(alias)) && aliasOwners.get(key(alias)).size === 1)
      .sort((left, right) => key(right).length - key(left).length)
      .find((alias) => mentionedAlias(sourceText, alias));
    return mention ? [{ entity, mention }] : [];
  });
}
function mentionedInventoryEntities(catalog, sourceText) {
  const inventory = uniqueEntities(catalog && catalog.rooms || []);
  const aliasOwners = new Map();
  for (const entity of inventory) {
    for (const alias of [entity.publicName, ...(entity.aliases || [])]) {
      const aliasKey = key(alias);
      if (!fragmentIsSpecificEnough(aliasKey)) continue;
      if (!aliasOwners.has(aliasKey)) aliasOwners.set(aliasKey, new Set());
      aliasOwners.get(aliasKey).add(entity.canonicalId);
    }
  }
  return inventory.flatMap((entity) => {
    const aliases = [entity.publicName, ...(entity.aliases || [])]
      .filter((alias) => aliasOwners.get(key(alias)) && aliasOwners.get(key(alias)).size === 1)
      .sort((left, right) => key(right).length - key(left).length);
    const mention = aliases.find((alias) => mentionedAlias(sourceText, alias))
      || aliases.find((alias) => mentionedAliasWithOneSubstitution(sourceText, alias));
    return mention ? [{ entity, mention }] : [];
  });
}
function mentionedInventoryFeatures(catalog, sourceText) {
  const features = new Map();
  for (const entity of catalog && catalog.rooms || []) {
    for (const feature of entity.features || []) {
      const featureKey = key(feature);
      if (!fragmentIsSpecificEnough(featureKey)) continue;
      if (!features.has(featureKey)) features.set(featureKey, { feature, entities: [] });
      features.get(featureKey).entities.push(entity);
    }
  }
  return [...features.values()]
    .filter(({ feature }) => mentionedAlias(sourceText, feature));
}
function resolveEntity(catalog, candidate = {}) {
  const expected = candidate.category;
  const entities = allEntities(catalog).filter((item) => expected === "room" ? ["room", "bundle"].includes(item.category) : expected === "amenity" ? ["amenity", "policy"].includes(item.category) : expected === "room_feature" ? item.category === "room" : expected === "activity" ? item.category === "amenity" : expected === "other" ? true : item.category === expected);
  const raw = key(candidate.rawText);
  const matches = raw ? entities.filter((item) => [item.publicName, item.type, ...(item.aliases || []), ...(item.features || [])].map(key).some((alias) => alias && alias === raw)) : [];
  if (matches.length > 1 && ["room", "room_feature"].includes(expected)) return { status: "matched_set", entities: matches };
  const canonical = key(candidate.canonicalCandidate);
  if (canonical) { const exact = entities.find((item) => key(item.canonicalId) === canonical); if (exact) return { status: "resolved", entity: exact }; }
  if (!raw) return { status: "not_found", candidates: [] };
  if (matches.length === 1) return { status: "resolved", entity: matches[0] };
  if (matches.length > 1 && ["room", "room_feature"].includes(expected)) return { status: "matched_set", entities: matches };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches.map((item) => ({ canonicalId: item.canonicalId, publicName: item.publicName })) };
  if (!["room", "room_feature", "other"].includes(expected) && fragmentIsSpecificEnough(raw)) {
    const fragmentMatches = uniqueEntities(entities
      .filter((item) => !["room", "bundle"].includes(item.category) && item.sourceKind !== "faq")
      .filter((item) => [item.publicName, ...(item.aliases || [])]
        .map(key)
        .some((alias) => alias && alias.includes(raw))));
    if (fragmentMatches.length === 1) return { status: "resolved", entity: fragmentMatches[0] };
    if (fragmentMatches.length > 1) return { status: "ambiguous", candidates: fragmentMatches.map((item) => ({ canonicalId: item.canonicalId, publicName: item.publicName })) };
  }
  return { status: "not_found", candidates: [] };
}

module.exports = { resolveEntity, mentionedPropertyFacts, mentionedInventoryEntities, mentionedInventoryFeatures };
