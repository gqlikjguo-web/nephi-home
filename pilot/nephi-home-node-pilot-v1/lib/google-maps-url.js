"use strict";

const GOOGLE_MAP_HOSTS = new Set(["maps.app.goo.gl", "maps.google.com"]);

function normalizeGoogleMapsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2000) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const isGoogleMapsPath = (host === "google.com" || host === "www.google.com") && url.pathname.startsWith("/maps");
    return url.protocol === "https:" && (GOOGLE_MAP_HOSTS.has(host) || isGoogleMapsPath) ? url.toString() : "";
  } catch { return ""; }
}

function extractGoogleMapsUrl(value) {
  const direct = normalizeGoogleMapsUrl(value);
  if (direct) return direct;
  const raw = String(value || "").replace(/&amp;/gi, "&");
  for (const match of raw.matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    const candidate = match[0].replace(/[),.;!?，。！？]+$/u, "");
    const normalized = normalizeGoogleMapsUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

module.exports = { normalizeGoogleMapsUrl, extractGoogleMapsUrl };
