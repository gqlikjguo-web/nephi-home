"use strict";

function normalizePublicSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 80);
}

function publicSlugForProperty(property) {
  if (!property) return "";
  const configured = normalizePublicSlug(property.businessProfile && property.businessProfile.publicSlug);
  return configured || normalizePublicSlug(property.propertyId);
}

function resolvePublicProperty(properties, slug) {
  const requested = normalizePublicSlug(slug);
  if (!requested) return null;
  const matches = (properties || []).filter((property) => property && property.onboarding?.isReady !== false && publicSlugForProperty(property) === requested);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { normalizePublicSlug, publicSlugForProperty, resolvePublicProperty };
